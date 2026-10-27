// Opt-in manual E2E against the shared test API and isolated test database.
// RUN_CRANE_API_E2E=1 node test/manualCraneApiFlow.js
require('dotenv').config({ quiet: true });
const sql = require('mssql');

if (process.env.RUN_CRANE_API_E2E !== '1') {
    throw new Error('Set RUN_CRANE_API_E2E=1 to run this test');
}

const API_BASE = process.env.CRANE_TEST_API_BASE || 'https://nodeapi.z76.vn/khotmtest';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data };
}

async function clone(pool, table, identity, sourceID, changes) {
    const columns = (await pool.request()
        .input('TableName', sql.NVarChar(255), `dbo.${table}`)
        .query(`SELECT name FROM sys.columns
                WHERE object_id=OBJECT_ID(@TableName) AND is_identity=0 AND is_computed=0
                ORDER BY column_id`)).recordset.map((row) => row.name);
    const dbRequest = pool.request().input('SourceID', sql.Int, sourceID);
    const values = columns.map((column, index) => {
        if (!Object.hasOwn(changes, column)) return `[${column}]`;
        dbRequest.input(`Value${index}`, changes[column]);
        return `@Value${index}`;
    });
    const result = await dbRequest.query(`
        INSERT dbo.${table} (${columns.map((column) => `[${column}]`).join(',')})
        OUTPUT inserted.${identity}
        SELECT ${values.join(',')} FROM dbo.${table} WHERE ${identity}=@SourceID`);
    return result.recordset[0][identity];
}

