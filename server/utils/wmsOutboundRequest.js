const axios = require('axios');
const sql = require('mssql');

const DEFAULT_URL = 'https://camera-grimacing-recolor.ngrok-free.dev/api/share/wmsOutbound';
const SOURCE_TYPE = 'WMS_OUTBOUND_REQUEST';
const EDITABLE = new Set(['DRAFT', 'FAILED', 'REJECTED']);

function fail(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    throw error;
}

function clean(value, max = Infinity) {
    const result = typeof value === 'string' ? value.trim() : '';
    return result.length <= max ? result : '';
}

function positiveId(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeItems(items) {
    if (!Array.isArray(items) || !items.length) fail(422, 'Yêu cầu xuất phải có ít nhất một dòng hàng');
    const keys = new Set();
    return items.map((item, index) => {
        const itemCode = clean(item?.itemCode, 255);
        const itemName = clean(item?.itemName, 500);
        const skipLot = item?.skipLot ?? [];
        if (!Array.isArray(skipLot) || skipLot.length > 100 || skipLot.some(x => typeof x !== 'string' || !x.trim() || x.trim().length > 50))
            fail(422, `Dòng ${index + 1} có dấu tuần không xuất không hợp lệ`);
        const excluded = [...new Set(skipLot.map(x => x.trim()))];
        const quantity = Number(item?.quantity);
        const key = itemCode.toUpperCase();
        if (!itemCode || !itemName || !Number.isSafeInteger(quantity) || quantity <= 0)
            fail(422, `Dòng ${index + 1} thiếu mã hàng, tên hàng hoặc số lượng nguyên dương`);
        if (keys.has(key)) fail(422, `Mã hàng ${itemCode} bị trùng`);
        keys.add(key);
        return { itemCode, itemName, ...(excluded.length ? { skipLot: excluded } : {}), quantity };
    });
}

function buildPayload(order, rows) {
    const items = normalizeItems(rows.map(row => ({
        itemCode: row.ItemCode ?? row.itemCode,
        itemName: row.ItemName ?? row.itemName,
        skipLot: row.SkipLotJson ? JSON.parse(row.SkipLotJson) : row.skipLot,
        quantity: row.SoLuong ?? row.quantity,
    })));
    const date = new Date(order.NgayYeuCau ?? order.date);
    if (!Number.isFinite(date.getTime())) fail(422, 'Ngày yêu cầu không hợp lệ');
    return {
        orderID: String(order.ID_YeuCauXuatWMS ?? order.id),
        orderCode: String(order.MaYeuCau ?? order.orderCode),
        orderType: 'OUTBOUND',
        date: date.toISOString(),
        items,
    };
}

function dispatchError(error) {
    const data = error?.response?.data;
    return String(data?.message || data?.error || error?.message || 'Không gửi được WMS').slice(0, 1000);
}

async function dispatch(pool, id, post = axios.post) {
    id = positiveId(id);
    if (!id) fail(400, 'ID yêu cầu xuất không hợp lệ');
    const order = (await pool.request().input('ID', sql.Int, id).query(`
        SELECT * FROM dbo.YeuCauXuatWMS WHERE ID_YeuCauXuatWMS=@ID`)).recordset[0];
    if (!order) fail(404, 'Không tìm thấy yêu cầu xuất');
    if (order.TrangThai === 'COMPLETED' || order.TrangThai === 'CANCELLED')
        fail(409, 'Yêu cầu xuất đã hoàn tất hoặc đã hủy');
    if (order.TrangThai === 'SENT') return { ok: true, alreadySent: true, status: 'SENT' };
    if (order.TrangThai === 'SENDING') fail(409, 'Yêu cầu đang được gửi WMS');

    let serialized = order.RequestJson;
    let payload;
    if (serialized && order.TrangThai === 'FAILED') {
        try { payload = JSON.parse(serialized); } catch (_) { fail(409, 'RequestJson đã lưu không hợp lệ'); }
        // Earlier attempts may have persisted an extra field; do not resend it.
        delete payload.sourceType;
        serialized = JSON.stringify(payload);
    } else {
        const rows = (await pool.request().input('ID', sql.Int, id).query(`
            SELECT ItemCode,ItemName,Lot,SoLuong,SkipLotJson FROM dbo.YeuCauXuatWMS_ChiTiet
            WHERE ID_YeuCauXuatWMS=@ID ORDER BY ThuTu,ID_YeuCauXuatWMS_ChiTiet`)).recordset;
        payload = buildPayload(order, rows);
        serialized = JSON.stringify(payload);
    }

    const claimed = await pool.request().input('ID', sql.Int, id)
        .input('Payload', sql.NVarChar(sql.MAX), serialized).query(`
        UPDATE dbo.YeuCauXuatWMS WITH (UPDLOCK,ROWLOCK)
        SET TrangThai='SENDING',RequestJson=@Payload,DispatchAttempts=DispatchAttempts+1,
            DispatchError=NULL,UpdatedAt=SYSUTCDATETIME(),
            Revision=Revision+CASE WHEN TrangThai='REJECTED' THEN 1 ELSE 0 END
        OUTPUT inserted.DispatchAttempts
        WHERE ID_YeuCauXuatWMS=@ID AND TrangThai IN ('DRAFT','FAILED','REJECTED');`);
    if (!claimed.recordset.length) fail(409, 'Trạng thái yêu cầu đã thay đổi; hãy tải lại');

    let error = null;
    try {
        const response = await post(process.env.WMS_OUTBOUND_URL || DEFAULT_URL, payload, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `outbound-${payload.orderID}` },
        });
        if (response.status < 200 || response.status >= 300) throw new Error(`WMS HTTP ${response.status}`);
    } catch (cause) {
        error = dispatchError(cause);
    }
    await pool.request().input('ID', sql.Int, id)
        .input('State', sql.VarChar(20), error ? 'FAILED' : 'SENT')
        .input('Error', sql.NVarChar(1000), error).query(`
        UPDATE dbo.YeuCauXuatWMS SET TrangThai=@State,DispatchError=@Error,
            SentAt=CASE WHEN @State='SENT' THEN SYSUTCDATETIME() ELSE SentAt END,
            UpdatedAt=SYSUTCDATETIME()
        WHERE ID_YeuCauXuatWMS=@ID AND TrangThai='SENDING';`);
    return { ok: !error, status: error ? 'FAILED' : 'SENT', error };
}

