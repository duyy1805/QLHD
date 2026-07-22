const express = require('express')
const router = express.Router()
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { verifyToken, verifyAdmin } = require('../../middleware/auth');
const { tagpoolPromise } = require('../../db2');
const sql = require('mssql');
const checkApiKey = require('../../middleware/apiKey');


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
            .execute('dbo.DonHang_VatTu_DinhMuc_ChiTiet');

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

/**
 * GET /kehoachsanxuat
 *
 * Lấy danh sách kế hoạch sản xuất từ ERP.
 * Stored procedure không có tham số đầu vào.
 */
router.get('/kehoachsanxuat', async (req, res) => {
    try {
        const pool = await tagpoolPromise;

        const result = await pool.request()
            .execute('dbo.NangSuat_Get_KeHoachSanXuat_Ngay');

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
module.exports = router