const express = require('express')
const router = express.Router()
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const { poolPromise } = require('../db');
const sql = require('mssql');

router.get("/tondautuan", async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().execute("DT_TinhSoLuongTonTheoTuan");

        res.json({
            success: true,
            data: result.recordset,
        });
    } catch (error) {
        console.error("Lỗi gọi procedure:", error);
        res.status(500).json({
            success: false,
            message: "Đã xảy ra lỗi khi lấy số lượng tồn",
        });
    }
});

router.get('/lookup', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().execute('DT_GetLookupData');

        res.json({
            sanPham: result.recordsets[0],
            nhaThau: result.recordsets[1]
        });
    } catch (err) {
        console.error('Lỗi khi lấy lookup văn bản đi:', err);
        res.status(500).send('Lỗi khi lấy dữ liệu lookup văn bản đi.');
    }
});

router.post('/themgiaodich', async (req, res) => {
    const { NhaThauId, SanPhamId, DauTuan, Nam, SoLuongNhap, SoLuongXuat } = req.body;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('NhaThauId', NhaThauId)
            .input('SanPhamId', SanPhamId)
            .input('DauTuan', DauTuan)
            .input('Nam', Nam)
            .input('SoLuongNhap', SoLuongNhap || 0)
            .input('SoLuongXuat', SoLuongXuat || 0)
            .query(`
        INSERT INTO DT_GiaoDich (NhaThauId, SanPhamId, DauTuan, Nam, SoLuongNhap, SoLuongXuat)
        VALUES (@NhaThauId, @SanPhamId, @DauTuan, @Nam, @SoLuongNhap, @SoLuongXuat)
      `);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/giao-dich', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
      SELECT 
        gd.Id, gd.DauTuan, gd.Nam, gd.SoLuongNhap, gd.SoLuongXuat, gd.ThoiGian,
        bp.Ten_BoPhan as TenNhaThau, sp.Ten_SanPham, sp.ItemCode
      FROM DT_GiaoDich gd
      JOIN TAG_QTKD.dbo.DM_NhaThau nt ON gd.NhaThauId = nt.ID_BoPhan
      JOIN TAG_QTKD.dbo.DM_SanPham sp ON gd.SanPhamId = sp.ID_SanPham
      LEFT JOIN TAG_System.dbo.DM_BoPhan bp ON nt.ID_BoPhan = bp.ID_BoPhan
      ORDER BY gd.ThoiGian DESC
    `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('Lỗi khi lấy giao dịch:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi lấy giao dịch' });
    }
});

router.get('/itemcodes/:ID_BoPhan', async (req, res) => {
    const { ID_BoPhan } = req.params;

    if (!ID_BoPhan) {
        return res.status(400).json({ message: 'Thiếu tham số ID_BoPhan' });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ID_BoPhan', sql.Int, ID_BoPhan)
            .execute('DT_LayKeHoachVaSanPhamTheoBoPhan');

        res.json({
            itemCodes: result.recordset
        });
    } catch (err) {
        console.error('Lỗi khi lấy ItemCode:', err);
        res.status(500).send('Lỗi khi lấy dữ liệu ItemCode.');
    }
});


module.exports = router;