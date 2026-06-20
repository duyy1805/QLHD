const express = require('express');
const router = express.Router();
const { poolPromise } = require('../db');
const sql = require('mssql');
const { uploadImage } = require('../middleware/upload');
const fs = require('fs');
const path = require('path');

// =======================
// GET: danh sách dữ liệu
// =======================
router.get('/thuthap', async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request().query(`
            SELECT 
                Id,
                DonVi,
                NoiDung,
                AnhPath,
                ThoiGianTao
            FROM ThuThapThongTin
            ORDER BY ThoiGianTao DESC
        `);

        res.json({
            success: true,
            data: result.recordset
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: 'Không lấy được dữ liệu'
        });
    }
});

// =======================
// POST: gửi dữ liệu + ảnh
// =======================
router.post(
    '/thuthap',
    uploadImage.single('image'),
    async (req, res) => {
        try {
            const { unit, content } = req.body;

            if (!unit || !content || !req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'Thiếu dữ liệu'
                });
            }

            /**
             * QUAN TRỌNG:
             * - req.file.filename: tên file đã lưu trong C:/Anh5s/Upload
             * - DB chỉ lưu path public (/upload/...)
             */
            const imagePath = `/upload/${req.file.filename}`;

            const pool = await poolPromise;

            await pool.request()
                .input('DonVi', sql.NVarChar, unit)
                .input('NoiDung', sql.NVarChar, content)
                .input('AnhPath', sql.NVarChar, imagePath)
                .query(`
                    INSERT INTO ThuThapThongTin (DonVi, NoiDung, AnhPath)
                    VALUES (@DonVi, @NoiDung, @AnhPath)
                `);

            res.json({
                success: true,
                message: 'Đã ghi nhận'
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({
                success: false,
                message: 'Lỗi server'
            });
        }
    }
);

// =======================
// DELETE: xóa dữ liệu + ảnh
// =======================
router.delete('/thuthap/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPromise;

        // 1. Lấy path ảnh từ DB
        const result = await pool.request()
            .input('Id', sql.Int, id)
            .query(`
                SELECT AnhPath
                FROM ThuThapThongTin
                WHERE Id = @Id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy dữ liệu'
            });
        }

        const anhPath = result.recordset[0].AnhPath;

        // 2. Xóa file ảnh (nếu có)
        if (anhPath) {
            // /upload/abc.jpg -> C:/Anh5s/Upload/abc.jpg
            const filePath = path.join(
                'C:/Anh5s/Upload',
                path.basename(anhPath)
            );

            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // 3. Xóa record DB
        await pool.request()
            .input('Id', sql.Int, id)
            .query(`
                DELETE FROM ThuThapThongTin
                WHERE Id = @Id
            `);

        res.json({
            success: true,
            message: 'Đã xóa dữ liệu và ảnh'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi xóa dữ liệu'
        });
    }
});

module.exports = router;