function normalizeCallback(body) {
    const id = positiveId(body?.orderID);
    const orderCode = clean(body?.orderCode, 50);
    const eventID = clean(body?.eventID, 255);
    const isRequestSource = body?.sourceType === SOURCE_TYPE || /^YCX-\d{8}-\d{6}$/.test(orderCode);
    if (!isRequestSource || body?.orderType !== 'OUTBOUND' || !id || !orderCode)
        fail(400, 'Callback yêu cầu xuất không hợp lệ hoặc thiếu orderID, orderCode');
    if (body.status === 'REJECTED') return { id, orderCode, eventID, status: 'REJECTED',
        reason: clean(body.message || body.reasonCode || 'WMS từ chối yêu cầu', 1000) };
    if (body.status !== 'COMPLETED' || !clean(body.processedAt) || !Number.isFinite(Date.parse(body.processedAt)))
        fail(422, 'Callback chỉ chấp nhận COMPLETED hoặc REJECTED');
    if (!Array.isArray(body.items) || !body.items.length) fail(400, 'Callback thiếu items');
    const itemKeys = new Set();
    const items = body.items.map((item, index) => {
        const itemCode = clean(item?.itemCode, 255), lot = clean(item?.lot, 50);
        const itemKey = JSON.stringify([itemCode, lot]);
        const requestedQuantity = Number(item?.requestedQuantity), exportedQuantity = Number(item?.exportedQuantity);
        if (!itemCode || !Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0 ||
            !Number.isSafeInteger(exportedQuantity) || exportedQuantity <= 0 || !Array.isArray(item.pallets) || !item.pallets.length)
            fail(400, `Dòng callback ${index + 1} không hợp lệ`);
        if (itemKeys.has(itemKey)) fail(400, 'Callback có mã hàng và lot bị trùng');
        itemKeys.add(itemKey);
        const palletIDs = new Set();
        const pallets = item.pallets.map(p => {
            const palletID = clean(p?.palletID, 255), quantity = Number(p?.quantity);
            if (!palletID || palletIDs.has(palletID) || !Number.isSafeInteger(quantity) || quantity <= 0)
                fail(400, 'Thông tin pallet không hợp lệ hoặc bị trùng');
            palletIDs.add(palletID);
            return { palletID, quantity };
        }).sort((a, b) => a.palletID.localeCompare(b.palletID));
        if (pallets.reduce((sum, p) => sum + p.quantity, 0) !== exportedQuantity)
            fail(400, 'Tổng số lượng pallet khác exportedQuantity');
        return { itemCode, lot, requestedQuantity, exportedQuantity, pallets };
    }).sort((a, b) => JSON.stringify([a.itemCode, a.lot]).localeCompare(JSON.stringify([b.itemCode, b.lot])));
    return { id, orderCode, eventID, status: 'COMPLETED',
        processedAt: new Date(body.processedAt).toISOString(), items };
}