async function main() {
    const lower = (value) => String(value || '').toLowerCase();
    if (lower(process.env.DB_DATABASE_TEST) === lower(process.env.DB_DATABASE2)
        && lower(process.env.DB_SERVER_TEST) === lower(process.env.DB_SERVER2)
        && Number(process.env.DB_PORT_TEST) === Number(process.env.DB_PORT2)) {
        throw new Error('DB test đang trùng DB production');
    }
    const pool = await new sql.ConnectionPool({
        server: process.env.DB_SERVER_TEST,
        database: process.env.DB_DATABASE_TEST,
        user: process.env.DB_USER_TEST,
        password: process.env.DB_PASSWORD_TEST,
        port: Number(process.env.DB_PORT_TEST),
        options: { encrypt: true, trustServerCertificate: true },
        requestTimeout: 30000,
    }).connect();

    const suffix = Date.now().toString(36).toUpperCase();
    const inboundCode = `PN-CT-E2E-${suffix}`;
    const outboundCode = `PX-CT-E2E-${suffix}`;
    const palletID = `BP${Date.now()}`;
    const weekMark = '2699';
    const results = { apiBase: API_BASE, inboundCode, outboundCode, palletID, steps: [] };

    try {
        const sourceInboundID = 257007;
        const sourcePackageID = 114147;
        const sourcePackageDetail = (await pool.request().input('PackageID', sql.Int, sourcePackageID)
            .query('SELECT TOP 1 ID_TheKhoKienBTP_ChiTiet FROM dbo.TheKhoKienBTP_ChiTiet WHERE ID_TheKhoKienBTP=@PackageID AND TonTai=1'))
            .recordset[0]?.ID_TheKhoKienBTP_ChiTiet;
        if (!sourcePackageDetail) throw new Error('Không tìm thấy kiện mẫu nhập');

        const inboundID = await clone(pool, 'PhieuNhapBTP', 'ID_PhieuNhapBTP', sourceInboundID, {
            So_PhieuNhapBTP: inboundCode,
            Ngay_NhapBTP: new Date(),
            ID_KhoNhap: 5,
            GhiChu: `[E2E-CRANE] cautruc ${suffix}`,
            TrangThai: 1,
            TonTai: true,
            QrStatus: false,
        });
        await pool.request().input('NewID', sql.Int, inboundID).input('SourceID', sql.Int, sourceInboundID)
            .input('Quantity', sql.Decimal(18, 2), 10).query(`
                INSERT dbo.PhieuNhapBTP_ChiTiet
                    (ID_PhieuNhapBTP,ID_DonHang,ID_DonHang_LoSanXuat,ID_DonHang_SanPham,SoLuong_NhapKho,DonGia,ThanhTien)
                SELECT @NewID,ID_DonHang,ID_DonHang_LoSanXuat,ID_DonHang_SanPham,@Quantity,DonGia,ThanhTien
                FROM dbo.PhieuNhapBTP_ChiTiet WHERE ID_PhieuNhapBTP=@SourceID`);
        const packageID = await clone(pool, 'TheKhoKienBTP', 'ID_TheKhoKienBTP', sourcePackageID, {
            ID_PhieuNhapBTP: inboundID,
            QRCode: palletID,
            TonTai: true,
        });
        const packageDetailID = await clone(pool, 'TheKhoKienBTP_ChiTiet', 'ID_TheKhoKienBTP_ChiTiet', sourcePackageDetail, {
            ID_TheKhoKienBTP: packageID,
            ID_PhieuNhapBTP: inboundID,
            SoLuong: 10,
            DauTuan: weekMark,
            TonTai: true,
        });
        results.inboundID = inboundID;
        results.packageID = packageID;
        results.packageDetailID = packageDetailID;

        const searchBody = (craneMode, code = '') => ({
            craneMode, idKho: [5], soPhieu: code, PageSize: 100, PageIndex: 0,
            IdTaiKhoanDangNhap: 1, LuongQT: 2,
        });
        const inboundCraneList = await request('/btp/phieunhap/tim-kiem', {
            method: 'POST', body: searchBody(true),
        });
        const inboundBtpList = await request('/btp/phieunhap/tim-kiem', {
            method: 'POST', body: searchBody(false),
        });
        results.steps.push({
            step: 'inbound-classification',
            craneStatus: inboundCraneList.status,
            craneFound: (inboundCraneList.data?.data || []).some((row) => Number(row.id) === inboundID),
            btpStatus: inboundBtpList.status,
            btpFound: (inboundBtpList.data?.data || []).some((row) => Number(row.id) === inboundID),
        });

        const assignQr = await request('/btp/phieunhap/gan-qr', {
            method: 'POST',
            body: { idKien: packageID, qrCode: palletID, craneMode: true, deferWmsSelection: true },
        });
        results.steps.push({ step: 'assign-qr', status: assignQr.status, response: assignQr.data });

        const sendInbound = await request(`/btp/phieunhap/${inboundID}/gui-wms-kien`, {
            method: 'POST', body: { packageIds: [packageID] },
        });
        results.steps.push({ step: 'send-inbound-wms', status: sendInbound.status, response: sendInbound.data });

        let inboundState;
        for (let attempt = 0; attempt < 12; attempt += 1) {
            inboundState = (await pool.request().input('PackageID', sql.Int, packageID).query(`
                SELECT DispatchStatus,ResponseStatus,DispatchError,LocationID,UpdatedAt
                FROM dbo.CraneWmsInboundPackage WHERE ID_TheKhoKienBTP=@PackageID`)).recordset[0];
            if (inboundState?.LocationID || inboundState?.DispatchStatus === 'FAILED') break;
            await sleep(5000);
        }
        results.steps.push({ step: 'inbound-wms-result', state: inboundState || null });

        const sourceOutboundID = 327347;
        const outboundID = await clone(pool, 'PhieuXuatBTP', 'ID_PhieuXuatBTP', sourceOutboundID, {
            So_PhieuXuatBTP: outboundCode,
            Ngay_XuatBTP: new Date(),
            ID_KhoXuat: 5,
            GhiChu: `[E2E-CRANE] cautruc ${suffix}`,
            TrangThai: 1,
            TonTai: true,
            QrStatus: false,
        });
        await pool.request().input('NewID', sql.Int, outboundID).input('SourceID', sql.Int, sourceOutboundID)
            .input('Quantity', sql.Decimal(18, 2), 5).query(`
                INSERT dbo.PhieuXuatBTP_ChiTiet
                    (ID_PhieuXuatBTP,ID_DonHang,ID_DonHang_LoSanXuat,ID_DonHang_SanPham,SoLuong_XuatKho,DonGia,ThanhTien)
                SELECT @NewID,ID_DonHang,ID_DonHang_LoSanXuat,ID_DonHang_SanPham,@Quantity,DonGia,ThanhTien
                FROM dbo.PhieuXuatBTP_ChiTiet WHERE ID_PhieuXuatBTP=@SourceID`);
        results.outboundID = outboundID;

        const outboundCraneList = await request('/btp/phieuxuat/tim-kiem', {
            method: 'POST', body: searchBody(true, outboundCode),
        });
        const outboundBtpList = await request('/btp/phieuxuat/tim-kiem', {
            method: 'POST', body: searchBody(false, outboundCode),
        });
        results.steps.push({
            step: 'outbound-classification',
            craneStatus: outboundCraneList.status,
            craneCount: outboundCraneList.data?.data?.length || 0,
            btpStatus: outboundBtpList.status,
            btpCount: outboundBtpList.data?.data?.length || 0,
        });

        const available = await request(`/btp/cau-truc/orders/${outboundID}/available-lots`);
        results.steps.push({
            step: 'outbound-available-lots', status: available.status,
            itemStock: (available.data?.lots || []).filter((row) => row.itemCode === '10056770.B'),
        });
        const sendOutbound = await request(`/btp/cau-truc/orders/${outboundID}/dispatch`, {
            method: 'POST', body: { skipLot: {} },
        });
        results.steps.push({ step: 'send-outbound-wms', status: sendOutbound.status, response: sendOutbound.data });

        await sleep(3000);
        const outboundState = (await pool.request().input('ID', sql.Int, outboundID).query(`
            SELECT DispatchStatus,DispatchAttempts,DispatchError,UpdatedAt
            FROM dbo.CraneWmsOutboundDispatch WHERE ID_PhieuXuatBTP=@ID`)).recordset[0];
        results.steps.push({ step: 'outbound-wms-result', state: outboundState || null });
        console.log(JSON.stringify(results, null, 2));
    } finally {
        await pool.close();
    }
}

main().catch((error) => {
    console.error(JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
    process.exitCode = 1;
});
