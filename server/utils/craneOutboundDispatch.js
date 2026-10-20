const axios = require('axios');
const sql = require('mssql');
const DEFAULT_URL = 'https://z76-local.vercel.app/api/share/wmsOutbound';

function getDispatchErrorMessage(error) {
    const data = error?.response?.data;
    const description = data?.detail || data?.details || data?.errors;
    const detail = typeof description === 'string' ? description : description ? JSON.stringify(description) : '';
    const wmsMessage = data?.res_state?.wms_outbound?.res_msg || data?.res_state?.http?.res_msg;
    const message = [data?.message || data?.msg || data?.error, wmsMessage, detail].filter(Boolean).join(' | ');
    return String(message || (typeof data === 'string' ? data : '') || error?.message || 'Không gửi được WMS').slice(0, 1000);
}

function buildItems(rows, skipLot = {}) {
    if (skipLot == null) skipLot = {};
    const codes = [...new Set(rows.map(row => String(row.ItemCode || '').trim()))];
    // A plain array applies to every SKU; a map allows different exclusions per SKU.
    const exclusions = Array.isArray(skipLot)
        ? Object.fromEntries(codes.map(code => [code, skipLot]))
        : skipLot;
    if (!exclusions || typeof exclusions !== 'object' ||
        Object.values(exclusions).some(value => !Array.isArray(value)) ||
        Object.keys(exclusions).some(code => !codes.includes(code))) {
        const error = new Error('skipLot phải là mảng dấu tuần hoặc object theo itemCode trên phiếu');
        error.status = 400;
        throw error;
    }
    const normalized = new Map();
    for (const [code, values] of Object.entries(exclusions)) {
        if (values.length > 100 || values.some(lot => typeof lot !== 'string' ||
            !lot.trim() || lot.trim().length > 50)) {
            const error = new Error('Mỗi skipLot phải là chuỗi dấu tuần không rỗng (tối đa 50 ký tự)');
            error.status = 400;
            throw error;
        }
        normalized.set(code, [...new Set(values.map(lot => lot.trim()))]);
    }
    return rows.map(row => {
        const itemCode = String(row.ItemCode || '').trim();
        const lot = row.DauTuan == null ? '' : String(row.DauTuan).trim();
        const excluded = normalized.get(itemCode) || [];
        if (lot && excluded.includes(lot)) {
            const error = new Error(`Dấu tuần ${lot} của mã ${itemCode} vừa được chỉ định xuất, vừa nằm trong skipLot`);
            error.status = 422;
            throw error;
        }
        return {
            itemCode,
            itemName: String(row.Ten_SanPham || '').trim(),
            ...(lot ? { lot } : {}),
            ...(excluded.length ? { skipLot: excluded } : {}),
            quantity: Number(row.SoLuong_XuatKho),
        };
    });
}

function savedSkipLot(requestJson) {
    if (!requestJson) return {};
    try {
        const items = JSON.parse(requestJson).items;
        if (!Array.isArray(items)) return {};
        return Object.fromEntries(items
            .filter(item => item && typeof item.itemCode === 'string' && Array.isArray(item.skipLot) && item.skipLot.length)
            .map(item => [item.itemCode, item.skipLot]));
    } catch (_) { return {}; }
}

async function status(pool, id) {
    const result = await pool.request().input('ID', sql.Int, id)
        .query('SELECT DispatchStatus, DispatchAttempts, DispatchError, Revision, RequestJson FROM dbo.CraneWmsOutboundDispatch WHERE ID_PhieuXuatBTP=@ID');
    const row = result.recordset[0];
    if (!row) return null;
    const { RequestJson, ...fields } = row;
    return { ...fields, skipLot: savedSkipLot(RequestJson) };
}

