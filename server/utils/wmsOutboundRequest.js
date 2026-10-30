const axios = require('axios');
const sql = require('mssql');
const db = require('./wmsOutboundRequestDb');

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
    const order = (await db.request(pool).input('ID_YeuCauXuatWMS', sql.Int, id)
        .execute(db.PROCEDURES.dispatchRead)).recordset[0];
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
        const rows = (await db.request(pool).input('ID_YeuCauXuatWMS', sql.Int, id)
            .execute(db.PROCEDURES.dispatchRead)).recordsets[1] || [];
        payload = buildPayload(order, rows);
        serialized = JSON.stringify(payload);
    }

    const claimed = await db.request(pool).input('ID_YeuCauXuatWMS', sql.Int, id)
        .input('PayloadJson', sql.NVarChar(sql.MAX), serialized).execute(db.PROCEDURES.dispatchClaim);
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
    await db.request(pool).input('ID_YeuCauXuatWMS', sql.Int, id)
        .input('ThanhCong', sql.Bit, !error).input('Loi', sql.NVarChar(1000), error)
        .execute(db.PROCEDURES.dispatchFinish);
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
    try {
        const result = { success: true, orderID: String(callback.id), eventID: callback.eventID || null,
            status: callback.status, duplicate: false };
        const saved = await db.request(pool).input('ID_YeuCauXuatWMS', sql.Int, callback.id)
            .input('MaYeuCau', sql.NVarChar(50), callback.orderCode)
            .input('EventID', sql.NVarChar(255), storedEventID).input('TrangThai', sql.VarChar(20), callback.status)
            .input('LyDo', sql.NVarChar(1000), callback.reason || null)
            .input('CallbackJson', sql.NVarChar(sql.MAX), JSON.stringify(body))
            .input('PayloadJson', sql.NVarChar(sql.MAX), payloadJson)
            .input('ResultJson', sql.NVarChar(sql.MAX), JSON.stringify(result))
            .input('Pallets', db.callbackTable(callback.items)).execute(db.PROCEDURES.callback);
        const duplicate = Boolean(saved.recordset?.[0]?.duplicate);
        if (callback.status === 'COMPLETED') {
            await db.request(pool).input('ID_YeuCauXuatWMS', sql.Int, callback.id).execute(db.PROCEDURES.postErp);
        }
        return { ...result, duplicate, erpStatus: callback.status === 'COMPLETED' ? 'ERP_POSTED' : undefined };
    } catch (error) {
        throw error;
    }
}

module.exports = { SOURCE_TYPE, EDITABLE, positiveId, normalizeItems, buildPayload, dispatch, normalizeCallback, confirm };