async function confirm(pool, body) {
    const callback = normalizeCallback(body);
    const payloadJson = JSON.stringify(callback);
    // WMS outbound callbacks currently leave eventID empty. Keep the same
    // idempotent fallback used by the existing crane-outbound flow.
    const storedEventID = callback.eventID || `LEGACY-OUTBOUND:${callback.id}`;
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
        const request = () => new sql.Request(transaction);
        const order = (await request().input('ID', sql.Int, callback.id).query(`
            SELECT * FROM dbo.YeuCauXuatWMS WITH (UPDLOCK,HOLDLOCK) WHERE ID_YeuCauXuatWMS=@ID`)).recordset[0];
        if (!order) fail(404, 'Không tìm thấy yêu cầu xuất');
        if (order.MaYeuCau !== callback.orderCode) fail(409, 'orderCode không khớp yêu cầu xuất');
        const existing = (await request().input('Event', sql.NVarChar(255), storedEventID).query(`
            SELECT ID_YeuCauXuatWMS,PayloadJson,ResultJson FROM dbo.YeuCauXuatWMS_Event WITH (UPDLOCK,HOLDLOCK)
            WHERE EventID=@Event`)).recordset[0];
        if (existing) {
            if (Number(existing.ID_YeuCauXuatWMS) !== callback.id || existing.PayloadJson !== payloadJson)
                fail(409, 'eventID đã được dùng với nội dung khác');
            await transaction.commit();
            return { ...JSON.parse(existing.ResultJson), duplicate: true };
        }
        if (order.TrangThai === 'COMPLETED') fail(409, 'Yêu cầu đã nhận một callback hoàn tất khác');
        if (!['SENT', 'FAILED', 'REJECTED'].includes(order.TrangThai)) fail(409, 'Yêu cầu chưa ở trạng thái chờ WMS');

        if (callback.status === 'REJECTED') {
            const result = { success: true, orderID: String(callback.id), eventID: callback.eventID || null, status: 'REJECTED' };
            await request().input('ID', sql.Int, callback.id).input('Reason', sql.NVarChar(1000), callback.reason)
                .input('Callback', sql.NVarChar(sql.MAX), JSON.stringify(body)).query(`
                UPDATE dbo.YeuCauXuatWMS SET TrangThai='REJECTED',DispatchError=@Reason,CallbackJson=@Callback,
                    UpdatedAt=SYSUTCDATETIME() WHERE ID_YeuCauXuatWMS=@ID;`);
            await request().input('Event', sql.NVarChar(255), storedEventID).input('ID', sql.Int, callback.id)
                .input('Payload', sql.NVarChar(sql.MAX), payloadJson).input('Result', sql.NVarChar(sql.MAX), JSON.stringify(result)).query(`
                INSERT dbo.YeuCauXuatWMS_Event(EventID,ID_YeuCauXuatWMS,PayloadJson,ResultJson)
                VALUES(@Event,@ID,@Payload,@Result);`);
            await transaction.commit();
            return result;
        }

        const expectedRows = (await request().input('ID', sql.Int, callback.id).query(`
            SELECT ItemCode,ISNULL(Lot,'') AS Lot,SoLuong,SkipLotJson FROM dbo.YeuCauXuatWMS_ChiTiet WITH (HOLDLOCK)
            WHERE ID_YeuCauXuatWMS=@ID`)).recordset;
        const exclusions = new Map(expectedRows.map(row => [row.ItemCode, new Set(row.SkipLotJson ? JSON.parse(row.SkipLotJson) : [])]));
        if (callback.items.some(item => exclusions.get(item.itemCode)?.has(item.lot)))
            fail(422, 'WMS đã xuất dấu tuần nằm trong danh sách không xuất');
        const expected = new Map();
        for (const row of expectedRows) expected.set(row.ItemCode, (expected.get(row.ItemCode) || 0) + Number(row.SoLuong));
        const actual = new Map();
        for (const item of callback.items) actual.set(item.itemCode, (actual.get(item.itemCode) || 0) + item.requestedQuantity);
        if (expected.size !== actual.size || [...expected].some(([key, qty]) => actual.get(key) !== qty))
            fail(422, 'Mã hàng hoặc tổng số lượng callback không khớp yêu cầu đã gửi');

        await request().input('ID', sql.Int, callback.id).query(`
            DELETE dbo.YeuCauXuatWMS_KetQuaPallet WHERE ID_YeuCauXuatWMS=@ID;`);
        for (const item of callback.items) for (const pallet of item.pallets) {
            await request().input('ID', sql.Int, callback.id)
                .input('ItemCode', sql.NVarChar(255), item.itemCode).input('Lot', sql.NVarChar(50), item.lot)
                .input('Requested', sql.Int, item.requestedQuantity).input('Exported', sql.Int, item.exportedQuantity)
                .input('PalletID', sql.NVarChar(255), pallet.palletID).input('Quantity', sql.Int, pallet.quantity).query(`
                INSERT dbo.YeuCauXuatWMS_KetQuaPallet
                    (ID_YeuCauXuatWMS,ItemCode,Lot,RequestedQuantity,ExportedQuantity,PalletID,PalletQuantity)
                VALUES(@ID,@ItemCode,@Lot,@Requested,@Exported,@PalletID,@Quantity);`);
        }
        const result = { success: true, orderID: String(callback.id), eventID: callback.eventID || null,
            status: 'COMPLETED', duplicate: false };
        await request().input('ID', sql.Int, callback.id).input('Callback', sql.NVarChar(sql.MAX), JSON.stringify(body)).query(`
            UPDATE dbo.YeuCauXuatWMS SET TrangThai='COMPLETED',CallbackJson=@Callback,DispatchError=NULL,
                CompletedAt=SYSUTCDATETIME(),UpdatedAt=SYSUTCDATETIME() WHERE ID_YeuCauXuatWMS=@ID;`);
        await request().input('Event', sql.NVarChar(255), storedEventID).input('ID', sql.Int, callback.id)
            .input('Payload', sql.NVarChar(sql.MAX), payloadJson).input('Result', sql.NVarChar(sql.MAX), JSON.stringify(result)).query(`
            INSERT dbo.YeuCauXuatWMS_Event(EventID,ID_YeuCauXuatWMS,PayloadJson,ResultJson)
            VALUES(@Event,@ID,@Payload,@Result);`);
        await transaction.commit();
        return result;
    } catch (error) {
        try { await transaction.rollback(); } catch (_) { /* preserve original error */ }
        throw error;
    }
}

module.exports = { SOURCE_TYPE, EDITABLE, positiveId, normalizeItems, buildPayload, dispatch, normalizeCallback, confirm };
