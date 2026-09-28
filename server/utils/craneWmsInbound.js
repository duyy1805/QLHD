const axios = require('axios');
const sql = require('mssql');

const DEFAULT_URL = 'https://z76-local.vercel.app/api/share/wmsInbound';

function buildPayload(header, rows) {
    const date = new Date(header.Ngay_NhapBTP);
    const pallets = new Map();
    for (const row of rows) {
        const palletID = String(row.QRCode || '').trim();
        const itemCode = String(row.ItemCode || '').trim();
        const itemName = String(row.Ten_SanPham || '').trim();
        const Lot = String(row.DauTuan || '').trim();
        const quantity = Number(row.SoLuong);
        if (!palletID || !itemCode || !itemName || !Lot || !Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('Kiện nhập cầu trục thiếu QR, mã/tên hàng, dấu tuần hoặc số lượng để gửi WMS');
        }
        if (!pallets.has(palletID)) pallets.set(palletID, { palletID, items: [] });
        pallets.get(palletID).items.push({ itemCode, itemName, Lot, quantity });
    }
    if (!header.So_PhieuNhapBTP || !Number.isFinite(date.getTime()) || !pallets.size) {
        throw new Error('Phiếu nhập cầu trục thiếu mã phiếu, ngày nhập hoặc kiện để gửi WMS');
    }
    return {
        orderID: String(header.ID_PhieuNhapBTP),
        orderCode: String(header.So_PhieuNhapBTP),
        orderType: 'INBOUND',
        date: date.toISOString(),
        pallets: [...pallets.values()],
    };
}

async function getWarehouseID(executor, orderID) {
    const result = await new sql.Request(executor).input('OrderID', sql.Int, orderID)
        .query('SELECT ID_KhoNhap FROM dbo.PhieuNhapBTP WHERE ID_PhieuNhapBTP=@OrderID AND TonTai=1');
    return Number(result.recordset[0]?.ID_KhoNhap) || null;
}

async function testPendingLocationID(executor) {
    const result = await new sql.Request(executor).query(`
        SELECT ID_ViTriKho FROM dbo.DM_Kho_ViTri
        WHERE ID_Kho=5 AND MaViTriKho=N'CT-TEMP-TEST' AND TonTai=1 AND SuDung=1`);
    if (result.recordset.length !== 1) throw new Error('DB test chưa có vị trí tạm CT-TEMP-TEST của kho ID 5');
    return Number(result.recordset[0].ID_ViTriKho);
}

// SQL requires a location before confirming. This is a logical waiting location,
// not the physical shelf; WMS later replaces it through location-callback.
async function stagePackages(executor, orderID, warehouseID, pendingLocationID, submittedPackages) {
    const location = await new sql.Request(executor)
        .input('WarehouseID', sql.Int, warehouseID)
        .input('LocationID', sql.Int, pendingLocationID)
        .query(`SELECT ID_ViTriKho FROM dbo.DM_Kho_ViTri WITH (HOLDLOCK)
                WHERE ID_Kho=@WarehouseID AND ID_ViTriKho=@LocationID AND TonTai=1 AND SuDung=1`);
    if (location.recordset.length !== 1) throw new Error('Vị trí tạm nhập cầu trục không thuộc kho hoặc chưa sử dụng');
    const rows = await new sql.Request(executor).input('OrderID', sql.Int, orderID)
        .query(`SELECT ID_TheKhoKienBTP, QRCode FROM dbo.TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK)
                WHERE ID_PhieuNhapBTP=@OrderID AND TonTai=1`);
    const submitted = new Set(submittedPackages.map(item => Number(item.idTheKhoKienBTP)));
    if (!rows.recordset.length || submitted.size !== rows.recordset.length ||
        rows.recordset.some(row => !submitted.has(Number(row.ID_TheKhoKienBTP)) || !String(row.QRCode || '').trim())) {
        throw new Error('Danh sách kiện nhập hoặc QR không khớp dữ liệu đã lưu');
    }
    await new sql.Request(executor)
        .input('OrderID', sql.Int, orderID)
        .input('LocationID', sql.Int, pendingLocationID)
        .query(`UPDATE dbo.TheKhoKienBTP SET ID_ViTriKho=@LocationID
                WHERE ID_PhieuNhapBTP=@OrderID AND TonTai=1`);
}

