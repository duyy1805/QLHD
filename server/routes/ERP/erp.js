const express = require('express')
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { verifyToken, verifyAdmin } = require('../../middleware/auth');
const sql = require('mssql');
const checkApiKey = require('../../middleware/apiKey');
const craneWms = require('../../utils/craneWms');
const craneWmsInbound = require('../../utils/craneWmsInbound');
const XLSX = require('xlsx');

function normalizeLocationReference(source) {
    const rawID = source?.locationID;
    const rawCode = source?.locationCode;
    const hasID = rawID !== undefined && rawID !== null && rawID !== '';
    const hasCode = rawCode !== undefined && rawCode !== null && rawCode !== '';
    const locationID = hasID &&
        (typeof rawID === 'number' || (typeof rawID === 'string' && /^\d+$/.test(rawID.trim())))
        ? Number(rawID)
        : null;
    const locationCode = hasCode && typeof rawCode === 'string'
        ? rawCode.trim().toUpperCase()
        : null;
    const validID = !hasID ||
        (Number.isInteger(locationID) && locationID > 0 && locationID <= 2147483647);
    const validCode = !hasCode ||
        Boolean(locationCode && locationCode.length <= 25);

    return {
        locationID,
        locationCode,
        provided: hasID || hasCode,
        valid: validID && validCode && (hasID || hasCode),
    };
}

async function resolveActiveWarehouseLocation(executor, reference, warehouseID) {
    const result = await new sql.Request(executor)
        .input('LocationID', sql.Int, reference.locationID)
        .input('LocationCode', sql.NVarChar(25), reference.locationCode)
        .input('WarehouseID', sql.Int, warehouseID)
        .query(`
            SELECT ID_ViTriKho, MaViTriKho
            FROM dbo.DM_Kho_ViTri WITH (HOLDLOCK)
            WHERE ID_Kho = @WarehouseID
              AND TonTai = 1
              AND SuDung = 1
              AND (@LocationID IS NULL OR ID_ViTriKho = @LocationID)
              AND (@LocationCode IS NULL OR MaViTriKho = @LocationCode);
        `);

    if (result.recordset.length !== 1) {
        throw craneWms.craneError(
            400,
            'Không tìm thấy duy nhất vị trí theo locationID/locationCode trong kho cầu trục'
        );
    }
    return result.recordset[0];
}