async function availableLots(pool, id, warehouseID) {
    const order = (await pool.request().input('ID', sql.Int, id)
        .query('SELECT ID_KhoXuat FROM dbo.PhieuXuatBTP WHERE ID_PhieuXuatBTP=@ID AND TonTai=1')).recordset[0];
    if (!order || Number(order.ID_KhoXuat) !== warehouseID) return null;
    const details = await pool.request().input('ID_PhieuXuatBTP', sql.Int, id)
        .execute('dbo.App_BTP_PhieuXuat_ThongTinChiTiet');
    const codes = [...new Set((details.recordsets?.[1] || [])
        .map(row => String(row.ItemCode || '').trim()).filter(Boolean))];
    if (!codes.length) return [];
    const request = pool.request().input('WarehouseID', sql.Int, warehouseID);
    const placeholders = codes.map((code, index) => {
        request.input(`Item${index}`, sql.NVarChar(150), code);
        return `@Item${index}`;
    });
    const result = await request.query(`
        SELECT d.ItemCode AS itemCode, LTRIM(RTRIM(d.DauTuan)) AS weekMark,
               SUM(d.SoLuong-ISNULL(used.DaXuat,0)) AS stockQuantity
        FROM dbo.TheKhoKienBTP_ChiTiet d
        INNER JOIN dbo.TheKhoKienBTP k ON k.ID_TheKhoKienBTP=d.ID_TheKhoKienBTP AND ISNULL(k.TonTai,1)=1
        INNER JOIN dbo.DM_Kho_ViTri vt ON vt.ID_ViTriKho=k.ID_ViTriKho AND vt.ID_Kho=@WarehouseID
        LEFT JOIN (
            SELECT x.ID_TheKhoKienBTP_ChiTiet, SUM(x.SoLuong_XuatKho) AS DaXuat
            FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien x
            JOIN dbo.PhieuXuatBTP px ON px.ID_PhieuXuatBTP=x.ID_PhieuXuatBTP AND px.TonTai=1
            GROUP BY x.ID_TheKhoKienBTP_ChiTiet
        ) used ON used.ID_TheKhoKienBTP_ChiTiet=d.ID_TheKhoKienBTP_ChiTiet
        WHERE ISNULL(d.TonTai,1)=1 AND vt.TonTai=1 AND vt.SuDung=1
          AND vt.MaViTriKho NOT IN (N'CT-TEMP',N'CT-TEMP-TEST')
          AND d.ItemCode IN (${placeholders.join(',')})
          AND NULLIF(LTRIM(RTRIM(d.DauTuan)), '') IS NOT NULL
          AND d.SoLuong-ISNULL(used.DaXuat,0)>0
          AND NOT EXISTS (
              SELECT 1 FROM dbo.CraneWmsOutboundPallet p
              WHERE p.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP
                AND p.Status IN ('WAITING_WMS','FAILED_RETRY','WAITING_RETURN')
          )
        GROUP BY d.ItemCode, LTRIM(RTRIM(d.DauTuan))
        ORDER BY d.ItemCode, weekMark`);
    return result.recordset || [];
}