// Called inside the same transaction as App_XacNhanPhieuNhap_BTP.
async function enqueue(executor, orderID, warehouseID) {
    const result = await new sql.Request(executor).input('OrderID', sql.Int, orderID)
        .query(`SELECT p.ID_PhieuNhapBTP, p.So_PhieuNhapBTP, p.Ngay_NhapBTP, p.ID_KhoNhap,
                       k.QRCode, d.ItemCode, d.Ten_SanPham, d.DauTuan, d.SoLuong
                FROM dbo.PhieuNhapBTP p
                JOIN dbo.TheKhoKienBTP k ON k.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP AND k.TonTai=1
                JOIN dbo.TheKhoKienBTP_ChiTiet d ON d.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP AND d.TonTai=1
                WHERE p.ID_PhieuNhapBTP=@OrderID AND p.TonTai=1
                ORDER BY k.ID_TheKhoKienBTP, d.ID_TheKhoKienBTP_ChiTiet`);
    const header = result.recordset[0];
    if (!header || Number(header.ID_KhoNhap) !== warehouseID) throw new Error('Phiếu nhập không thuộc kho cầu trục');
    const payload = buildPayload(header, result.recordset);
    await new sql.Request(executor)
        .input('OrderID', sql.Int, orderID)
        .input('WarehouseID', sql.Int, warehouseID)
        .input('Payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
        .query(`INSERT dbo.CraneWmsInbound (ID_PhieuNhapBTP, ID_Kho, RequestJson, DispatchStatus)
                VALUES (@OrderID, @WarehouseID, @Payload, 'PENDING')`);
    return payload;
}

async function status(pool, orderID) {
    const result = await pool.request().input('OrderID', sql.Int, orderID)
        .query(`SELECT ID_PhieuNhapBTP, DispatchStatus, DispatchAttempts, ResponseStatus,
                       DispatchError, SentAt, UpdatedAt
                FROM dbo.CraneWmsInbound WHERE ID_PhieuNhapBTP=@OrderID`);
    return result.recordset[0] || null;
}

async function dispatch(pool, orderID, post = axios.post) {
    const claimed = await pool.request().input('OrderID', sql.Int, orderID)
        .query(`UPDATE dbo.CraneWmsInbound SET DispatchStatus='SENDING',
                    DispatchAttempts=DispatchAttempts+1, DispatchError=NULL, UpdatedAt=SYSUTCDATETIME()
                OUTPUT inserted.RequestJson
                WHERE ID_PhieuNhapBTP=@OrderID AND
                      (DispatchStatus IN ('PENDING','FAILED') OR
                       (DispatchStatus='SENDING' AND UpdatedAt<DATEADD(MINUTE,-5,SYSUTCDATETIME())))`);
    if (!claimed.recordset.length) return status(pool, orderID);

    let responseStatus = null;
    let dispatchError = null;
    try {
        const response = await post(process.env.WMS_INBOUND_URL || DEFAULT_URL,
            JSON.parse(claimed.recordset[0].RequestJson), {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `inbound-${orderID}` },
            });
        responseStatus = response.status;
        if (responseStatus < 200 || responseStatus >= 300) throw new Error(`WMS HTTP ${responseStatus}`);
    } catch (error) {
        responseStatus = error.response?.status || responseStatus;
        dispatchError = String(error.response?.data?.message || error.message || 'Không gửi được WMS').slice(0, 1000);
    }
    await pool.request().input('OrderID', sql.Int, orderID)
        .input('NextStatus', sql.VarChar(12), dispatchError ? 'FAILED' : 'SENT')
        .input('ResponseStatus', sql.Int, responseStatus)
        .input('DispatchError', sql.NVarChar(1000), dispatchError)
        .query(`UPDATE dbo.CraneWmsInbound SET DispatchStatus=@NextStatus,
                    ResponseStatus=@ResponseStatus, DispatchError=@DispatchError,
                    SentAt=CASE WHEN @NextStatus='SENT' THEN SYSUTCDATETIME() ELSE SentAt END,
                    UpdatedAt=SYSUTCDATETIME()
                WHERE ID_PhieuNhapBTP=@OrderID AND DispatchStatus='SENDING'`);
    return status(pool, orderID);
}

module.exports = { buildPayload, getWarehouseID, testPendingLocationID, stagePackages, enqueue, dispatch, status };