function createErpRouter(tagpoolPromise, options = {}) {
const router = express.Router()
router.use(require('./crane-outbound')(tagpoolPromise, options));

function normalizeOptionalString(value, maxLength) {
    if (value === undefined || value === null) return null;

    const normalized = String(value).trim();
    if (!normalized) return null;

    return normalized.slice(0, maxLength);
}

async function getDanhMucVatTuNhaCungCap(nhaCungCap, maVatTu) {
    const pool = await tagpoolPromise;

    return pool.request()
        .input('NhaCungCap', sql.NVarChar(255), nhaCungCap)
        .input('MaVatTu', sql.NVarChar(30), maVatTu)
        .execute('dbo.Lay_DanhMuc_VatTu_NhaCungCap');
}

/**
 * GET /erp/danh-muc-vat-tu-nha-cung-cap
 *
 * Query:
 * - nhaCungCap: lọc gần đúng theo tên nhà cung cấp
 * - maVatTu: lọc gần đúng theo mã vật tư
 */
router.get('/danh-muc-vat-tu-nha-cung-cap', async (req, res) => {
    try {
        const nhaCungCap = normalizeOptionalString(req.query.nhaCungCap, 255);
        const maVatTu = normalizeOptionalString(req.query.maVatTu, 30);
        const result = await getDanhMucVatTuNhaCungCap(nhaCungCap, maVatTu);
        const data = result.recordset || [];

        return res.status(200).json({
            ok: true,
            count: data.length,
            filters: { nhaCungCap, maVatTu },
            data
        });
    } catch (error) {
        console.error('[GET /danh-muc-vat-tu-nha-cung-cap] error:', error);
        return res.status(500).json({
            ok: false,
            message: error.message || 'Không thể lấy danh mục vật tư - nhà cung cấp.'
        });
    }
});

router.get('/danh-muc-vat-tu-nha-cung-cap/export.xlsx', async (req, res) => {
    try {
        const nhaCungCap = normalizeOptionalString(req.query.nhaCungCap, 255);
        const maVatTu = normalizeOptionalString(req.query.maVatTu, 30);
        const result = await getDanhMucVatTuNhaCungCap(nhaCungCap, maVatTu);
        const data = result.recordset || [];
        const worksheet = XLSX.utils.json_to_sheet(data);

        worksheet['!cols'] = Object.keys(data[0] || {}).map((column) => ({
            wch: Math.min(
                45,
                Math.max(
                    column.length + 2,
                    ...data.slice(0, 500).map((row) => String(row[column] ?? '').length + 2)
                )
            )
        }));

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Vật tư - NCC');
        const buffer = XLSX.write(workbook, {
            type: 'buffer',
            bookType: 'xlsx',
            cellDates: true
        });
        const date = new Date().toISOString().slice(0, 10);

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="danh-muc-vat-tu-nha-cung-cap-${date}.xlsx"`
        );
        return res.send(buffer);
    } catch (error) {
        console.error('[GET /danh-muc-vat-tu-nha-cung-cap/export.xlsx] error:', error);
        return res.status(500).json({
            ok: false,
            message: error.message || 'Không thể xuất danh mục vật tư - nhà cung cấp.'
        });
    }
});

router.post('/dinhmucvattu', checkApiKey, async (req, res) => {
    try {
        let { ItemCode, ID_DonHang } = req.body || {};

        // Chuẩn hoá input
        if (typeof ItemCode === 'string') {
            ItemCode = ItemCode.trim();
            if (ItemCode === '') ItemCode = null;
        } else if (ItemCode == null) {
            ItemCode = null;
        }

        if (ID_DonHang !== undefined && ID_DonHang !== null && ID_DonHang !== '') {
            // ép int an toàn
            const parsed = Number(ID_DonHang);
            if (!Number.isInteger(parsed)) {
                return res.status(400).json({ ok: false, message: 'ID_DonHang không hợp lệ (phải là số nguyên).' });
            }
            ID_DonHang = parsed;
        } else {
            ID_DonHang = null;
        }

        // Khuyến nghị: yêu cầu ít nhất một tham số để tránh trả về quá nhiều dữ liệu
        if (ItemCode === null && ID_DonHang === null) {
            return res.status(400).json({
                ok: false,
                message: 'Cần cung cấp ít nhất một trong hai: ItemCode hoặc ID_DonHang.'
            });
        }

        const pool = await tagpoolPromise;

        const result = await pool.request()
            // .input('ItemCode', sql.NVarChar(50), ItemCode)   // đúng độ dài như stored
            .input('ID_DonHang', sql.Int, ID_DonHang)
            .execute('dbo.DonHang_VatTu_DinhMuc_ChiTiet2');

        const dinhmucvattu = result.recordset || []; // recordset đầu tiên
        return res.json({ ok: true, count: dinhmucvattu.length, dinhmucvattu });
    } catch (error) {
        console.error('[POST /dinhmucvattu] error:', error);
        return res.status(500).json({ ok: false, message: error.message || 'Lỗi không xác định' });
    }
});

router.post('/invoice/packing-list', checkApiKey, async (req, res) => {
    try {
        let { TuanGiao, Lan } = req.body || {};

        // ===== Validate & chuẩn hoá input =====
        const tg = Number(TuanGiao);
        const lan = Number(Lan);

        if (!Number.isInteger(tg) || tg <= 0) {
            return res.status(400).json({
                ok: false,
                message: 'TuanGiao không hợp lệ (phải là số nguyên > 0)'
            });
        }

        if (!Number.isInteger(lan) || lan <= 0) {
            return res.status(400).json({
                ok: false,
                message: 'Lan không hợp lệ (phải là số nguyên > 0)'
            });
        }

        const pool = await tagpoolPromise;

        const result = await pool.request()
            .input('TuanGiao', sql.Int, tg)
            .input('Lan', sql.Int, lan)
            .execute('dbo.pr_Invoice_PackingList');

        const data = result.recordset || [];

        return res.json({
            ok: true,
            count: data.length,
            data
        });

    } catch (error) {
        console.error('[POST /invoice/packing-list] error:', error);
        return res.status(500).json({
            ok: false,
            message: error.message || 'Lỗi không xác định'
        });
    }
});

// ==========================================
// LẤY FULL DM_QuyTrinhSanXuat
// ==========================================
router.get('/dm/quy-trinh-san-xuat', checkApiKey, async (req, res) => {
    try {
        const pool = await tagpoolPromise;

        const result = await pool.request().query(`
            SELECT *
            FROM DM_QuyTrinhSanXuat
            ORDER BY ID_QuyTrinhSanXuat
        `);

        const data = result.recordset || [];

        return res.json({
            ok: true,
            count: data.length,
            data
        });

    } catch (error) {
        console.error('[GET /dm/quy-trinh-san-xuat] error:', error);

        return res.status(500).json({
            ok: false,
            message: error.message || 'Lỗi không xác định'
        });
    }
});

router.post('/don-hang', checkApiKey, async (req, res) => {
    try {
        let { Ma_DonHang } = req.body || {};

        const pool = await tagpoolPromise;

        let query = `
            SELECT 
                ID_DonHang,
                Ma_DonHang
            FROM DonHang
            WHERE 1 = 1
        `;

        const request = pool.request();

        // ===== Filter theo mã đơn hàng nếu có =====
        if (
            Ma_DonHang !== undefined &&
            Ma_DonHang !== null &&
            String(Ma_DonHang).trim() !== ''
        ) {
            query += ` AND Ma_DonHang LIKE '%' + @MaDonHang + '%' `;

            request.input(
                'MaDonHang',
                sql.NVarChar(100),
                String(Ma_DonHang).trim()
            );
        }

        query += ` ORDER BY ID_DonHang DESC `;

        const result = await request.query(query);

        const data = result.recordset || [];

        return res.json({
            ok: true,
            count: data.length,
            data
        });

    } catch (error) {
        console.error('[POST /don-hang] error:', error);

        return res.status(500).json({
            ok: false,
            message: error.message || 'Lỗi không xác định'
        });
    }
});


function isValidDateString(value) {
    if (typeof value !== 'string') return false;

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

function parseBooleanQuery(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue;

    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'x'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;

    return null;
}

/**
 * GET /erp/phieu-nhap-btp
 *
 * Query:
 * - tuNgay, denNgay: bắt buộc, định dạng yyyy-MM-dd (tính cả ngày đến)
 * - idKho: không bắt buộc; ví dụ Kho BTP.M có ID 5
 * - baoGomChuaGhiThe: true/false, mặc định false
 */
router.get('/phieu-nhap-btp', async (req, res) => {
    try {
        const tuNgay = String(req.query.tuNgay || '').trim();
        const denNgay = String(req.query.denNgay || '').trim();
        const baoGomChuaGhiThe = parseBooleanQuery(req.query.baoGomChuaGhiThe);

        if (!isValidDateString(tuNgay) || !isValidDateString(denNgay)) {
            return res.status(400).json({
                ok: false,
                message: 'tuNgay và denNgay là bắt buộc, định dạng yyyy-MM-dd.'
            });
        }

        if (tuNgay > denNgay) {
            return res.status(400).json({
                ok: false,
                message: 'tuNgay không được lớn hơn denNgay.'
            });
        }

        if (baoGomChuaGhiThe === null) {
            return res.status(400).json({
                ok: false,
                message: 'baoGomChuaGhiThe chỉ nhận true/false hoặc 1/0.'
            });
        }

        let idKho = null;
        if (req.query.idKho !== undefined && String(req.query.idKho).trim() !== '') {
            idKho = Number(req.query.idKho);
            if (!Number.isInteger(idKho) || idKho <= 0 || idKho > 32767) {
                return res.status(400).json({
                    ok: false,
                    message: 'idKho không hợp lệ.'
                });
            }
        }

        const pool = await tagpoolPromise;
        const result = await pool.request()
            .input('TuNgay', sql.Date, tuNgay)
            .input('DenNgay', sql.Date, denNgay)
            .input('ID_Kho', sql.SmallInt, idKho)
            .input('BaoGomChuaGhiThe', sql.Bit, baoGomChuaGhiThe)
            .execute('dbo.pr_ERP_PhieuNhapBTP_DanhSach');

        const data = result.recordset || [];

        return res.status(200).json({
            ok: true,
            count: data.length,
            filters: {
                tuNgay,
                denNgay,
                idKho,
                baoGomChuaGhiThe
            },
            data
        });
    } catch (error) {
        console.error('[GET /phieu-nhap-btp] error:', error);
        return res.status(500).json({
            ok: false,
            message: error.message || 'Không thể lấy danh sách phiếu nhập BTP.'
        });
    }
});

/**
 * GET /kehoachsanxuat
 *
 * Lấy danh sách kế hoạch sản xuất từ ERP.
 * Stored procedure không có tham số đầu vào.
 */
router.get('/kehoachsanxuat', async (req, res) => {
    try {
        const { Ten_DonVi } = req.query;

        const tenDonVi =
            typeof Ten_DonVi === 'string' && Ten_DonVi.trim() !== ''
                ? Ten_DonVi.trim()
                : null;

        const pool = await tagpoolPromise;

        const result = await pool.request()
            .input('Ten_DonVi', sql.NVarChar(255), tenDonVi)
            .execute('TAG_QLSX.dbo.NangSuat_KeHoachNgay_CNPN');

        const keHoachSanXuat = result.recordset || [];

        return res.status(200).json({
            ok: true,
            count: keHoachSanXuat.length,
            keHoachSanXuat
        });

    } catch (error) {
        console.error('[GET /kehoachsanxuat] error:', error);

        return res.status(500).json({
            ok: false,
            message: error.message || 'Không thể lấy kế hoạch sản xuất.'
        });
    }
});

/**
 * POST /tiendosanxuat-mocgio
 *
 * Cập nhật tổng sản lượng của một mốc giờ.
 *
 * Lưu ý:
 * SoLuong_SanPham là tổng sản lượng hiện tại của mốc giờ,
 * không phải số lượng tăng thêm.
 */
router.post('/tiendosanxuat-mocgio', async (req, res) => {
    try {
        let {
            ID_KeHoachSanXuat,
            ID_DonHang_SanPham,
            ID_DonHang_LoSanXuat,
            NgayNhap,
            ID_MocGio,
            SoLuong_SanPham
        } = req.body || {};

        // Chuẩn hóa các trường số
        ID_KeHoachSanXuat = Number(ID_KeHoachSanXuat);
        ID_DonHang_SanPham = Number(ID_DonHang_SanPham);
        ID_DonHang_LoSanXuat = Number(ID_DonHang_LoSanXuat);
        ID_MocGio = Number(ID_MocGio);
        SoLuong_SanPham = Number(SoLuong_SanPham);

        if (
            !Number.isInteger(ID_KeHoachSanXuat) ||
            ID_KeHoachSanXuat <= 0
        ) {
            return res.status(400).json({
                ok: false,
                message: 'ID_KeHoachSanXuat không hợp lệ.'
            });
        }

        if (
            !Number.isInteger(ID_DonHang_SanPham) ||
            ID_DonHang_SanPham <= 0
        ) {
            return res.status(400).json({
                ok: false,
                message: 'ID_DonHang_SanPham không hợp lệ.'
            });
        }

        if (
            !Number.isInteger(ID_DonHang_LoSanXuat) ||
            ID_DonHang_LoSanXuat <= 0
        ) {
            return res.status(400).json({
                ok: false,
                message: 'ID_DonHang_LoSanXuat không hợp lệ.'
            });
        }

        if (
            !Number.isInteger(ID_MocGio) ||
            ID_MocGio < 0 ||
            ID_MocGio > 255
        ) {
            return res.status(400).json({
                ok: false,
                message: 'ID_MocGio không hợp lệ, giá trị phải từ 0 đến 255.'
            });
        }

        if (
            !Number.isFinite(SoLuong_SanPham) ||
            SoLuong_SanPham < 0
        ) {
            return res.status(400).json({
                ok: false,
                message: 'SoLuong_SanPham không hợp lệ hoặc nhỏ hơn 0.'
            });
        }

        // DECIMAL(18,2) chỉ cho phép tối đa 2 chữ số thập phân
        if (!Number.isInteger(SoLuong_SanPham * 100)) {
            return res.status(400).json({
                ok: false,
                message: 'SoLuong_SanPham chỉ được có tối đa 2 chữ số thập phân.'
            });
        }

        if (!isValidDateString(NgayNhap)) {
            return res.status(400).json({
                ok: false,
                message: 'NgayNhap không hợp lệ, định dạng yêu cầu là yyyy-MM-dd.'
            });
        }

        const pool = await tagpoolPromise;

        const result = await pool.request()
            .input('ID_KeHoachSanXuat', sql.Int, ID_KeHoachSanXuat)
            .input('ID_DonHang_SanPham', sql.Int, ID_DonHang_SanPham)
            .input('ID_DonHang_LoSanXuat', sql.Int, ID_DonHang_LoSanXuat)
            .input('NgayNhap', sql.Date, NgayNhap)
            .input('ID_MocGio', sql.TinyInt, ID_MocGio)
            .input('SoLuong_SanPham', sql.Decimal(18, 2), SoLuong_SanPham)
            .execute('dbo.NangSuat_TienDoSanSuat_MocGio_CNPN');

        return res.status(200).json({
            ok: true,
            message: 'Cập nhật tiến độ sản xuất theo mốc giờ thành công.',
            data: {
                ID_KeHoachSanXuat,
                ID_DonHang_SanPham,
                ID_DonHang_LoSanXuat,
                NgayNhap,
                ID_MocGio,
                SoLuong_SanPham
            },
            rowsAffected: result.rowsAffected || []
        });
    } catch (error) {
        console.error('[POST /tiendosanxuat-mocgio] error:', error);

        return res.status(500).json({
            ok: false,
            message:
                error.message ||
                'Không thể cập nhật tiến độ sản xuất theo mốc giờ.'
        });
    }
});

/**
 * GET /erp/wms/locations
 *
 * Danh sách vị trí vật lý Z76 dành riêng cho WMS nội bộ. Endpoint bắt buộc
 * x-api-key. Khi callback nhập/điều chuyển pallet, WMS có thể gửi locationID
 * hoặc locationCode; nếu gửi cả hai thì chúng phải cùng trỏ tới một vị trí.
 */
router.get('/wms/locations', checkApiKey, async (_req, res) => {
    try {
        const pool = await tagpoolPromise;
        const result = await pool.request()
            .input('WarehouseID', sql.SmallInt, 5)
            .input('ZoneCode', sql.NVarChar(14), 'A')
            .input('BuildingCode', sql.NVarChar(10), 'Z76')
            .input('AreaCode', sql.NVarChar(10), 'CT')
            .query(`
                SELECT
                    v.ID_ViTriKho AS locationID,
                    v.MaViTriKho AS locationCode,
                    v.QRCode AS qrCode,
                    v.TenViTriKho AS name,
                    v.MaDay AS crane,
                    TRY_CONVERT(tinyint, v.MaTang) AS rack,
                    TRY_CONVERT(tinyint, v.MaKe) AS tier,
                    CONVERT(int, v.STT_ViTriKho) AS position
                FROM dbo.DM_Kho_ViTri v
                WHERE v.ID_Kho = @WarehouseID
                  AND v.MaVung = @ZoneCode
                  AND v.MaNha = @BuildingCode
                  AND v.MaKhuVuc = @AreaCode
                  AND v.SuDung = 1
                  AND v.TonTai = 1
                ORDER BY
                    v.MaDay,
                    TRY_CONVERT(int, v.MaTang),
                    TRY_CONVERT(int, v.MaKe),
                    CONVERT(int, v.STT_ViTriKho),
                    v.ID_ViTriKho;
            `);
        const locations = result.recordset || [];

        return res.status(200).json({
            success: true,
            warehouseID: 5,
            warehouseCode: 'Z76',
            count: locations.length,
            locations
        });
    } catch (error) {
        console.error('[GET /wms/locations] error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
});

/**
 * POST /erp/wms/inbound-callback
 *
 * WMS gọi API này sau khi hoàn tất xử lý phiếu nhập. Chỉ những kiện có
 * status = COMPLETED mới được cập nhật vị trí trong ERP.
 */
router.post('/wms/inbound-callback', checkApiKey, async (req, res) => {
    const body = req.body || {};
    const orderID = typeof body.orderID === 'string' ? body.orderID.trim() : '';
    const orderCode = typeof body.orderCode === 'string' ? body.orderCode.trim() : '';
    const orderType = typeof body.orderType === 'string'
        ? body.orderType.trim().toUpperCase()
        : '';
    const status = typeof body.status === 'string'
        ? body.status.trim().toUpperCase()
        : '';
    const processedAt = typeof body.processedAt === 'string'
        ? body.processedAt.trim()
        : '';
    const pallets = Array.isArray(body.pallets) ? body.pallets : null;

    const idPhieuNhap = /^\d+$/.test(orderID) ? Number(orderID) : null;
    const validStatuses = new Set(['COMPLETED', 'PARTIAL', 'FAILED']);

    if (
        !Number.isSafeInteger(idPhieuNhap) ||
        idPhieuNhap <= 0 ||
        idPhieuNhap > 2147483647 ||
        !orderCode ||
        orderType !== 'INBOUND' ||
        !validStatuses.has(status) ||
        !processedAt ||
        !Number.isFinite(Date.parse(processedAt)) ||
        !pallets
    ) {
        return res.status(400).json({
            success: false,
            orderID: orderID || null,
            message: 'Invalid callback payload'
        });
    }

    const normalizedPallets = [];
    const palletIDs = new Set();

    for (const pallet of pallets) {
        const palletID = typeof pallet?.palletID === 'string'
            ? pallet.palletID.trim()
            : '';
        const palletStatus = typeof pallet?.status === 'string'
            ? pallet.status.trim().toUpperCase()
            : '';
        const locationReference = normalizeLocationReference(pallet);

        if (
            !palletID ||
            palletIDs.has(palletID) ||
            !['COMPLETED', 'FAILED'].includes(palletStatus) ||
            (palletStatus === 'COMPLETED' && !locationReference.valid) ||
            (palletStatus === 'FAILED' && locationReference.provided && !locationReference.valid)
        ) {
            return res.status(400).json({
                success: false,
                orderID,
                message: 'Invalid callback payload'
            });
        }

        palletIDs.add(palletID);
        normalizedPallets.push({ palletID, status: palletStatus, ...locationReference });
    }

    if (
        (status === 'COMPLETED' &&
            (normalizedPallets.length === 0 || normalizedPallets.some((p) => p.status !== 'COMPLETED'))) ||
        (status === 'PARTIAL' &&
            (!normalizedPallets.some((p) => p.status === 'COMPLETED') ||
                !normalizedPallets.some((p) => p.status === 'FAILED'))) ||
        (status === 'FAILED' && normalizedPallets.some((p) => p.status !== 'FAILED'))
    ) {
        return res.status(400).json({
            success: false,
            orderID,
            message: 'Invalid callback payload'
        });
    }

    let transaction;
    let transactionFinished = false;

    try {
        const pool = await tagpoolPromise;
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const orderResult = await new sql.Request(transaction)
            .input('ID_PhieuNhapBTP', sql.Int, idPhieuNhap)
            .input('So_PhieuNhapBTP', sql.NVarChar(255), orderCode)
            .query(`
                SELECT ID_PhieuNhapBTP, ID_KhoNhap
                FROM dbo.PhieuNhapBTP WITH (UPDLOCK, HOLDLOCK)
                WHERE ID_PhieuNhapBTP = @ID_PhieuNhapBTP
                  AND So_PhieuNhapBTP = @So_PhieuNhapBTP
                  AND TonTai = 1;
            `);

        if (orderResult.recordset.length !== 1) {
            const error = new Error('Không tìm thấy phiếu nhập tương ứng');
            error.statusCode = 400;
            throw error;
        }

        const warehouseID = Number(orderResult.recordset[0].ID_KhoNhap);
        let updatedCount = 0;

        for (const pallet of normalizedPallets) {
            if (pallet.status !== 'COMPLETED') continue;

            const targetLocation = await resolveActiveWarehouseLocation(
                transaction,
                pallet,
                warehouseID
            );
            const targetLocationID = Number(targetLocation.ID_ViTriKho);

            const palletResult = await new sql.Request(transaction)
                .input('ID_PhieuNhapBTP', sql.Int, idPhieuNhap)
                .input('QRCode', sql.NVarChar(255), pallet.palletID)
                .query(`
                    SELECT ID_TheKhoKienBTP, ID_ViTriKho
                    FROM dbo.TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK)
                    WHERE ID_PhieuNhapBTP = @ID_PhieuNhapBTP
                      AND QRCode = @QRCode
                      AND TonTai = 1;
                `);

            if (palletResult.recordset.length !== 1) {
                const error = new Error(
                    `Không tìm thấy kiện ${pallet.palletID} thuộc phiếu nhập ${orderID}`
                );
                error.statusCode = 400;
                throw error;
            }

            const packageRow = palletResult.recordset[0];

            const inboundOrderID = await craneWmsInbound.markPackageLocated(
                transaction, packageRow.ID_TheKhoKienBTP, targetLocationID);
            if (!inboundOrderID) {
                const incremental = await new sql.Request(transaction).input('OrderID', sql.Int, idPhieuNhap).query(`
                    SELECT TOP (1) ID_PhieuNhapBTP FROM dbo.CraneWmsInboundPackage WHERE ID_PhieuNhapBTP=@OrderID`);
                if (incremental.recordset.length) {
                    const error = new Error(`Kiện ${pallet.palletID} chưa được ERP gửi WMS`);
                    error.statusCode = 400;
                    throw error;
                }
            }

            // WMS có thể gửi lại callback. Không cập nhật/lưu lịch sử lần nữa
            // nếu kiện đã ở đúng vị trí.
            if (Number(packageRow.ID_ViTriKho) === targetLocationID) continue;

            await new sql.Request(transaction)
                .input('ID_TheKhoKienBTP', sql.Int, packageRow.ID_TheKhoKienBTP)
                .input('ID_ViTriKho', sql.Int, targetLocationID)
                .input('ID_TaiKhoan', sql.Int, null)
                .input('LoaiThaoTac', sql.VarChar(20), 'GAN_VI_TRI_NHAP')
                .execute('dbo.App_BTP_CapNhatViTriKien');

            updatedCount += 1;
        }

        await transaction.commit();
        transactionFinished = true;
        const finalize = await craneWmsInbound.safeTryFinalize(pool, idPhieuNhap);

        console.info('[POST /wms/inbound-callback] processed:', {
            orderID,
            status,
            updatedCount,
            processedAt
        });

        return res.status(200).json({
            success: true,
            orderID,
            message: 'Callback received',
            finalize,
        });
    } catch (error) {
        if (transaction && !transactionFinished) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('[POST /wms/inbound-callback] rollback error:', rollbackError);
            }
        }

        console.error('[POST /wms/inbound-callback] error:', error);

        const sqlErrorNumber = error.number ?? error.originalError?.info?.number;
        const statusCode = error.statusCode === 400 || [51041, 51042, 51043].includes(sqlErrorNumber)
            ? 400
            : 500;
        return res.status(statusCode).json({
            success: false,
            orderID: orderID || null,
            message: statusCode === 400 ? error.message : 'Internal Server Error'
        });
    }
});

/** WMS thông báo vị trí mới của kiện sau khi điều chuyển trong kho. */
router.post('/wms/location-callback', checkApiKey, async (req, res) => {
    const body = req.body || {};
    const palletID = typeof body.palletID === 'string' ? body.palletID.trim() : '';
    const locationReference = normalizeLocationReference(body);
    const parseLocationID = (value) =>
        typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))
            ? Number(value)
            : NaN;
    let locationID = locationReference.locationID;
    let locationCode = locationReference.locationCode;
    const hasPreviousLocation = body.previousLocationID !== undefined && body.previousLocationID !== null;
    const previousLocationID = hasPreviousLocation ? parseLocationID(body.previousLocationID) : null;
    const validLocation = (value) => Number.isInteger(value) && value > 0 && value <= 2147483647;
    const isCraneReturn = body.reason === 'RETURN_AFTER_PARTIAL_OUTBOUND';

    if (
        !palletID || palletID.length > 255 ||
        !locationReference.valid ||
        (hasPreviousLocation && !validLocation(previousLocationID)) ||
        (hasPreviousLocation && locationID !== null && previousLocationID === locationID)
    ) {
        return res.status(400).json({ success: false, palletID: palletID || null, message: 'Invalid callback payload' });
    }

    let transaction;
    let transactionFinished = false;
    let processingStage = 'begin-transaction';
    try {
        const pool = await tagpoolPromise;
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        if (isCraneReturn) {
            processingStage = 'validate-crane-return';
            const sourceOrderID = craneWms.positiveId(body.sourceOrderID);
            const eventID = typeof body.eventID === 'string' ? body.eventID.trim() : '';
            const config = await require('../../utils/craneWmsOutbound').config(transaction, Boolean(options.isTest));
            if (!config || !sourceOrderID || !eventID || eventID.length > 255 ||
                (hasPreviousLocation && previousLocationID !== config.temporaryLocationID)) {
                throw craneWms.craneError(400, 'Thông tin nhập lại pallet không hợp lệ');
            }
            const order = await craneWms.findCraneOrder(transaction, sourceOrderID, true);
            if (!order) throw craneWms.craneError(404, 'Không tìm thấy phiếu cầu trục');
            const targetLocation = await resolveActiveWarehouseLocation(
                transaction,
                locationReference,
                Number(order.ID_Kho)
            );
            locationID = Number(targetLocation.ID_ViTriKho);
            locationCode = targetLocation.MaViTriKho;
            if (locationID === config.temporaryLocationID)
                throw craneWms.craneError(400, 'Thông tin nhập lại pallet không hợp lệ');
            const rowResult = await new sql.Request(transaction)
                .input('OrderID', sql.Int, sourceOrderID)
                .input('PalletID', sql.NVarChar(255), palletID)
                .query(`SELECT p.* FROM dbo.CraneWmsOutboundPallet p WITH (UPDLOCK, HOLDLOCK)
                        WHERE p.ID_PhieuXuatBTP=@OrderID AND p.PalletID=@PalletID`);
            const cycle = rowResult.recordset[0];
            if (!cycle) throw craneWms.craneError(404, 'Không tìm thấy pallet chờ nhập lại của phiếu');
            if (cycle.Status === 'RETURNED' && cycle.ReturnEventID === eventID &&
                Number(cycle.ReturnLocationID) === locationID) {
                await transaction.commit();
                transactionFinished = true;
                return res.status(200).json({ success: true, palletID, locationID, locationCode, updated: false });
            }
            if (cycle.Status !== 'WAITING_RETURN') throw craneWms.craneError(409, 'Pallet không ở trạng thái chờ nhập lại');
            const usedEvent = await new sql.Request(transaction)
                .input('EventID', sql.NVarChar(255), eventID)
                .query(`SELECT ID_PhieuXuatBTP FROM dbo.CraneWmsOutboundPallet WITH (UPDLOCK, HOLDLOCK)
                        WHERE ReturnEventID=@EventID`);
            if (usedEvent.recordset.length) throw craneWms.craneError(409, 'Mã sự kiện WMS đã được dùng');
            const current = await new sql.Request(transaction)
                .input('PackageID', sql.Int, cycle.ID_TheKhoKienBTP)
                .query('SELECT ID_ViTriKho FROM dbo.TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK) WHERE ID_TheKhoKienBTP=@PackageID AND TonTai=1');
            if (Number(current.recordset[0]?.ID_ViTriKho) !== config.temporaryLocationID)
                throw craneWms.craneError(409, 'Pallet không còn ở vị trí tạm');
            await new sql.Request(transaction)
                .input('ID_TheKhoKienBTP', sql.Int, cycle.ID_TheKhoKienBTP)
                .input('ID_ViTriKho', sql.Int, locationID)
                .input('ID_TaiKhoan', sql.Int, null)
                .input('LoaiThaoTac', sql.VarChar(20), 'DIEU_CHUYEN')
                .execute('dbo.App_BTP_CapNhatViTriKien');
            await new sql.Request(transaction)
                .input('OrderID', sql.Int, sourceOrderID)
                .input('PackageID', sql.Int, cycle.ID_TheKhoKienBTP)
                .input('EventID', sql.NVarChar(255), eventID)
                .input('LocationID', sql.Int, locationID)
                .query(`UPDATE dbo.CraneWmsOutboundPallet SET Status='RETURNED', ReturnEventID=@EventID,
                        ReturnLocationID=@LocationID WHERE ID_PhieuXuatBTP=@OrderID AND ID_TheKhoKienBTP=@PackageID;
                        IF NOT EXISTS (SELECT 1 FROM dbo.CraneWmsOutboundPallet
                            WHERE ID_PhieuXuatBTP=@OrderID AND Status='WAITING_RETURN')
                        UPDATE dbo.CraneWmsOutbound SET Status='COMPLETE', UpdatedAt=SYSUTCDATETIME()
                            WHERE ID_PhieuXuatBTP=@OrderID;`);
            await transaction.commit();
            transactionFinished = true;
            return res.status(200).json({ success: true, palletID, locationID, locationCode, updated: true });
        }

        processingStage = 'load-crane-config';
        const craneConfig = options.isTest
            ? await require('../../utils/craneWmsOutbound').config(transaction, true)
            : craneWms.getCraneConfig();
        processingStage = 'check-active-crane-pallet';
        if (craneConfig && locationID === craneConfig.temporaryLocationID)
            throw craneWms.craneError(409, 'Vị trí tạm chỉ được dùng bởi callback xuất cầu trục');
        const activeCranePallet = craneConfig
            ? await craneWms.findActivePallet(transaction, palletID, true) : null;
        if (activeCranePallet) throw craneWms.craneError(409, 'Pallet đang tham gia phiếu xuất cầu trục');

        processingStage = 'load-pallet';
        const result = await new sql.Request(transaction)
            .input('QRCode', sql.NVarChar(255), palletID)
            .query(`
                SELECT k.ID_TheKhoKienBTP, k.ID_ViTriKho, v.ID_Kho
                FROM dbo.TheKhoKienBTP k WITH (UPDLOCK, HOLDLOCK)
                LEFT JOIN dbo.DM_Kho_ViTri v ON v.ID_ViTriKho = k.ID_ViTriKho
                WHERE k.QRCode = @QRCode AND k.TonTai = 1;
            `);

        if (result.recordset.length !== 1) {
            const error = new Error('Không tìm thấy kiện tương ứng');
            error.statusCode = 404;
            throw error;
        }

        const pallet = result.recordset[0];
        const warehouseID = Number(craneConfig?.warehouseID || pallet.ID_Kho);
        if (!Number.isInteger(warehouseID) || warehouseID <= 0)
            throw craneWms.craneError(400, 'Không xác định được kho hiện tại của kiện');
        processingStage = 'resolve-target-location';
        const targetLocation = await resolveActiveWarehouseLocation(
            transaction,
            locationReference,
            warehouseID
        );
        locationID = Number(targetLocation.ID_ViTriKho);
        locationCode = targetLocation.MaViTriKho;
        if (craneConfig && locationID === craneConfig.temporaryLocationID)
            throw craneWms.craneError(409, 'Vị trí tạm chỉ được dùng bởi callback xuất cầu trục');
        if (hasPreviousLocation && previousLocationID === locationID)
            throw craneWms.craneError(400, 'Vị trí mới phải khác previousLocationID');

        let inboundOrderID = null;
        const currentLocationID = pallet.ID_ViTriKho == null ? null : Number(pallet.ID_ViTriKho);
        const unchanged = currentLocationID === locationID;

        if (!unchanged && hasPreviousLocation && currentLocationID !== previousLocationID) {
            const error = new Error('Vị trí hiện tại của kiện không khớp previousLocationID');
            error.statusCode = 409;
            throw error;
        }

        if (!unchanged) {
            processingStage = 'update-pallet-location';
            await new sql.Request(transaction)
                .input('ID_TheKhoKienBTP', sql.Int, pallet.ID_TheKhoKienBTP)
                .input('ID_ViTriKho', sql.Int, locationID)
                .input('ID_TaiKhoan', sql.Int, null)
                .input('LoaiThaoTac', sql.VarChar(20), 'DIEU_CHUYEN')
                .execute('dbo.App_BTP_CapNhatViTriKien');
        }

        processingStage = 'mark-inbound-package-located';
        inboundOrderID = await craneWmsInbound.markPackageLocated(transaction, pallet.ID_TheKhoKienBTP, locationID);
        if (!inboundOrderID) {
            const trackedInbound = await new sql.Request(transaction).input('PackageID', sql.Int, pallet.ID_TheKhoKienBTP).query(`
                SELECT TOP (1) DispatchStatus FROM dbo.CraneWmsInboundPackage WHERE ID_TheKhoKienBTP=@PackageID`);
            if (trackedInbound.recordset.length) throw craneWms.craneError(409, 'Kiện nhập chưa được WMS tiếp nhận thành công');
        }

        processingStage = 'commit';
        await transaction.commit();
        transactionFinished = true;
        const finalize = inboundOrderID ? await craneWmsInbound.safeTryFinalize(pool, inboundOrderID) : null;
        return res.status(200).json({
            success: true,
            palletID,
            locationID,
            locationCode,
            updated: !unchanged,
            message: 'Callback received',
            ...(finalize ? { finalize } : {}),
        });
    } catch (error) {
        if (transaction && !transactionFinished) {
            try { await transaction.rollback(); }
            catch (rollbackError) { console.error('[POST /wms/location-callback] rollback error:', rollbackError); }
        }
        console.error('[POST /wms/location-callback] error:', error);
        const sqlErrorNumber = error.number ?? error.originalError?.info?.number;
        const statusCode = error.statusCode || (sqlErrorNumber === 51041 ? 404 :
            [51042, 51043].includes(sqlErrorNumber) ? 400 : 500);
        return res.status(statusCode).json({
            success: false,
            palletID,
            message: statusCode === 500 ? 'Internal Server Error' : error.message,
            ...(options.isTest && statusCode === 500 ? {
                stage: processingStage,
                detail: error.message,
                sqlErrorNumber: sqlErrorNumber || null,
            } : {}),
        });
    }
});

/** Xem trước đúng payload ERP sẽ gửi tới POST /api/share/wmsOutbound. */
router.get('/wms/outbound-orders/:id', checkApiKey, async (req, res) => {
    const idPhieuXuat = Number(req.params.id);
    if (!Number.isSafeInteger(idPhieuXuat) || idPhieuXuat <= 0 || idPhieuXuat > 2147483647) {
        return res.status(400).json({ ok: false, message: 'ID phiếu xuất không hợp lệ' });
    }

    try {
        const pool = await tagpoolPromise;
        const result = await pool.request()
            .input('ID_PhieuXuatBTP', sql.Int, idPhieuXuat)
            .execute('dbo.App_BTP_PhieuXuat_ThongTinChiTiet');
        const header = result.recordsets?.[0]?.[0];
        const details = result.recordsets?.[1] || [];

        if (!header) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy phiếu xuất' });
        }
        if (!header.QrStatus) {
            return res.status(409).json({ ok: false, message: 'Phiếu xuất chưa được xác nhận' });
        }

        const date = new Date(header.Ngay_Lap);
        const items = details.map((row) => ({
            itemCode: row.ItemCode == null ? '' : String(row.ItemCode).trim(),
            itemName: row.Ten_SanPham == null ? '' : String(row.Ten_SanPham).trim(),
            // LOT của WMS là dấu tuần trên chi tiết kiện, không phải số lô sản xuất
            // của đơn hàng. Stored procedure hiện chưa trả DauTuan nên không được
            // lấy So_LoSanXuat để thay thế.
            ...(row.DauTuan == null || String(row.DauTuan).trim() === ''
                ? {}
                : { lot: String(row.DauTuan).trim() }),
            quantity: Number(row.SoLuong_XuatKho)
        }));

        if (
            !header.So_PhieuXuatBTP ||
            !Number.isFinite(date.getTime()) ||
            items.length === 0 ||
            items.some((item) => !item.itemCode || !item.itemName ||
                !Number.isSafeInteger(item.quantity) || item.quantity <= 0)
        ) {
            return res.status(422).json({
                ok: false,
                message: 'Dữ liệu phiếu xuất chưa đủ hoặc không đúng định dạng WMS'
            });
        }

        return res.json({
            ok: true,
            data: {
                orderID: String(idPhieuXuat),
                orderCode: String(header.So_PhieuXuatBTP),
                orderType: 'OUTBOUND',
                date: date.toISOString(),
                items
            }
        });
    } catch (error) {
        console.error('[GET /wms/outbound-orders/:id] error:', error);
        return res.status(500).json({ ok: false, message: 'Không thể tạo dữ liệu phiếu xuất WMS' });
    }
});

router.post('/wms/outbound-callback', checkApiKey, async (req, res) => {
    const body = req.body || {};
    const orderID = typeof body.orderID === 'string' ? body.orderID.trim() : '';
    const idPhieuXuat = /^\d+$/.test(orderID) ? Number(orderID) : null;
    const orderCode = typeof body.orderCode === 'string' ? body.orderCode.trim() : '';
    const status = typeof body.status === 'string' ? body.status.trim() : '';
    const items = body.items;
    const badPayload = () => res.status(400).json({
        success: false, orderID: orderID || null, message: 'Invalid callback payload'
    });

    if (!Number.isSafeInteger(idPhieuXuat) || idPhieuXuat <= 0 || idPhieuXuat > 2147483647 ||
        !orderCode || body.orderType !== 'OUTBOUND' ||
        !['COMPLETED', 'PARTIAL', 'FAILED'].includes(status) ||
        typeof body.processedAt !== 'string' || !Number.isFinite(Date.parse(body.processedAt)) ||
        !Array.isArray(items) || items.length === 0) {
        return badPayload();
    }

    const normalizedItems = [];
    const itemLotKeys = new Set();
    let hasExported = false;
    let hasShortfall = false;

    for (const item of items) {
        const itemCode = typeof item?.itemCode === 'string' ? item.itemCode.trim() : '';
        const lot = item?.lot == null ? '' : String(item.lot).trim();
        const requestedQuantity = item?.requestedQuantity;
        const exportedQuantity = item?.exportedQuantity;
        const itemLotKey = JSON.stringify([itemCode, lot]);
        if (!itemCode || !lot || lot.length > 50 || itemLotKeys.has(itemLotKey) ||
            !Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0 ||
            !Number.isSafeInteger(exportedQuantity) || exportedQuantity < 0 ||
            exportedQuantity > requestedQuantity || !Array.isArray(item.pallets)) {
            return badPayload();
        }
        itemLotKeys.add(itemLotKey);

        const palletIDs = new Set();
        let palletTotal = 0;
        const pallets = [];
        for (const pallet of item.pallets) {
            const palletID = typeof pallet?.palletID === 'string' ? pallet.palletID.trim() : '';
            const quantity = pallet?.quantity;
            if (!palletID || palletIDs.has(palletID) ||
                !Number.isSafeInteger(quantity) || quantity <= 0) return badPayload();
            palletIDs.add(palletID);
            palletTotal += quantity;
            pallets.push({ palletID, quantity });
        }
        if (palletTotal !== exportedQuantity) return badPayload();
        if (exportedQuantity > 0) hasExported = true;
        if (exportedQuantity < requestedQuantity) hasShortfall = true;
        normalizedItems.push({ itemCode, lot, requestedQuantity, exportedQuantity, pallets });
    }

    if ((status === 'COMPLETED' && hasShortfall) ||
        (status === 'PARTIAL' && (!hasExported || !hasShortfall)) ||
        (status === 'FAILED' && hasExported)) return badPayload();

    let transaction;
    let finished = false;
    const callbackError = (statusCode, message) => {
        const error = new Error(message);
        error.statusCode = statusCode;
        return error;
    };

    try {
        const pool = await tagpoolPromise;
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const order = await new sql.Request(transaction)
            .input('OrderID', sql.Int, idPhieuXuat)
            .query(`SELECT So_PhieuXuatBTP, QrStatus FROM dbo.PhieuXuatBTP WITH (UPDLOCK, HOLDLOCK)
                    WHERE ID_PhieuXuatBTP = @OrderID AND TonTai = 1;`);
        if (!order.recordset.length) throw callbackError(404, 'Order or pallet not found');
        if (order.recordset[0].So_PhieuXuatBTP !== orderCode) {
            throw callbackError(400, 'Invalid callback payload');
        }
        if (!order.recordset[0].QrStatus) {
            throw callbackError(400, 'Phiếu xuất chưa được xác nhận');
        }

        const craneOrder = craneWms.getCraneConfig()
            ? await craneWms.findCraneOrder(transaction, idPhieuXuat, true) : null;
        const callbackFingerprint = craneWms.outboundFingerprint(status, normalizedItems);
        if (craneOrder?.CallbackJson) {
            if (craneOrder.CallbackJson !== callbackFingerprint)
                throw callbackError(409, 'Phiếu cầu trục đã có kết quả WMS khác');
            await transaction.commit();
            finished = true;
            return res.status(200).json({ success: true, orderID, duplicate: true, message: 'Callback received' });
        }
        if (craneOrder && status === 'FAILED') {
            await new sql.Request(transaction).input('OrderID', sql.Int, idPhieuXuat)
                .query(`UPDATE dbo.CraneWmsOutbound SET Status='FAILED_RETRY', UpdatedAt=SYSUTCDATETIME()
                        WHERE ID_PhieuXuatBTP=@OrderID;
                        UPDATE dbo.CraneWmsOutboundPallet SET Status='FAILED_RETRY'
                        WHERE ID_PhieuXuatBTP=@OrderID AND Status='WAITING_WMS'`);
            await transaction.commit();
            finished = true;
            return res.status(200).json({ success: true, orderID, message: 'Awaiting WMS retry' });
        }
        if (craneOrder && !['WAITING_WMS', 'FAILED_RETRY'].includes(craneOrder.Status))
            throw callbackError(409, 'Phiếu cầu trục không chờ kết quả xuất WMS');

        const detailResult = await new sql.Request(transaction)
            .input('ID_PhieuXuatBTP', sql.Int, idPhieuXuat)
            .execute('dbo.App_BTP_PhieuXuat_ThongTinChiTiet');
        const details = detailResult.recordsets?.[1] || [];
        if (details.length === 0) throw callbackError(400, 'Invalid callback payload');

        // So_LoSanXuat thuộc đơn hàng và không phải LOT của WMS. Đối chiếu yêu cầu
        // theo tổng ItemCode để một dòng phiếu có thể được WMS tách thành nhiều
        // DauTuan khác nhau.
        const detailBuckets = new Map();
        for (const row of details) {
            const itemCode = String(row.ItemCode || '').trim();
            const requestedQuantity = Number(row.SoLuong_XuatKho);
            if (!itemCode || !Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0) {
                throw callbackError(400, 'Invalid callback payload');
            }
            if (!detailBuckets.has(itemCode)) detailBuckets.set(itemCode, []);
            detailBuckets.get(itemCode).push({
                row,
                remainingRequested: requestedQuantity
            });
        }

        const callbackRequestedTotals = new Map();
        for (const item of normalizedItems) {
            callbackRequestedTotals.set(
                item.itemCode,
                (callbackRequestedTotals.get(item.itemCode) || 0) + item.requestedQuantity
            );
        }
        if (callbackRequestedTotals.size !== detailBuckets.size) {
            throw callbackError(400, 'Invalid callback payload');
        }
        for (const [itemCode, bucket] of detailBuckets) {
            const expected = bucket.reduce(
                (sum, detail) => sum + detail.remainingRequested,
                0
            );
            if (callbackRequestedTotals.get(itemCode) !== expected) {
                throw callbackError(400, 'Invalid callback payload');
            }
        }

        // Phân bổ phần số lượng yêu cầu của từng DauTuan vào các dòng chi tiết ERP.
        // Việc phân bổ này chỉ dùng ID đơn hàng để ghi bảng liên kết; LOT vẫn luôn
        // được xác định từ TheKhoKienBTP_ChiTiet.DauTuan.
        for (const item of normalizedItems) {
            let remaining = item.requestedQuantity;
            const bucket = detailBuckets.get(item.itemCode);
            item.detailAllocations = [];
            for (const detail of bucket) {
                if (remaining === 0) break;
                if (detail.remainingRequested === 0) continue;
                const quantity = Math.min(remaining, detail.remainingRequested);
                item.detailAllocations.push({
                    row: detail.row,
                    requestedQuantity: quantity,
                    exportedQuantity: 0
                });
                detail.remainingRequested -= quantity;
                remaining -= quantity;
            }
            if (remaining !== 0) throw callbackError(400, 'Invalid callback payload');
        }

        const usedPackageDetailIDs = new Set();
        const links = [];
        const cranePallets = craneOrder ? (await new sql.Request(transaction)
            .input('OrderID', sql.Int, idPhieuXuat)
            .query(`SELECT * FROM dbo.CraneWmsOutboundPallet WITH (UPDLOCK, HOLDLOCK)
                    WHERE ID_PhieuXuatBTP=@OrderID`)).recordset : [];
        let craneOutcomes = [];
        if (craneOrder) {
            craneOutcomes = craneWms.reconcilePallets(cranePallets, normalizedItems);
            const plannedItems = JSON.parse(craneOrder.RequestJson).items || [];
            const planned = new Map();
            const actual = new Map();
            const keyOf = (palletID, itemCode, lot) => JSON.stringify([palletID, itemCode, lot]);
            for (const item of plannedItems) {
                const key = keyOf(item.palletID, item.itemCode, item.lot);
                planned.set(key, (planned.get(key) || 0) + Number(item.quantity));
            }
            for (const item of normalizedItems) for (const pallet of item.pallets) {
                const key = keyOf(pallet.palletID, item.itemCode, item.lot);
                actual.set(key, (actual.get(key) || 0) + pallet.quantity);
            }
            for (const [key, quantity] of actual) {
                if (quantity > (planned.get(key) || 0))
                    throw callbackError(409, 'WMS trả về mặt hàng hoặc dấu tuần khác lựa chọn trên app');
            }
            await craneWms.assertTemporaryLocation(transaction, craneWms.getCraneConfig());
        }
        for (const item of normalizedItems) {
            for (const pallet of item.pallets) {
                const packageDetail = await new sql.Request(transaction)
                    .input('QRCode', sql.NVarChar(255), pallet.palletID)
                    .input('ItemCode', sql.NVarChar(255), item.itemCode)
                    .input('Lot', sql.NVarChar(50), item.lot)
                    .query(`
                        SELECT d.ID_TheKhoKienBTP_ChiTiet
                        FROM dbo.TheKhoKienBTP AS k WITH (UPDLOCK, HOLDLOCK)
                        JOIN dbo.TheKhoKienBTP_ChiTiet AS d WITH (UPDLOCK, HOLDLOCK)
                          ON d.ID_TheKhoKienBTP = k.ID_TheKhoKienBTP
                        WHERE k.QRCode = @QRCode AND k.TonTai = 1
                          AND d.TonTai = 1 AND LTRIM(RTRIM(d.ItemCode)) = @ItemCode
                          AND LTRIM(RTRIM(ISNULL(d.DauTuan, N''))) = @Lot;
                    `);
                if (packageDetail.recordset.length !== 1) {
                    throw callbackError(404, 'Order or pallet not found');
                }

                const packageDetailID = packageDetail.recordset[0].ID_TheKhoKienBTP_ChiTiet;
                if (usedPackageDetailIDs.has(packageDetailID)) {
                    throw callbackError(400, 'Invalid callback payload');
                }
                usedPackageDetailIDs.add(packageDetailID);

                let remainingPalletQuantity = pallet.quantity;
                for (const allocation of item.detailAllocations) {
                    if (remainingPalletQuantity === 0) break;
                    const available = allocation.requestedQuantity - allocation.exportedQuantity;
                    if (available === 0) continue;
                    const quantity = Math.min(remainingPalletQuantity, available);
                    const detail = allocation.row;
                    links.push({
                        orderID: Number(detail.ID_DonHang) || 0,
                        lotID: Number(detail.ID_DonHang_LoSanXuat) || 0,
                        productID: Number(detail.ID_DonHang_SanPham) || 0,
                        packageDetailID,
                        quantity
                    });
                    allocation.exportedQuantity += quantity;
                    remainingPalletQuantity -= quantity;
                }
                if (remainingPalletQuantity !== 0) {
                    throw callbackError(400, 'Invalid callback payload');
                }
            }
        }

        const existingResult = await new sql.Request(transaction)
            .input('OrderID', sql.Int, idPhieuXuat)
            .query(`SELECT ID_DonHang, ID_DonHang_LoSanXuat, ID_DonHang_SanPham,
                           ID_TheKhoKienBTP_ChiTiet, SoLuong_XuatKho
                    FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien WITH (UPDLOCK, HOLDLOCK)
                    WHERE ID_PhieuXuatBTP = @OrderID;`);
        const linkKey = (x) => [x.orderID, x.lotID, x.productID,
            x.packageDetailID, x.quantity].join('|');
        const incomingKeys = links.map(linkKey).sort();
        const existingKeys = existingResult.recordset.map((row) => linkKey({
            orderID: row.ID_DonHang,
            lotID: row.ID_DonHang_LoSanXuat,
            productID: row.ID_DonHang_SanPham,
            packageDetailID: row.ID_TheKhoKienBTP_ChiTiet,
            quantity: Number(row.SoLuong_XuatKho)
        })).sort();

        if (JSON.stringify(incomingKeys) !== JSON.stringify(existingKeys)) {
            await new sql.Request(transaction)
                .input('OrderID', sql.Int, idPhieuXuat)
                .query(`DELETE FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien
                        WHERE ID_PhieuXuatBTP = @OrderID;`);
            for (const link of links) {
                await new sql.Request(transaction)
                    .input('OrderID', sql.Int, idPhieuXuat)
                    .input('ID_DonHang', sql.Int, link.orderID)
                    .input('ID_DonHang_LoSanXuat', sql.Int, link.lotID)
                    .input('ID_DonHang_SanPham', sql.Int, link.productID)
                    .input('ID_TheKhoKienBTP_ChiTiet', sql.Int, link.packageDetailID)
                    .input('SoLuong_XuatKho', sql.Decimal(18, 2), link.quantity)
                    .query(`INSERT INTO dbo.PhieuXuatBTP_ChiTiet_TheKhoKien
                            (ID_PhieuXuatBTP, ID_DonHang, ID_DonHang_LoSanXuat,
                             ID_DonHang_SanPham, ID_TheKhoKienBTP_ChiTiet, SoLuong_XuatKho)
                            VALUES (@OrderID, @ID_DonHang, @ID_DonHang_LoSanXuat,
                                    @ID_DonHang_SanPham, @ID_TheKhoKienBTP_ChiTiet,
                                    @SoLuong_XuatKho);`);
            }
        }

        if (craneOrder) {
            let waitingReturn = false;
            for (const pallet of craneOutcomes) {
                const actual = pallet.actual;
                const nextStatus = pallet.nextStatus;
                if (nextStatus === 'WAITING_RETURN') {
                    await new sql.Request(transaction)
                        .input('ID_TheKhoKienBTP', sql.Int, pallet.ID_TheKhoKienBTP)
                        .input('ID_ViTriKho', sql.Int, craneWms.getCraneConfig().temporaryLocationID)
                        .input('ID_TaiKhoan', sql.Int, null)
                        .input('LoaiThaoTac', sql.VarChar(20), 'DIEU_CHUYEN')
                        .execute('dbo.App_BTP_CapNhatViTriKien');
                    waitingReturn = true;
                }
                await new sql.Request(transaction)
                    .input('OrderID', sql.Int, idPhieuXuat)
                    .input('PackageID', sql.Int, pallet.ID_TheKhoKienBTP)
                    .input('Actual', sql.Decimal(18,2), actual)
                    .input('NextStatus', sql.VarChar(24), nextStatus)
                    .query(`UPDATE dbo.CraneWmsOutboundPallet SET ActualQuantity=@Actual, Status=@NextStatus
                            WHERE ID_PhieuXuatBTP=@OrderID AND ID_TheKhoKienBTP=@PackageID`);
            }
            await new sql.Request(transaction)
                .input('OrderID', sql.Int, idPhieuXuat)
                .input('CallbackJson', sql.NVarChar(sql.MAX), callbackFingerprint)
                .input('NextStatus', sql.VarChar(24), waitingReturn ? 'WAITING_RETURN' : 'COMPLETE')
                .query(`UPDATE dbo.CraneWmsOutbound SET Status=@NextStatus, CallbackJson=@CallbackJson,
                        UpdatedAt=SYSUTCDATETIME() WHERE ID_PhieuXuatBTP=@OrderID`);
        }

        await transaction.commit();
        finished = true;
        return res.status(200).json({
            success: true, orderID, message: 'Callback received'
        });
    } catch (error) {
        if (transaction && !finished) {
            try { await transaction.rollback(); }
            catch (rollbackError) {
                console.error('[POST /wms/outbound-callback] rollback error:', rollbackError);
            }
        }
        console.error('[POST /wms/outbound-callback] error:', error);
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            orderID: orderID || null,
            message: statusCode === 500 ? 'Internal Server Error' : error.message
        });
    }
});

router.get('/wms/inbound-orders/:id',  async (req, res) => {
    try {
        const idPhieuNhap = Number(req.params.id);

        if (!Number.isInteger(idPhieuNhap) || idPhieuNhap <= 0) {
            return res.status(400).json({
                ok: false,
                message: 'ID phiếu nhập không hợp lệ'
            });
        }

        const pool = await tagpoolPromise;

        const result = await pool.request()
            .input('ID_PhieuNhapBTP', sql.Int, idPhieuNhap)
            .execute('dbo.App_PhieuNhapBTP_ThongTinChiTiet');

        const header = result.recordsets?.[0]?.[0] || null;
        const chiTietPhieu = result.recordsets?.[1] || [];
        const thongTinKien = result.recordsets?.[2] || [];
        const chiTietKien = result.recordsets?.[3] || [];

        if (!header) {
            return res.status(404).json({
                ok: false,
                message: 'Không tìm thấy phiếu nhập'
            });
        }

        const palletMap = new Map();

        for (const row of chiTietKien) {
            const key = row.ID_TheKhoKienBTP;

            if (!palletMap.has(key)) {
                palletMap.set(key, {
                    palletID: row.QrCode,
                    items: []
                });
            }

            palletMap.get(key).items.push({
                itemCode: row.ItemCode,
                itemName: row.Ten_SanPham,
                Lot: row.DauTuan,
                quantity: Number(row.SoLuongTon || 0)
            });
        }

            return res.json({
                ok: true,
                data: {
                    orderID: String(header.ID_PhieuNhapBTP),
                    orderCode: header.So_PhieuNhapBTP,
                    orderType: 'INBOUND',
                    date: header.Ngay_NhapBTP,

                    chiTietPhieu,
                    thongTinKien,

                    pallets: [...palletMap.values()]
                }
            });

    } catch (error) {
        console.error('[GET /wms/inbound-orders/:id] error:', error);

        return res.status(500).json({
            ok: false,
            message: error.message || 'Lỗi không xác định'
        });
    }
});

// ==========================================
// WMS - DANH SÁCH PHIẾU NHẬP BTP
// ==========================================
router.get('/wms/inbound-orders', async (req, res) => {
    try {
        const page = Math.max(Number(req.query.page) || 0, 0);

        const pageSize = Math.min(
            Math.max(Number(req.query.pageSize) || 100, 1),
            500
        );

        const soPhieu = String(req.query.soPhieu || '').trim();

        const skip = page * pageSize;

        const pool = await tagpoolPromise;

        const request = pool.request()
            .input('SoPhieu', sql.NVarChar(100), soPhieu)
            .input('Skip', sql.Int, skip)
            .input('Take', sql.Int, pageSize);

        const result = await request.query(`
            SELECT
                a.ID_PhieuNhapBTP AS orderID,
                a.So_PhieuNhapBTP AS orderCode,
                a.Ngay_NhapBTP AS date,

                a.ID_KhoNhap AS warehouseID,
                kn.Ten_Kho AS warehouseName,

                a.ID_HinhThucNhapBTP AS inboundTypeID,
                ht.Ten_HinhThucNhapBTP AS inboundType,

                a.QrStatus AS qrStatus,

                CASE
                    WHEN a.ID_DonVi = 32
                        THEN RIGHT(bp.Ten_BoPhan, 30)

                    WHEN a.ID_DonVi IS NULL
                         AND a.ID_BoPhan IS NULL
                        THEN RIGHT(ncc.Ten_NhaCungCap, 30)

                    ELSE dv.Ten_DonVi
                END AS customer,

                dh.Ma_DonHang AS orderReference

            FROM dbo.PhieuNhapBTP a

            INNER JOIN (
                SELECT
                    ID_PhieuNhapBTP,
                    MAX(ID_DonHang) AS ID_DonHang
                FROM dbo.PhieuNhapBTP_ChiTiet
                GROUP BY ID_PhieuNhapBTP
            ) tendon
                ON tendon.ID_PhieuNhapBTP = a.ID_PhieuNhapBTP

            LEFT JOIN dbo.DonHang dh
                ON dh.ID_DonHang = tendon.ID_DonHang

            INNER JOIN dbo.DM_Kho kn
                ON kn.ID_Kho = a.ID_KhoNhap

            LEFT JOIN dbo.DM_HinhThucNhapBTP ht
                ON ht.ID_HinhThucNhapBTP = a.ID_HinhThucNhapBTP

            LEFT JOIN TAG_System.dbo.DM_DonVi dv
                ON dv.ID_DonVi = a.ID_DonVi

            LEFT JOIN TAG_System.dbo.DM_BoPhan bp
                ON bp.ID_BoPhan = a.ID_BoPhan

            LEFT JOIN dbo.DM_NhaCungCap ncc
                ON ncc.ID_NhaCungCap = a.ID_NhaCungCap

            WHERE
                a.TrangThai NOT IN (4, 5)
                AND a.TonTai = 1
                AND a.ID_HinhThucNhapBTP <> 8
                AND a.ID_KhoNhap NOT IN (12, 13, 15)

                AND (
                    @SoPhieu = ''
                    OR a.So_PhieuNhapBTP LIKE '%' + @SoPhieu + '%'
                )

            ORDER BY
                a.Ngay_NhapBTP DESC

            OFFSET @Skip ROWS
            FETCH NEXT @Take ROWS ONLY;
        `);

        const data = result.recordset || [];

        return res.json({
            ok: true,
            page,
            pageSize,
            count: data.length,
            data
        });

    } catch (error) {
        console.error('[GET /wms/inbound-orders] error:', error);

        return res.status(500).json({
            ok: false,
            message: error.message || 'Lỗi không xác định'
        });
    }
});

return router
}

const { tagpoolPromise } = require('../../db2');
module.exports = createErpRouter(tagpoolPromise)
module.exports.createRouter = createErpRouter
module.exports.normalizeLocationReference = normalizeLocationReference
module.exports.resolveActiveWarehouseLocation = resolveActiveWarehouseLocation
