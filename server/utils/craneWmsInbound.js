const axios = require('axios');
const sql = require('mssql');

const DEFAULT_URL = 'https://z76-local.vercel.app/api/share/wmsInbound';

function getDispatchErrorMessage(error) {
    const data = error?.response?.data;
    return String(data?.message || data?.detail || data?.error || error?.message || 'Không gửi được WMS').slice(0, 1000);
}

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

function buildPackagePayload(header, rows) {
    const payload = buildPayload(header, rows);
    if (payload.pallets.length !== 1) throw new Error('Mỗi yêu cầu WMS chỉ được chứa một kiện');
    return payload;
}

function quantitiesFit(allowedRows, requestedRows) {
    const keys = ['ID_KeHoachSanXuat','ID_DonHang_SanPham','ID_DonHang','ID_DonHang_LoSanXuat'];
    const grouped = new Map();
    for (const row of requestedRows) {
        const values = keys.map(key => Number(row[key]) || 0);
        const key = values.join('|');
        grouped.set(key, (grouped.get(key) || 0) + Number(row.SoLuong || 0));
    }
    const requested = [...grouped].map(([key, quantity]) => ({ values: key.split('|').map(Number), quantity }))
        .sort((a,b) => b.values.filter(Boolean).length-a.values.filter(Boolean).length);
    const allowed = allowedRows.map(row => ({ values: keys.map(key => Number(row[key]) || 0), remaining: Number(row.SoLuong_NhapKho || 0) }));
    for (const item of requested) {
        const candidates = allowed.filter(limit => item.values.every((value,index) => value===0 || limit.values[index]===0 || value===limit.values[index]));
        if (candidates.reduce((sum,row) => sum+row.remaining,0) < item.quantity-0.000001) return false;
        let left=item.quantity;
        for (const limit of candidates) { const used=Math.min(limit.remaining,left); limit.remaining-=used; left-=used; if(left<=0.000001) break; }
    }
    return allowed.every(row => Math.abs(row.remaining)<0.000001);
}

async function assertPackageUnlocked(executor, packageID) {
    const result = await new sql.Request(executor).input('PackageID', sql.Int, packageID).query(`
        IF OBJECT_ID(N'dbo.CraneWmsInboundPackage', N'U') IS NOT NULL
            SELECT TOP (1) ID_TheKhoKienBTP FROM dbo.CraneWmsInboundPackage
            WHERE ID_TheKhoKienBTP=@PackageID`);
    if (result.recordset?.length) throw new Error('Kiện đã gửi WMS, không thể sửa hoặc xóa');
}