async function dispatch(pool, id, warehouseID, post = axios.post, requestedSkipLot) {
    const order = (await pool.request().input('ID', sql.Int, id).query(`
        SELECT ID_PhieuXuatBTP, ID_KhoXuat, So_PhieuXuatBTP, Ngay_XuatBTP, QrStatus
        FROM dbo.PhieuXuatBTP WHERE ID_PhieuXuatBTP=@ID AND TonTai=1 AND ISNULL(TrangThai,0)<>5`)).recordset[0];
    if (!order || Number(order.ID_KhoXuat) !== warehouseID) return { error: 'Phiếu không thuộc kho cầu trục', status: 404 };
    if (order.QrStatus) return { error: 'Phiếu đã xác nhận ERP, không thể gửi yêu cầu xuất mới', status: 409 };
    const previous = (await pool.request().input('ID', sql.Int, id)
        .query('SELECT RequestJson, DispatchStatus FROM dbo.CraneWmsOutboundDispatch WHERE ID_PhieuXuatBTP=@ID')).recordset[0];
    let payload;
    let serialized;
    if (previous?.RequestJson && requestedSkipLot === undefined) {
        // Retry the exact persisted WMS request, even if ERP details have since changed.
        try {
            payload = JSON.parse(previous.RequestJson);
            if (payload.orderID !== String(id) || payload.orderType !== 'OUTBOUND' || !Array.isArray(payload.items))
                throw new Error('Invalid saved outbound request');
            serialized = previous.RequestJson;
        } catch (_) {
            return { error: 'Dữ liệu yêu cầu WMS đã lưu không hợp lệ', status: 409 };
        }
    } else {
        const details = await pool.request().input('ID_PhieuXuatBTP', sql.Int, id)
            .execute('dbo.App_BTP_PhieuXuat_ThongTinChiTiet');
        let items;
        try { items = buildItems(details.recordsets?.[1] || [], requestedSkipLot); }
        catch (error) { return { error: error.message, status: error.status || 400 }; }
        const date = new Date(order.Ngay_XuatBTP);
        if (!items.length || !Number.isFinite(date.getTime()) || items.some(item =>
            !item.itemCode || !item.itemName || !Number.isSafeInteger(item.quantity) || item.quantity <= 0))
            return { error: 'Phiếu thiếu mã hàng, tên hàng hoặc số lượng hợp lệ', status: 422 };
        payload = { orderID: String(id), orderCode: order.So_PhieuXuatBTP,
            orderType: 'OUTBOUND', date: date.toISOString(), items };
        serialized = JSON.stringify(payload);
        if (!['REJECTED', 'FAILED'].includes(previous?.DispatchStatus) && ((previous?.RequestJson && previous.RequestJson !== serialized) ||
            (previous && !previous.RequestJson && Object.keys(savedSkipLot(serialized)).length))) {
            return { error: 'Phiếu đã gửi WMS; không thể thay đổi skipLot hoặc nội dung với cùng orderID', status: 409 };
        }
    }
    const claimed = await pool.request().input('ID', sql.Int, id)
        .input('Payload', sql.NVarChar(sql.MAX), serialized).query(`
        BEGIN TRY
          BEGIN TRANSACTION;
          UPDATE dbo.CraneWmsOutboundDispatch SET DispatchStatus='SENDING', DispatchAttempts=DispatchAttempts+1,
              Revision=Revision+CASE WHEN DispatchStatus='REJECTED' OR
                    (DispatchStatus='FAILED' AND ISNULL(RequestJson,'')<>@Payload) THEN 1 ELSE 0 END,
              DispatchError=NULL,
              RequestJson=CASE WHEN DispatchStatus IN ('REJECTED','FAILED') THEN @Payload ELSE COALESCE(RequestJson,@Payload) END,
              UpdatedAt=SYSUTCDATETIME()
          OUTPUT inserted.DispatchAttempts AS ClaimAttempt, inserted.Revision AS ClaimRevision
          WHERE ID_PhieuXuatBTP=@ID AND
            ((DispatchStatus IN ('REJECTED','FAILED')) OR
             ((RequestJson=@Payload OR (RequestJson IS NULL AND DispatchStatus='FAILED')) AND
              (DispatchStatus='FAILED' OR (DispatchStatus='SENDING' AND UpdatedAt<DATEADD(MINUTE,-5,SYSUTCDATETIME())))));
          IF @@ROWCOUNT=0 AND NOT EXISTS(
              SELECT 1 FROM dbo.CraneWmsOutboundDispatch WITH (UPDLOCK, HOLDLOCK) WHERE ID_PhieuXuatBTP=@ID)
          BEGIN
              INSERT dbo.CraneWmsOutboundDispatch (ID_PhieuXuatBTP,RequestJson,DispatchStatus,DispatchAttempts)
              OUTPUT inserted.DispatchAttempts AS ClaimAttempt, inserted.Revision AS ClaimRevision VALUES (@ID,@Payload,'SENDING',1);
          END;
          COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
          IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
          THROW;
        END CATCH;`);
    const claim = (claimed.recordsets || []).flat().find(row => row.ClaimAttempt !== undefined);
    if (!claim) {
        const current = await status(pool, id);
        if (current?.DispatchStatus === 'SENT') {
            const saved = await pool.request().input('ID', sql.Int, id)
                .query('SELECT RequestJson FROM dbo.CraneWmsOutboundDispatch WHERE ID_PhieuXuatBTP=@ID');
            if (saved.recordset[0]?.RequestJson === serialized)
                return { dispatch: current, alreadySent: true, error: null, status: 200 };
            if (!saved.recordset[0]?.RequestJson && !Object.keys(savedSkipLot(serialized)).length)
                return { dispatch: current, alreadySent: true, error: null, status: 200 };
            return { dispatch: current, error: 'Phiếu đã gửi WMS; không thể thay đổi skipLot hoặc nội dung với cùng orderID', status: 409 };
        }
        return { dispatch: current,
            error: 'Phiếu đang gửi hoặc dữ liệu phiếu đã thay đổi; kiểm tra trạng thái trước khi gửi lại', status: 409 };
    }
    let errorMessage = null;
    try {
        const response = await post(process.env.WMS_OUTBOUND_URL || DEFAULT_URL, payload, {
            timeout: 10000, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `outbound-${id}` },
        });
        if (response.status < 200 || response.status >= 300) throw new Error(`WMS HTTP ${response.status}`);
    } catch (error) {
        const responseStatus = error.response?.status;
        errorMessage = `${responseStatus ? `HTTP ${responseStatus}: ` : ''}${getDispatchErrorMessage(error)}`.slice(0, 1000);
    }
    await pool.request().input('ID', sql.Int, id)
        .input('Error', sql.NVarChar(1000), errorMessage)
        .input('State', sql.VarChar(12), errorMessage ? 'FAILED' : 'SENT')
        .input('Attempt', sql.Int, claim.ClaimAttempt)
        .query(`UPDATE dbo.CraneWmsOutboundDispatch SET DispatchStatus=@State,DispatchError=@Error,
            UpdatedAt=SYSUTCDATETIME() WHERE ID_PhieuXuatBTP=@ID AND DispatchStatus='SENDING'
            AND DispatchAttempts=@Attempt`);
    return { dispatch: await status(pool, id), error: errorMessage, status: errorMessage ? 502 : 200 };
}

