const sql = require('mssql');
const crane = require('./craneWms');
const inbound = require('./craneWmsInbound');
const fail = (code, message) => { throw crane.craneError(code, message); };
const clean = value => typeof value === 'string' ? value.trim() : '';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

async function config(executor, isTest = false) {
    if (isTest) return { warehouseID: 5, temporaryLocationID: await inbound.testPendingLocationID(executor) };
    const value = crane.getCraneConfig();
    if (!value) fail(503, 'Kho cầu trục chưa được cấu hình');
    return value;
}

function normalize(body) {
    const eventID = clean(body.eventID);
    const orderID = clean(body.orderID);
    const orderCode = clean(body.orderCode);
    if (!eventID || eventID.length > 255 || !/^\d+$/.test(orderID) || !crane.positiveId(orderID) ||
        !orderCode || orderCode.length > 255 || body.orderType !== 'OUTBOUND' ||
        !clean(body.processedAt) || !Number.isFinite(Date.parse(body.processedAt)))
        fail(400, 'Thiếu hoặc sai eventID, phiếu xuất, orderType hoặc processedAt');
    if (body.status !== 'COMPLETED') fail(422, 'Chỉ xác nhận khi WMS xuất đủ: status phải là COMPLETED');
    if (!Array.isArray(body.items) || !body.items.length) fail(400, 'Thiếu items');
    const keys = new Set();
    const items = body.items.map(item => {
        const itemCode = clean(item?.itemCode), lot = clean(item?.lot);
        const key = JSON.stringify([itemCode, lot]);
        if (!itemCode || itemCode.length > 255 || !lot || lot.length > 50 || keys.has(key) ||
            !Number.isSafeInteger(item.requestedQuantity) || item.requestedQuantity <= 0 ||
            !Number.isSafeInteger(item.exportedQuantity) || item.exportedQuantity <= 0 ||
            !Array.isArray(item.pallets) || !item.pallets.length) fail(400, 'Item, dấu tuần hoặc số lượng không hợp lệ');
        keys.add(key);
        if (item.requestedQuantity !== item.exportedQuantity) fail(422, 'WMS chưa xuất đủ số lượng yêu cầu');
        const seen = new Set();
        const pallets = item.pallets.map(p => {
            const palletID = clean(p?.palletID);
            if (!palletID || palletID.length > 255 || seen.has(palletID) ||
                !Number.isSafeInteger(p.quantity) || p.quantity <= 0) fail(400, 'QR kiện hoặc số lượng kiện không hợp lệ');
            seen.add(palletID);
            return { palletID, quantity: p.quantity };
        }).sort((a, b) => compare(a.palletID, b.palletID));
        if (pallets.reduce((sum, p) => sum + p.quantity, 0) !== item.exportedQuantity)
            fail(400, 'Tổng số lượng kiện khác exportedQuantity');
        return { itemCode, lot, requestedQuantity: item.requestedQuantity, exportedQuantity: item.exportedQuantity, pallets };
    }).sort((a, b) => compare(JSON.stringify([a.itemCode, a.lot]), JSON.stringify([b.itemCode, b.lot])));
    return { eventID, orderID: String(Number(orderID)), orderCode, orderType: 'OUTBOUND',
        status: 'COMPLETED', processedAt: new Date(body.processedAt).toISOString(), items };
}