async function enqueuePackage(executor, orderID, packageID, warehouseID) {
    const result = await new sql.Request(executor)
        .input('OrderID', sql.Int, orderID)
        .input('PackageID', sql.Int, packageID)
        .query(`SELECT p.ID_PhieuNhapBTP,p.So_PhieuNhapBTP,p.Ngay_NhapBTP,p.ID_KhoNhap,
                       k.ID_TheKhoKienBTP,k.QRCode,d.ItemCode,d.Ten_SanPham,d.DauTuan,d.SoLuong
                FROM dbo.PhieuNhapBTP p
                JOIN dbo.TheKhoKienBTP k ON k.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP AND k.TonTai=1
                JOIN dbo.TheKhoKienBTP_ChiTiet d ON d.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP AND d.TonTai=1
                WHERE p.ID_PhieuNhapBTP=@OrderID AND k.ID_TheKhoKienBTP=@PackageID AND p.TonTai=1
                ORDER BY d.ID_TheKhoKienBTP_ChiTiet`);
    const header = result.recordset[0];
    if (!header || Number(header.ID_KhoNhap) !== Number(warehouseID)) throw new Error('Kiện không thuộc phiếu nhập kho cầu trục');
    const planned = await new sql.Request(executor).input('ID_PhieuNhapBTP', sql.Int, orderID)
        .execute('App_PhieuNhapBTP_ThongTinChiTiet');
    const requestedByItem = new Map();
    for (const row of planned.recordsets?.[1] || []) {
        const key=String(row.ItemCode || '').trim().toUpperCase();
        requestedByItem.set(key,(requestedByItem.get(key)||0)+Number(row.SoLuong_NhapKho||0));
    }
    const allocated = await new sql.Request(executor).input('OrderID', sql.Int, orderID).query(`
        SELECT UPPER(LTRIM(RTRIM(d.ItemCode))) ItemCode,SUM(d.SoLuong) Allocated
        FROM dbo.TheKhoKienBTP_ChiTiet d JOIN dbo.TheKhoKienBTP k ON k.ID_TheKhoKienBTP=d.ID_TheKhoKienBTP
        WHERE k.ID_PhieuNhapBTP=@OrderID AND k.TonTai=1 AND d.TonTai=1
        GROUP BY UPPER(LTRIM(RTRIM(d.ItemCode)))`);
    if (allocated.recordset.some(row => !requestedByItem.has(row.ItemCode) || Number(row.Allocated)>requestedByItem.get(row.ItemCode)+0.000001))
        throw new Error('Số lượng BTP vượt quá số lượng của phiếu nhập');
    const payload = buildPackagePayload(header, result.recordset);
    const palletID = payload.pallets[0].palletID;
    await new sql.Request(executor)
        .input('OrderID', sql.Int, orderID).input('WarehouseID', sql.Int, warehouseID)
        .input('PackageID', sql.Int, packageID).input('PalletID', sql.NVarChar(255), palletID)
        .input('Payload', sql.NVarChar(sql.MAX), JSON.stringify(payload)).query(`
            IF NOT EXISTS (SELECT 1 FROM dbo.CraneWmsInbound WITH (UPDLOCK,HOLDLOCK) WHERE ID_PhieuNhapBTP=@OrderID)
                INSERT dbo.CraneWmsInbound (ID_PhieuNhapBTP,ID_Kho,RequestJson,DispatchStatus)
                VALUES (@OrderID,@WarehouseID,@Payload,'PENDING');
            IF EXISTS (SELECT 1 FROM dbo.CraneWmsInboundPackage WITH (UPDLOCK,HOLDLOCK)
                       WHERE ID_TheKhoKienBTP=@PackageID)
                THROW 51071, N'Kiện đã được chốt gửi WMS', 1;
            INSERT dbo.CraneWmsInboundPackage
                (ID_PhieuNhapBTP,ID_TheKhoKienBTP,PalletID,RequestJson,DispatchStatus)
            VALUES (@OrderID,@PackageID,@PalletID,@Payload,'PENDING');`);
    return payload;
}

async function assignQrAndEnqueue(pool, { orderID, packageID, qrCode, warehouseID }) {
    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
        await assertPackageUnlocked(tx, packageID);
        const target = await new sql.Request(tx)
            .input('OrderID', sql.Int, orderID).input('PackageID', sql.Int, packageID)
            .input('WarehouseID', sql.Int, warehouseID).input('QRCode', sql.NVarChar(100), qrCode).query(`
                IF NOT EXISTS (SELECT 1 FROM dbo.PhieuNhapBTP WITH (UPDLOCK,HOLDLOCK)
                    WHERE ID_PhieuNhapBTP=@OrderID AND ID_KhoNhap=@WarehouseID AND TonTai=1 AND ISNULL(QrStatus,0)=0)
                    THROW 51072, N'Phiếu nhập không hợp lệ hoặc đã xác nhận', 1;
                IF NOT EXISTS (SELECT 1 FROM dbo.TheKhoKienBTP WITH (UPDLOCK,HOLDLOCK)
                    WHERE ID_TheKhoKienBTP=@PackageID AND ID_PhieuNhapBTP=@OrderID AND TonTai=1)
                    THROW 51073, N'Kiện không thuộc phiếu nhập', 1;
                IF EXISTS (SELECT 1 FROM dbo.TheKhoKienBTP WITH (UPDLOCK,HOLDLOCK)
                    WHERE QRCode=@QRCode AND ID_TheKhoKienBTP<>@PackageID AND TonTai=1)
                    THROW 51074, N'QRCode đã tồn tại ở kiện khác', 1;
                IF NOT EXISTS (SELECT 1 FROM dbo.TheKhoKienBTP_ChiTiet
                    WHERE ID_TheKhoKienBTP=@PackageID AND TonTai=1 AND SoLuong>0
                      AND NULLIF(LTRIM(RTRIM(DauTuan)),N'') IS NOT NULL)
                    THROW 51075, N'Kiện cần có BTP, số lượng và dấu tuần trước khi quét QR', 1;
                IF EXISTS (SELECT 1 FROM dbo.TheKhoKienBTP_ChiTiet
                    WHERE ID_TheKhoKienBTP=@PackageID AND TonTai=1
                      AND (SoLuong<=0 OR NULLIF(LTRIM(RTRIM(DauTuan)),N'') IS NULL))
                    THROW 51076, N'Tất cả BTP trong kiện phải có số lượng và dấu tuần', 1;
                UPDATE dbo.TheKhoKienBTP SET QRCode=@QRCode
                WHERE ID_TheKhoKienBTP=@PackageID;
                SELECT ID_ViTriKho FROM dbo.TheKhoKienBTP WHERE ID_TheKhoKienBTP=@PackageID;`);
        const payload = await enqueuePackage(tx, orderID, packageID, warehouseID);
        await tx.commit();
        return { payload, idViTriKho: target.recordset?.[0]?.ID_ViTriKho ?? null };
    } catch (error) {
        try { await tx.rollback(); } catch (_) { /* noop */ }
        throw error;
    }
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
                       DispatchError, SentAt, UpdatedAt, FinalizeStatus, FinalizeError, FinalizedAt
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
        dispatchError = getDispatchErrorMessage(error);
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

