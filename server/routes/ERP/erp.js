const express = require('express')
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { verifyToken, verifyAdmin } = require('../../middleware/auth');
const sql = require('mssql');
const checkApiKey = require('../../middleware/apiKey');
const XLSX = require('xlsx');

function createErpRouter(tagpoolPromise) {
const router = express.Router()

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
        const locationID = pallet?.locationID == null
            ? null
            : Number(pallet.locationID);

        if (
            !palletID ||
            palletIDs.has(palletID) ||
            !['COMPLETED', 'FAILED'].includes(palletStatus) ||
            (palletStatus === 'COMPLETED' &&
                (!Number.isInteger(locationID) || locationID <= 0 || locationID > 2147483647))
        ) {
            return res.status(400).json({
                success: false,
                orderID,
                message: 'Invalid callback payload'
            });
        }

        palletIDs.add(palletID);
        normalizedPallets.push({ palletID, status: palletStatus, locationID });
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
                SELECT ID_PhieuNhapBTP
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

        let updatedCount = 0;

        for (const pallet of normalizedPallets) {
            if (pallet.status !== 'COMPLETED') continue;

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

            // WMS có thể gửi lại callback. Không cập nhật/lưu lịch sử lần nữa
            // nếu kiện đã ở đúng vị trí.
            if (Number(packageRow.ID_ViTriKho) === pallet.locationID) continue;

            await new sql.Request(transaction)
                .input('ID_TheKhoKienBTP', sql.Int, packageRow.ID_TheKhoKienBTP)
                .input('ID_ViTriKho', sql.Int, pallet.locationID)
                .input('ID_TaiKhoan', sql.Int, null)
                .input('LoaiThaoTac', sql.VarChar(20), 'GAN_VI_TRI_NHAP')
                .execute('dbo.App_BTP_CapNhatViTriKien');

            updatedCount += 1;
        }

        await transaction.commit();
        transactionFinished = true;

        console.info('[POST /wms/inbound-callback] processed:', {
            orderID,
            status,
            updatedCount,
            processedAt
        });

        return res.status(200).json({
            success: true,
            orderID,
            message: 'Callback received'
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
            ...(row.So_LoSanXuat == null || String(row.So_LoSanXuat).trim() === ''
                ? {}
                : { lot: String(row.So_LoSanXuat).trim() }),
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
    let hasExported = false;
    let hasShortfall = false;

    for (const item of items) {
        const itemCode = typeof item?.itemCode === 'string' ? item.itemCode.trim() : '';
        const lot = item?.lot == null ? null : String(item.lot).trim() || null;
        const requestedQuantity = item?.requestedQuantity;
        const exportedQuantity = item?.exportedQuantity;
        if (!itemCode || !Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0 ||
            !Number.isSafeInteger(exportedQuantity) || exportedQuantity < 0 ||
            exportedQuantity > requestedQuantity || !Array.isArray(item.pallets)) {
            return badPayload();
        }

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
        normalizedItems.push({ itemCode, lot, requestedQuantity, pallets });
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

        const detailResult = await new sql.Request(transaction)
            .input('ID_PhieuXuatBTP', sql.Int, idPhieuXuat)
            .execute('dbo.App_BTP_PhieuXuat_ThongTinChiTiet');
        const details = detailResult.recordsets?.[1] || [];
        if (details.length !== normalizedItems.length) {
            throw callbackError(400, 'Invalid callback payload');
        }

        const usedDetailIndexes = new Set();
        const links = [];
        for (const item of normalizedItems) {
            const candidates = details.map((row, index) => ({ row, index }))
                .filter(({ row, index }) => !usedDetailIndexes.has(index) &&
                    String(row.ItemCode || '').trim() === item.itemCode &&
                    (item.lot === null || String(row.So_LoSanXuat || '').trim() === item.lot));
            if (candidates.length !== 1 ||
                Number(candidates[0].row.SoLuong_XuatKho) !== item.requestedQuantity) {
                throw callbackError(400, 'Invalid callback payload');
            }
            const { row: detail, index } = candidates[0];
            usedDetailIndexes.add(index);

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
                          AND d.TonTai = 1 AND d.ItemCode = @ItemCode
                          AND (@Lot IS NULL OR d.DauTuan = @Lot);
                    `);
                if (packageDetail.recordset.length !== 1) {
                    throw callbackError(404, 'Order or pallet not found');
                }
                links.push({
                    orderID: Number(detail.ID_DonHang) || 0,
                    lotID: Number(detail.ID_DonHang_LoSanXuat) || 0,
                    productID: Number(detail.ID_DonHang_SanPham) || 0,
                    packageDetailID: packageDetail.recordset[0].ID_TheKhoKienBTP_ChiTiet,
                    quantity: pallet.quantity
                });
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