const lineKey = row => [row.ID_DonHang, row.ID_DonHang_LoSanXuat, row.ID_DonHang_SanPham].map(Number).join('|');
function allocate(details, items) {
    const lines = details.map(row => ({ ...row, remaining: Number(row.SoLuong_XuatKho) }))
        .sort((a, b) => Number(a.ID_DonHang) - Number(b.ID_DonHang) ||
            Number(a.ID_DonHang_LoSanXuat) - Number(b.ID_DonHang_LoSanXuat) ||
            Number(a.ID_DonHang_SanPham) - Number(b.ID_DonHang_SanPham));
    const expected = new Map(), actual = new Map();
    for (const line of lines) {
        if (!clean(line.ItemCode) || !Number.isSafeInteger(line.remaining) || line.remaining <= 0)
            fail(422, 'Dòng phiếu ERP thiếu mã hàng hoặc số lượng nguyên dương');
        expected.set(line.ItemCode, (expected.get(line.ItemCode) || 0) + line.remaining);
    }
    for (const item of items) actual.set(item.itemCode, (actual.get(item.itemCode) || 0) + item.exportedQuantity);
    if (!expected.size || expected.size !== actual.size || [...expected].some(([key, n]) => actual.get(key) !== n))
        fail(422, 'Mã hàng hoặc tổng số lượng WMS không khớp yêu cầu trên phiếu ERP');
    const links = [];
    for (const item of items) for (const pallet of item.pallets) {
        let left = pallet.quantity;
        for (const row of lines) {
            if (row.ItemCode !== item.itemCode || row.remaining === 0 || left === 0) continue;
            const quantity = Math.min(left, row.remaining);
            links.push({ row, palletID: pallet.palletID, itemCode: item.itemCode, lot: item.lot, quantity });
            left -= quantity; row.remaining -= quantity;
        }
        if (left) fail(422, 'Không thể phân bổ đủ số lượng vào dòng phiếu');
    }
    return links;
}

async function loadDetails(executor, orderID) {
    // Raw rows preserve quantities; the display procedure supplies ERP's item-code mapping.
    const raw = (await new sql.Request(executor).input('ID', sql.Int, orderID).query(`
        SELECT ID_DonHang, ID_DonHang_LoSanXuat, ID_DonHang_SanPham, SUM(SoLuong_XuatKho) AS SoLuong_XuatKho
        FROM dbo.PhieuXuatBTP_ChiTiet WITH (HOLDLOCK) WHERE ID_PhieuXuatBTP=@ID
        GROUP BY ID_DonHang, ID_DonHang_LoSanXuat, ID_DonHang_SanPham`)).recordset;
    const display = await new sql.Request(executor).input('ID_PhieuXuatBTP', sql.Int, orderID)
        .execute('dbo.App_BTP_PhieuXuat_ThongTinChiTiet');
    return raw.map(row => {
        const matches = (display.recordsets?.[1] || []).filter(x => lineKey(x) === lineKey(row));
        const codes = [...new Set(matches.map(x => clean(x.ItemCode)).filter(Boolean))];
        if (codes.length !== 1) fail(422, 'Không xác định duy nhất mã hàng của dòng phiếu ERP');
        return { ...row, ItemCode: codes[0], Ten_SanPham: matches[0].Ten_SanPham };
    });
}

async function lock(executor, name) {
    await new sql.Request(executor).input('Resource', sql.NVarChar(255), name).query(`
        DECLARE @r int;
        EXEC @r=sys.sp_getapplock @Resource=@Resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=15000;
        IF @r < 0 THROW 51051, N'Không lấy được khóa WMS, hãy gửi lại cùng eventID', 1;`);
}