async function packageStatus(pool, orderID, packageID) {
    const result = await pool.request().input('OrderID', sql.Int, orderID)
        .input('PackageID', sql.Int, packageID).query(`
            SELECT ID_PhieuNhapBTP,ID_TheKhoKienBTP,PalletID,DispatchStatus,DispatchAttempts,
                   ResponseStatus,DispatchError,LocationID,SentAt,LocatedAt,UpdatedAt
            FROM dbo.CraneWmsInboundPackage
            WHERE ID_PhieuNhapBTP=@OrderID AND ID_TheKhoKienBTP=@PackageID`);
    return result.recordset[0] || null;
}

async function refreshAggregate(pool, orderID) {
    await pool.request().input('OrderID', sql.Int, orderID).query(`
        UPDATE p SET DispatchStatus=s.NextStatus,DispatchAttempts=s.Attempts,
            DispatchError=s.LastError,UpdatedAt=SYSUTCDATETIME(),
            SentAt=CASE WHEN s.NextStatus='SENT' THEN COALESCE(p.SentAt,SYSUTCDATETIME()) ELSE p.SentAt END
        FROM dbo.CraneWmsInbound p
        CROSS APPLY (SELECT
            CASE WHEN SUM(CASE WHEN c.DispatchStatus='FAILED' THEN 1 ELSE 0 END)>0 THEN 'FAILED'
                 WHEN SUM(CASE WHEN c.DispatchStatus IN ('PENDING','SENDING') THEN 1 ELSE 0 END)>0 THEN 'PENDING'
                 ELSE 'SENT' END AS NextStatus,
            SUM(c.DispatchAttempts) AS Attempts,
            MAX(c.DispatchError) AS LastError
            FROM dbo.CraneWmsInboundPackage c WHERE c.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP) s
        WHERE p.ID_PhieuNhapBTP=@OrderID`);
}

async function dispatchPackage(pool, orderID, packageID, post = axios.post) {
    const claimed = await pool.request().input('OrderID', sql.Int, orderID)
        .input('PackageID', sql.Int, packageID).query(`
            UPDATE dbo.CraneWmsInboundPackage SET DispatchStatus='SENDING',
                DispatchAttempts=DispatchAttempts+1,DispatchError=NULL,UpdatedAt=SYSUTCDATETIME()
            OUTPUT inserted.RequestJson,inserted.PalletID
            WHERE ID_PhieuNhapBTP=@OrderID AND ID_TheKhoKienBTP=@PackageID AND
                (DispatchStatus IN ('PENDING','FAILED') OR
                 (DispatchStatus='SENDING' AND UpdatedAt<DATEADD(MINUTE,-5,SYSUTCDATETIME())))`);
    if (!claimed.recordset.length) return packageStatus(pool, orderID, packageID);
    const row = claimed.recordset[0];
    let responseStatus = null;
    let dispatchError = null;
    try {
        const response = await post(process.env.WMS_INBOUND_URL || DEFAULT_URL,
            JSON.parse(row.RequestJson), { timeout: 10000, headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': `inbound-${orderID}-${row.PalletID}`,
            } });
        responseStatus = response.status;
        if (responseStatus < 200 || responseStatus >= 300) throw new Error(`WMS HTTP ${responseStatus}`);
    } catch (error) {
        responseStatus = error.response?.status || responseStatus;
        dispatchError = getDispatchErrorMessage(error);
    }
    await pool.request().input('OrderID', sql.Int, orderID).input('PackageID', sql.Int, packageID)
        .input('NextStatus', sql.VarChar(12), dispatchError ? 'FAILED' : 'SENT')
        .input('ResponseStatus', sql.Int, responseStatus).input('DispatchError', sql.NVarChar(1000), dispatchError).query(`
            UPDATE dbo.CraneWmsInboundPackage SET DispatchStatus=@NextStatus,
                ResponseStatus=@ResponseStatus,DispatchError=@DispatchError,
                SentAt=CASE WHEN @NextStatus='SENT' THEN SYSUTCDATETIME() ELSE SentAt END,
                UpdatedAt=SYSUTCDATETIME()
            WHERE ID_PhieuNhapBTP=@OrderID AND ID_TheKhoKienBTP=@PackageID AND DispatchStatus='SENDING'`);
    await refreshAggregate(pool, orderID);
    const next = await packageStatus(pool, orderID, packageID);
    if (next?.DispatchStatus === 'SENT' && next.LocationID) await safeTryFinalize(pool, orderID);
    return next;
}

