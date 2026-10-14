const axios = require('axios');
const sql = require('mssql');
const DEFAULT_URL = 'https://z76-local.vercel.app/api/share/wmsOutbound';

async function status(pool, id) {
    const result = await pool.request().input('ID', sql.Int, id)
        .query('SELECT DispatchStatus, DispatchAttempts, DispatchError FROM dbo.CraneWmsDispatch WHERE ID_PhieuXuatBTP=@ID');
    return result.recordset[0] || null;
}

async function dispatch(pool, id, warehouseID, post = axios.post) {
    const order = (await pool.request().input('ID', sql.Int, id).query(`
        SELECT ID_PhieuXuatBTP, ID_KhoXuat, So_PhieuXuatBTP, Ngay_XuatBTP, QrStatus
        FROM dbo.PhieuXuatBTP WHERE ID_PhieuXuatBTP=@ID AND TonTai=1 AND ISNULL(TrangThai,0)<>5`)).recordset[0];
    if (!order || Number(order.ID_KhoXuat) !== warehouseID) return { error: 'Phiếu không thuộc kho cầu trục', status: 404 };
    if (order.QrStatus) return { error: 'Phiếu đã xác nhận ERP, không thể gửi yêu cầu xuất mới', status: 409 };
    const details = await pool.request().input('ID_PhieuXuatBTP', sql.Int, id)
        .execute('dbo.App_BTP_PhieuXuat_ThongTinChiTiet');
    const items = (details.recordsets?.[1] || []).map(row => ({
        itemCode: String(row.ItemCode || '').trim(),
        itemName: String(row.Ten_SanPham || '').trim(),
        ...(row.DauTuan ? { lot: String(row.DauTuan).trim() } : {}),
        quantity: Number(row.SoLuong_XuatKho),
    }));
    const date = new Date(order.Ngay_XuatBTP);
    if (!items.length || !Number.isFinite(date.getTime()) || items.some(item =>
        !item.itemCode || !item.itemName || !Number.isSafeInteger(item.quantity) || item.quantity <= 0))
        return { error: 'Phiếu thiếu mã hàng, tên hàng hoặc số lượng hợp lệ', status: 422 };
    const payload = { orderID: String(id), orderCode: order.So_PhieuXuatBTP,
        orderType: 'OUTBOUND', date: date.toISOString(), items };
    const serialized = JSON.stringify(payload);
    const claimed = await pool.request().input('ID', sql.Int, id)
        .input('Payload', sql.NVarChar(sql.MAX), serialized).query(`
        UPDATE dbo.CraneWmsDispatch SET DispatchStatus='SENDING', DispatchAttempts=DispatchAttempts+1,
            DispatchError=NULL, UpdatedAt=SYSUTCDATETIME()
        OUTPUT inserted.ID_PhieuXuatBTP
        WHERE ID_PhieuXuatBTP=@ID AND RequestJson=@Payload AND
          (DispatchStatus IN ('FAILED','PENDING') OR (DispatchStatus='SENDING' AND UpdatedAt<DATEADD(MINUTE,-5,SYSUTCDATETIME())));
        IF @@ROWCOUNT=0 AND NOT EXISTS(SELECT 1 FROM dbo.CraneWmsDispatch WHERE ID_PhieuXuatBTP=@ID)
        BEGIN
            INSERT dbo.CraneWmsDispatch (ID_PhieuXuatBTP,RequestJson,DispatchStatus,DispatchAttempts)
            OUTPUT inserted.ID_PhieuXuatBTP VALUES (@ID,@Payload,'SENDING',1);
        END`);
    if (!claimed.recordsets?.some(rows => rows.length)) {
        const current = await status(pool, id);
        return { dispatch: current, error: current?.DispatchStatus === 'SENT' ? null :
            'Phiếu đang gửi hoặc dữ liệu phiếu đã thay đổi; kiểm tra trạng thái trước khi gửi lại', status: 409 };
    }
    let errorMessage = null;
    try {
        const response = await post(process.env.WMS_OUTBOUND_URL || DEFAULT_URL, payload, {
            timeout: 10000, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `outbound-${id}` },
        });
        if (response.status < 200 || response.status >= 300) throw new Error(`WMS HTTP ${response.status}`);
    } catch (error) {
        errorMessage = String(error.response?.data?.message || error.message || 'Không gửi được WMS').slice(0, 1000);
    }
    await pool.request().input('ID', sql.Int, id)
        .input('Error', sql.NVarChar(1000), errorMessage)
        .input('State', sql.VarChar(12), errorMessage ? 'FAILED' : 'SENT')
        .query(`UPDATE dbo.CraneWmsDispatch SET DispatchStatus=@State,DispatchError=@Error,
            UpdatedAt=SYSUTCDATETIME() WHERE ID_PhieuXuatBTP=@ID AND DispatchStatus='SENDING'`);
    return { dispatch: await status(pool, id), error: errorMessage, status: errorMessage ? 502 : 200 };
}

module.exports = { status, dispatch };