async function confirm(pool, body, isTest = false) {
    const payload = normalize(body), fingerprint = JSON.stringify(payload);
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
        // Serializes WMS confirmations, including conflicting events on different orders/pallets.
        await lock(transaction, 'CraneWmsOutboundConfirm');
        const existing = (await new sql.Request(transaction).input('EventID', sql.NVarChar(255), payload.eventID)
            .query('SELECT PayloadJson, ResultJson FROM dbo.CraneWmsOutboundEvent WITH (UPDLOCK,HOLDLOCK) WHERE EventID=@EventID')).recordset[0];
        if (existing) {
            if (existing.PayloadJson !== fingerprint) fail(409, 'eventID đã được dùng với nội dung khác');
            await transaction.commit();
            return { ...JSON.parse(existing.ResultJson), duplicate: true };
        }
        const cfg = await config(transaction, isTest);
        await crane.assertTemporaryLocation(transaction, cfg);
        const order = (await new sql.Request(transaction).input('ID', sql.Int, Number(payload.orderID)).query(`
            SELECT * FROM dbo.PhieuXuatBTP WITH (UPDLOCK,HOLDLOCK) WHERE ID_PhieuXuatBTP=@ID AND TonTai=1`)).recordset[0];
        if (!order) fail(404, 'Không tìm thấy phiếu xuất');
        if (order.So_PhieuXuatBTP !== payload.orderCode) fail(409, 'Mã phiếu không khớp ID phiếu');
        if (Number(order.ID_KhoXuat) !== cfg.warehouseID) fail(409, 'Phiếu không thuộc kho cầu trục');
        if (order.QrStatus || [4, 5].includes(Number(order.TrangThai))) fail(409, 'Phiếu đã xác nhận hoặc không còn được phép xuất');
        if (await crane.findCraneOrder(transaction, Number(payload.orderID), true)) fail(409, 'Phiếu đã tham gia luồng WMS khác');
        const details = await loadDetails(transaction, Number(payload.orderID));
        const links = allocate(details, payload.items);
        const palletMap = new Map(), detailMap = new Map();
        for (const item of payload.items) for (const p of item.pallets) {
            if (!palletMap.has(p.palletID)) {
                const rows = (await new sql.Request(transaction).input('QR', sql.NVarChar(255), p.palletID).query(`
                    SELECT k.ID_TheKhoKienBTP, k.ID_ViTriKho, v.ID_Kho
                    FROM dbo.TheKhoKienBTP k WITH (UPDLOCK,HOLDLOCK)
                    JOIN dbo.DM_Kho_ViTri v ON v.ID_ViTriKho=k.ID_ViTriKho
                    WHERE k.QRCode=@QR AND k.TonTai=1 AND v.TonTai=1 AND v.SuDung=1`)).recordset;
                if (rows.length !== 1) fail(404, 'Không tìm thấy duy nhất kiện: ' + p.palletID);
                const row = rows[0];
                if (Number(row.ID_Kho) !== cfg.warehouseID || Number(row.ID_ViTriKho) === cfg.temporaryLocationID)
                    fail(409, 'Kiện sai kho hoặc đang ở vị trí tạm: ' + p.palletID);
                if (await crane.findActivePallet(transaction, p.palletID, true)) fail(409, 'Kiện đang bị khóa: ' + p.palletID);
                const stock = (await new sql.Request(transaction).input('ID', sql.Int, row.ID_TheKhoKienBTP).query(`
                    SELECT d.ID_TheKhoKienBTP_ChiTiet, d.ItemCode, d.DauTuan,
                        d.SoLuong-ISNULL(x.Exported,0) AS Available
                    FROM dbo.TheKhoKienBTP_ChiTiet d WITH (UPDLOCK,HOLDLOCK)
                    OUTER APPLY (SELECT SUM(SoLuong_XuatKho) AS Exported
                        FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien WITH (UPDLOCK,HOLDLOCK)
                        WHERE ID_TheKhoKienBTP_ChiTiet=d.ID_TheKhoKienBTP_ChiTiet) x
                    WHERE d.ID_TheKhoKienBTP=@ID AND d.TonTai=1`)).recordset;
                if (stock.some(x => !Number.isFinite(Number(x.Available)) || Number(x.Available) < 0)) fail(409, 'Tồn kiện không hợp lệ');
                palletMap.set(p.palletID, { ...row, stock, initial: stock.reduce((n, d) => n + Number(d.Available), 0), actual: 0 });
            }
            const pallet = palletMap.get(p.palletID);
            const candidates = pallet.stock.filter(d => clean(d.ItemCode) === item.itemCode && clean(d.DauTuan) === item.lot)
                .sort((a, b) => a.ID_TheKhoKienBTP_ChiTiet - b.ID_TheKhoKienBTP_ChiTiet);
            if (!candidates.length) fail(409, 'Không tìm thấy itemCode và dấu tuần trong kiện: ' + p.palletID);
            if (p.quantity > candidates.reduce((sum, d) => sum + Number(d.Available), 0)) fail(409, 'Số lượng xuất vượt tồn: ' + p.palletID);
            detailMap.set(JSON.stringify([p.palletID, item.itemCode, item.lot]), candidates.map(d => ({
                id: d.ID_TheKhoKienBTP_ChiTiet, remaining: Number(d.Available) })));
            pallet.actual += p.quantity;
        }
        const table = new sql.Table('dbo.ChiTietKienBTPsType');
        table.columns.add('ID_TheKhoKienBTP_ChiTiet', sql.Int);
        table.columns.add('ID_DonHang_LoSanXuat', sql.Int);
        table.columns.add('ID_DonHang_SanPham', sql.Int);
        table.columns.add('ID_DonHang', sql.Int);
        table.columns.add('SoLuong_XuatKho', sql.Decimal(18, 2));
        for (const link of links) {
            let remaining = link.quantity;
            for (const source of detailMap.get(JSON.stringify([link.palletID, link.itemCode, link.lot]))) {
                const quantity = Math.min(remaining, source.remaining);
                if (quantity > 0) table.rows.add(source.id, Number(link.row.ID_DonHang_LoSanXuat),
                    Number(link.row.ID_DonHang_SanPham), Number(link.row.ID_DonHang), quantity);
                remaining -= quantity; source.remaining -= quantity;
                if (!remaining) break;
            }
            if (remaining) fail(409, 'Tồn chi tiết kiện thay đổi, chưa thể xác nhận');
        }
        // Same confirmation writes as the app, without its procedure's per-order quantity rewrite.
        await new sql.Request(transaction).input('ID', sql.Int, Number(payload.orderID)).input('Picks', table).query(`
            DELETE FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien WHERE ID_PhieuXuatBTP=@ID;
            INSERT dbo.PhieuXuatBTP_ChiTiet_TheKhoKien
                (ID_PhieuXuatBTP,ID_DonHang,ID_DonHang_LoSanXuat,ID_DonHang_SanPham,ID_TheKhoKienBTP_ChiTiet,SoLuong_XuatKho)
                SELECT @ID,ID_DonHang,ID_DonHang_LoSanXuat,ID_DonHang_SanPham,ID_TheKhoKienBTP_ChiTiet,SoLuong_XuatKho FROM @Picks;
            UPDATE dbo.PhieuXuatBTP SET QrStatus=1,TrangThai=4 WHERE ID_PhieuXuatBTP=@ID;`);
        const waiting = [...palletMap.values()].some(p => p.initial > p.actual);
        await new sql.Request(transaction).input('ID', sql.Int, Number(payload.orderID))
            .input('Warehouse', sql.Int, cfg.warehouseID).input('Code', sql.NVarChar(255), payload.orderCode)
            .input('Status', sql.VarChar(24), waiting ? 'WAITING_RETURN' : 'COMPLETE')
            .input('Payload', sql.NVarChar(sql.MAX), fingerprint)
            .input('Callback', sql.NVarChar(sql.MAX), crane.outboundFingerprint(payload.status, payload.items)).query(`
                INSERT dbo.CraneWmsOutbound (ID_PhieuXuatBTP,ID_Kho,OrderCode,Status,DispatchStatus,RequestJson,CallbackJson)
                VALUES (@ID,@Warehouse,@Code,@Status,'WMS_CONFIRMED',@Payload,@Callback)`);
        const pallets = [];
        for (const [palletID, p] of palletMap) {
            const remaining = p.initial - p.actual;
            if (remaining > 0) await new sql.Request(transaction).input('ID_TheKhoKienBTP', sql.Int, p.ID_TheKhoKienBTP)
                .input('ID_ViTriKho', sql.Int, cfg.temporaryLocationID).input('ID_TaiKhoan', sql.Int, null)
                .input('LoaiThaoTac', sql.VarChar(20), 'DIEU_CHUYEN').execute('dbo.App_BTP_CapNhatViTriKien');
            const status = remaining > 0 ? 'WAITING_RETURN' : 'EXPORTED_FULL';
            await new sql.Request(transaction).input('ID', sql.Int, Number(payload.orderID))
                .input('Package', sql.Int, p.ID_TheKhoKienBTP).input('Pallet', sql.NVarChar(255), palletID)
                .input('Location', sql.Int, p.ID_ViTriKho).input('Initial', sql.Decimal(18, 2), p.initial)
                .input('Actual', sql.Decimal(18, 2), p.actual).input('Status', sql.VarChar(24), status).query(`
                    INSERT dbo.CraneWmsOutboundPallet (ID_PhieuXuatBTP,ID_TheKhoKienBTP,PalletID,OriginalLocationID,
                        InitialQuantity,PlannedQuantity,ActualQuantity,Status)
                    VALUES (@ID,@Package,@Pallet,@Location,@Initial,@Actual,@Actual,@Status)`);
            pallets.push({ palletID, exportedQuantity: p.actual, remainingQuantity: remaining, status,
                locationID: remaining > 0 ? cfg.temporaryLocationID : p.ID_ViTriKho });
        }
        const result = { success: true, orderID: payload.orderID, eventID: payload.eventID, duplicate: false,
            status: waiting ? 'WAITING_RETURN' : 'COMPLETE', pallets };
        await new sql.Request(transaction).input('Event', sql.NVarChar(255), payload.eventID)
            .input('ID', sql.Int, Number(payload.orderID)).input('Payload', sql.NVarChar(sql.MAX), fingerprint)
            .input('Result', sql.NVarChar(sql.MAX), JSON.stringify(result)).query(`
                INSERT dbo.CraneWmsOutboundEvent (EventID,ID_PhieuXuatBTP,PayloadJson,ResultJson) VALUES (@Event,@ID,@Payload,@Result)`);
        await transaction.commit();
        return result;
    } catch (error) {
        try { await transaction.rollback(); } catch (_) { /* preserve original failure */ }
        throw error;
    }
}