async function dispatchFailedPackages(pool, orderID, post = axios.post) {
    const result = await pool.request().input('OrderID', sql.Int, orderID).query(`
        SELECT ID_TheKhoKienBTP FROM dbo.CraneWmsInboundPackage
        WHERE ID_PhieuNhapBTP=@OrderID AND DispatchStatus IN ('PENDING','FAILED')
        ORDER BY ID_TheKhoKienBTP`);
    const packages = [];
    for (const row of result.recordset) packages.push(await dispatchPackage(pool, orderID, row.ID_TheKhoKienBTP, post));
    return { packages, wmsInbound: await statusWithPackages(pool, orderID) };
}

async function statusWithPackages(pool, orderID) {
    const parent = await status(pool, orderID);
    if (!parent) return null;
    const result = await pool.request().input('OrderID', sql.Int, orderID).query(`
        SELECT ID_TheKhoKienBTP,PalletID,DispatchStatus,DispatchAttempts,ResponseStatus,
               DispatchError,LocationID,SentAt,LocatedAt,UpdatedAt
        FROM dbo.CraneWmsInboundPackage WHERE ID_PhieuNhapBTP=@OrderID ORDER BY ID_TheKhoKienBTP`);
    return { ...parent, packages: result.recordset || [] };
}

async function markPackageLocated(executor, packageID, locationID) {
    const result = await new sql.Request(executor).input('PackageID', sql.Int, packageID)
        .input('LocationID', sql.Int, locationID).query(`
            UPDATE dbo.CraneWmsInboundPackage SET LocationID=@LocationID,
                LocatedAt=COALESCE(LocatedAt,SYSUTCDATETIME()),UpdatedAt=SYSUTCDATETIME()
            OUTPUT inserted.ID_PhieuNhapBTP
            WHERE ID_TheKhoKienBTP=@PackageID AND DispatchStatus IN ('SENDING','SENT')`);
    return result.recordset[0]?.ID_PhieuNhapBTP || null;
}

function addTvpColumns(table) {
    table.columns.add('ID_PhieuNhapBTP', sql.Int); table.columns.add('ID_TheKhoKienBTPChiTiet', sql.Int);
    table.columns.add('ID_TheKhoKienBTP', sql.Int); table.columns.add('ID_KeHoachSanXuat', sql.Int);
    table.columns.add('ID_DonHang_LoSanXuat', sql.Int); table.columns.add('ID_DonHang_SanPham', sql.Int);
    table.columns.add('ItemCode', sql.NVarChar(50)); table.columns.add('Ten_SanPham', sql.NVarChar(200));
    table.columns.add('ID_QuyTrinhSanXuat', sql.Int); table.columns.add('Ten_QuyTrinhSanXuat', sql.NVarChar(50));
    table.columns.add('ID_DonHang', sql.Int); table.columns.add('Ma_DonHang', sql.NVarChar(200));
    table.columns.add('SoLuong', sql.Decimal(18, 2));
}

