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
module.exports = router