async function searchAppOrders(pool, body, isTest) {
    const cfg = await config(pool, isTest);
    const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(body.PageSize) || 20)));
    const pageIndex = Math.max(0, Math.trunc(Number(body.PageIndex) || 0));
    if (!Number.isSafeInteger(pageIndex * pageSize) || pageIndex * pageSize > 2147483647) fail(400, 'Trang không hợp lệ');
    const result = await pool.request().input('Warehouse', sql.Int, cfg.warehouseID)
        .input('User', sql.Int, crane.positiveId(body.IdTaiKhoanDangNhap) || 0)
        .input('Search', sql.NVarChar(255), String(body.soPhieu || '').trim())
        .input('Type', sql.Int, crane.positiveId(body.loaiPhieu))
        .input('Confirmed', sql.Bit, body.trangThai ?? null)
        .input('Skip', sql.Int, pageIndex * pageSize).input('Take', sql.Int, pageSize).query(`
            SELECT p.ID_PhieuXuatBTP AS id,p.So_PhieuXuatBTP AS soPhieu,p.Ngay_XuatBTP AS ngayXuat,
                p.ID_KhoXuat AS idKhoXuat,k.Ten_Kho AS khoXuat,h.Ten_HinhThucXuatBTP AS loaiPhieu,
                ISNULL(p.QrStatus,0) AS trangThai,o.Status AS wmsStatus
            FROM dbo.PhieuXuatBTP p
            JOIN dbo.DM_Kho k ON k.ID_Kho=p.ID_KhoXuat
            LEFT JOIN dbo.DM_HinhThucXuatBTP h ON h.ID_HinhThucXuatBTP=p.ID_HinhThucXuatBTP
            LEFT JOIN dbo.CraneWmsOutbound o ON o.ID_PhieuXuatBTP=p.ID_PhieuXuatBTP
            WHERE p.TonTai=1 AND p.ID_KhoXuat=@Warehouse AND (p.TrangThai<>5 OR o.ID_PhieuXuatBTP IS NOT NULL)
                AND (@User=1 OR EXISTS(SELECT 1 FROM dbo.PQ_TaiKhoan_Kho_TM q
                    WHERE q.ID_Kho=p.ID_KhoXuat AND q.ID_TaiKhoanDangNhap=@User AND q.Quyen=1))
                AND (@Search='' OR p.So_PhieuXuatBTP LIKE '%'+@Search+'%')
                AND (@Type IS NULL OR p.ID_HinhThucXuatBTP=@Type)
                AND (@Confirmed IS NULL OR ISNULL(p.QrStatus,0)=@Confirmed)
            ORDER BY p.Ngay_XuatBTP DESC,p.ID_PhieuXuatBTP DESC OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY`);
    return { data: result.recordset, pageSize, pageIndex };
}

module.exports = { normalize, allocate, config, loadDetails, confirm, searchAppOrders };