async function tryFinalize(pool, orderID) {
    const readiness = await pool.request().input('OrderID', sql.Int, orderID).query(`
        SELECT p.QrStatus,
          (SELECT COUNT(*) FROM dbo.TheKhoKienBTP k WHERE k.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP AND k.TonTai=1) AS PackageCount,
          (SELECT COUNT(*) FROM dbo.CraneWmsInboundPackage w WHERE w.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP
             AND w.DispatchStatus='SENT' AND w.LocationID IS NOT NULL) AS ReadyPackageCount,
          (SELECT COUNT(*) FROM dbo.TheKhoKienBTP k LEFT JOIN dbo.TheKhoKienBTP_ChiTiet d
             ON d.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP AND d.TonTai=1
             WHERE k.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP AND k.TonTai=1
             AND (k.QRCode IS NULL OR k.ID_ViTriKho IS NULL OR d.ID_TheKhoKienBTP_ChiTiet IS NULL
                  OR d.SoLuong<=0 OR NULLIF(LTRIM(RTRIM(d.DauTuan)),N'') IS NULL)) AS InvalidCount
        FROM dbo.PhieuNhapBTP p WHERE p.ID_PhieuNhapBTP=@OrderID AND p.TonTai=1;
        DECLARE @CheckTheoKH int=(SELECT COUNT(*) FROM dbo.PhieuNhapBTP_KeHoachSanXuat WHERE ID_PhieuNhapBTP=@OrderID);
        IF @CheckTheoKH<>0
            SELECT pnct.ID_KeHoachSanXuat,ISNULL(pnct.ID_DonHang_SanPham,0) ID_DonHang_SanPham,
                   ISNULL(l.ID_DonHang,0) ID_DonHang,ISNULL(pnct.ID_DonHang_LoSanXuat,0) ID_DonHang_LoSanXuat,
                   ISNULL(SUM(SoLuong_NhapKho),0) SoLuong_NhapKho
            FROM dbo.PhieuNhapBTP_KeHoachSanXuat pnct
            LEFT JOIN TAG_QLSX.dbo.KeHoachSanXuat kh ON kh.ID_KeHoachSanXuat=pnct.ID_KeHoachSanXuat
            LEFT JOIN TAG_QLSX.dbo.LenhSanXuat l ON l.ID_LenhSanXuat=kh.ID_LenhSanXuat
            WHERE pnct.ID_PhieuNhapBTP=@OrderID
            GROUP BY pnct.ID_KeHoachSanXuat,ISNULL(pnct.ID_DonHang_SanPham,0),ISNULL(l.ID_DonHang,0),ISNULL(pnct.ID_DonHang_LoSanXuat,0);
        ELSE
            SELECT 0 ID_KeHoachSanXuat,ISNULL(ID_DonHang_SanPham,0) ID_DonHang_SanPham,
                   ISNULL(ID_DonHang,0) ID_DonHang,ISNULL(ID_DonHang_LoSanXuat,0) ID_DonHang_LoSanXuat,
                   ISNULL(SUM(SoLuong_NhapKho),0) SoLuong_NhapKho
            FROM dbo.PhieuNhapBTP_ChiTiet WHERE ID_PhieuNhapBTP=@OrderID
            GROUP BY ISNULL(ID_DonHang_SanPham,0),ISNULL(ID_DonHang,0),ISNULL(ID_DonHang_LoSanXuat,0);
        SELECT d.ID_TheKhoKienBTP_ChiTiet,d.ID_TheKhoKienBTP,d.ID_KeHoachSanXuat,d.ID_DonHang_LoSanXuat,
               d.ID_DonHang_SanPham,d.ItemCode,d.Ten_SanPham,d.ID_QuyTrinhSanXuat,d.Ten_QuyTrinhSanXuat,
               d.ID_DonHang,CAST(NULL AS nvarchar(200)) AS Ma_DonHang,d.SoLuong
        FROM dbo.TheKhoKienBTP_ChiTiet d JOIN dbo.TheKhoKienBTP k ON k.ID_TheKhoKienBTP=d.ID_TheKhoKienBTP
        WHERE k.ID_PhieuNhapBTP=@OrderID AND k.TonTai=1 AND d.TonTai=1;`);
    const state = readiness.recordsets[0]?.[0];
    if (!state) throw new Error('Không tìm thấy phiếu nhập');
    if (state.QrStatus) return { finalized: true, ready: true, status: 'COMPLETE' };
    const actualRows = readiness.recordsets[2] || [];
    const ready = Number(state.PackageCount) > 0 && Number(state.PackageCount) === Number(state.ReadyPackageCount)
        && Number(state.InvalidCount) === 0 && quantitiesFit(readiness.recordsets[1] || [], actualRows);
    if (!ready) return { finalized: false, ready: false, status: 'WAITING' };

    const tx = new sql.Transaction(pool);
    try {
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        await new sql.Request(tx).input('Resource', sql.NVarChar(255), `CraneInboundFinalize:${orderID}`).query(`
            DECLARE @r int; EXEC @r=sp_getapplock @Resource=@Resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
            IF @r<0 THROW 51077,N'Không lấy được khóa hoàn tất phiếu nhập',1;`);
        const lockedState = await new sql.Request(tx).input('OrderID', sql.Int, orderID).query(`
            SELECT QrStatus FROM dbo.PhieuNhapBTP WITH (UPDLOCK,HOLDLOCK) WHERE ID_PhieuNhapBTP=@OrderID AND TonTai=1`);
        if (lockedState.recordset[0]?.QrStatus) {
            await new sql.Request(tx).input('OrderID', sql.Int, orderID).query(`UPDATE dbo.CraneWmsInbound
                SET FinalizeStatus='COMPLETE',FinalizeError=NULL,FinalizedAt=COALESCE(FinalizedAt,SYSUTCDATETIME()),UpdatedAt=SYSUTCDATETIME()
                WHERE ID_PhieuNhapBTP=@OrderID`);
            await tx.commit();
            return { finalized: true, ready: true, status: 'COMPLETE' };
        }
        const lockedReadiness = await new sql.Request(tx).input('OrderID', sql.Int, orderID).query(`
            SELECT
              (SELECT COUNT(*) FROM dbo.TheKhoKienBTP WITH (UPDLOCK,HOLDLOCK) WHERE ID_PhieuNhapBTP=@OrderID AND TonTai=1) PackageCount,
              (SELECT COUNT(*) FROM dbo.CraneWmsInboundPackage WITH (UPDLOCK,HOLDLOCK)
                 WHERE ID_PhieuNhapBTP=@OrderID AND DispatchStatus='SENT' AND LocationID IS NOT NULL) ReadyPackageCount,
              (SELECT COUNT(*) FROM dbo.TheKhoKienBTP k LEFT JOIN dbo.TheKhoKienBTP_ChiTiet d
                 ON d.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP AND d.TonTai=1
                 WHERE k.ID_PhieuNhapBTP=@OrderID AND k.TonTai=1
                 AND (k.QRCode IS NULL OR k.ID_ViTriKho IS NULL OR d.ID_TheKhoKienBTP_ChiTiet IS NULL
                      OR d.SoLuong<=0 OR NULLIF(LTRIM(RTRIM(d.DauTuan)),N'') IS NULL)) InvalidCount;
            SELECT d.ID_TheKhoKienBTP_ChiTiet,d.ID_TheKhoKienBTP,d.ID_KeHoachSanXuat,d.ID_DonHang_LoSanXuat,
                   d.ID_DonHang_SanPham,d.ItemCode,d.Ten_SanPham,d.ID_QuyTrinhSanXuat,d.Ten_QuyTrinhSanXuat,
                   d.ID_DonHang,CAST(NULL AS nvarchar(200)) AS Ma_DonHang,d.SoLuong
            FROM dbo.TheKhoKienBTP_ChiTiet d WITH (UPDLOCK,HOLDLOCK)
            JOIN dbo.TheKhoKienBTP k WITH (UPDLOCK,HOLDLOCK) ON k.ID_TheKhoKienBTP=d.ID_TheKhoKienBTP
            WHERE k.ID_PhieuNhapBTP=@OrderID AND k.TonTai=1 AND d.TonTai=1;`);
        const lockedCounts=lockedReadiness.recordsets[0]?.[0] || {};
        const finalRows=lockedReadiness.recordsets[1] || [];
        if (!(Number(lockedCounts.PackageCount)>0 && Number(lockedCounts.PackageCount)===Number(lockedCounts.ReadyPackageCount)
            && Number(lockedCounts.InvalidCount)===0 && quantitiesFit(readiness.recordsets[1] || [],finalRows))) {
            await tx.commit();
            return { finalized:false,ready:false,status:'WAITING' };
        }
        const detailView = await new sql.Request(tx).input('ID_PhieuNhapBTP', sql.Int, orderID)
            .execute('App_PhieuNhapBTP_ThongTinChiTiet');
        const viewByID = new Map((detailView.recordsets?.[3] || [])
            .map(row => [Number(row.ID_TheKhoKienBTP_ChiTiet), row]));
        const table = new sql.Table('dbo.TheKhoKienBTPChiTietNhapsType'); addTvpColumns(table);
        for (const d of finalRows) {
            const view=viewByID.get(Number(d.ID_TheKhoKienBTP_ChiTiet)) || {};
            table.rows.add(orderID,d.ID_TheKhoKienBTP_ChiTiet,d.ID_TheKhoKienBTP,
                d.ID_KeHoachSanXuat||0,d.ID_DonHang_LoSanXuat||0,d.ID_DonHang_SanPham||0,d.ItemCode,d.Ten_SanPham,
                d.ID_QuyTrinhSanXuat||0,d.Ten_QuyTrinhSanXuat,d.ID_DonHang||0,view.Ma_DonHang||null,Number(d.SoLuong));
        }
        const result = await new sql.Request(tx).input('TheKhoKienBTPChiTietNhapsTable', table)
            .output('InsertResult', sql.NVarChar(50)).execute('App_XacNhanPhieuNhap_BTP');
        if (result.output?.InsertResult !== 'success') throw new Error(result.output?.InsertResult || 'Xác nhận phiếu nhập thất bại');
        await new sql.Request(tx).input('OrderID', sql.Int, orderID).query(`UPDATE dbo.CraneWmsInbound
            SET FinalizeStatus='COMPLETE',FinalizeError=NULL,FinalizedAt=SYSUTCDATETIME(),UpdatedAt=SYSUTCDATETIME()
            WHERE ID_PhieuNhapBTP=@OrderID`);
        await tx.commit();
        return { finalized: true, ready: true, status: 'COMPLETE' };
    } catch (error) {
        try { await tx.rollback(); } catch (_) { /* noop */ }
        await pool.request().input('OrderID', sql.Int, orderID)
            .input('Error', sql.NVarChar(1000), String(error.message || error).slice(0,1000)).query(`UPDATE dbo.CraneWmsInbound
                SET FinalizeStatus='ERROR',FinalizeError=@Error,UpdatedAt=SYSUTCDATETIME() WHERE ID_PhieuNhapBTP=@OrderID`);
        return { finalized: false, ready: true, status: 'ERROR', error: error.message };
    }
}