async function rejectInsufficientStock(pool, body) {
    const id = Number(body?.orderID);
    if (!Number.isSafeInteger(id) || id <= 0 || body?.orderType !== 'OUTBOUND' ||
        body?.status !== 'REJECTED' || body?.reasonCode !== 'INSUFFICIENT_STOCK' ||
        typeof body?.eventID !== 'string' || !body.eventID.trim() || body.eventID.length > 255)
        return { error: 'Cần orderID, orderType, eventID và REJECTED/INSUFFICIENT_STOCK', status: 400 };
    const reason = String(body.message || 'WMS từ chối: không đủ tồn kho').slice(0, 1000);
    const result = await pool.request().input('ID', sql.Int, id)
        .input('Reason', sql.NVarChar(1000), reason)
        .query(`UPDATE d SET DispatchStatus='REJECTED',DispatchError=@Reason,UpdatedAt=SYSUTCDATETIME()
                OUTPUT inserted.ID_PhieuXuatBTP
                FROM dbo.CraneWmsOutboundDispatch d
                JOIN dbo.PhieuXuatBTP p ON p.ID_PhieuXuatBTP=d.ID_PhieuXuatBTP
                WHERE d.ID_PhieuXuatBTP=@ID AND d.DispatchStatus='SENT'
                  AND ISNULL(p.QrStatus,0)=0 AND ISNULL(p.TrangThai,0)<>5
                  AND NOT EXISTS (SELECT 1 FROM dbo.CraneWmsOutbound o
                                  WHERE o.ID_PhieuXuatBTP=@ID)`);
    if (!result.recordset?.length) return { error: 'Phiếu không ở trạng thái chờ WMS hoặc đã có kết quả xuất', status: 409 };
    return { ok: true, orderID: String(id), status: 'REJECTED', reasonCode: 'INSUFFICIENT_STOCK' };
}

module.exports = { status, dispatch, buildItems, availableLots, savedSkipLot, rejectInsufficientStock };