async function safeTryFinalize(pool, orderID) {
    try { return await tryFinalize(pool, orderID); }
    catch (error) {
        try {
            await pool.request().input('OrderID', sql.Int, orderID)
                .input('Error', sql.NVarChar(1000), String(error.message || error).slice(0,1000)).query(`UPDATE dbo.CraneWmsInbound
                    SET FinalizeStatus='ERROR',FinalizeError=@Error,UpdatedAt=SYSUTCDATETIME() WHERE ID_PhieuNhapBTP=@OrderID`);
        } catch (_) { /* Preserve the original finalize error. */ }
        return { finalized:false,ready:true,status:'ERROR',error:error.message };
    }
}

async function decorateImportDetail(pool, response, orderID) {
    const inbound = await statusWithPackages(pool, orderID);
    if (!inbound) return response;
    const byPackage = new Map((inbound.packages || []).map(item => [Number(item.ID_TheKhoKienBTP), item]));
    response.kiens = (response.kiens || []).map(item => {
        const wms = byPackage.get(Number(item.idTheKhoKienBTP));
        return { ...item, wmsInbound: wms || null, wmsLocked: Boolean(wms),
            wmsLocationPending: Boolean(wms && !wms.LocationID) };
    });
    response.wmsInbound = inbound;
    response.wmsFinalizeStatus = inbound.FinalizeStatus || 'WAITING';
    response.wmsFinalizeError = inbound.FinalizeError || null;
    return response;
}

module.exports = { buildPayload, buildPackagePayload, getWarehouseID, testPendingLocationID, stagePackages,
    enqueue, dispatch, status, assertPackageUnlocked, enqueuePackage, assignQrAndEnqueue, dispatchPackage,
    dispatchFailedPackages, statusWithPackages, markPackageLocated, tryFinalize, safeTryFinalize, decorateImportDetail };
