const express = require('express')
const router = express.Router()
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const { poolPromise } = require('../db');
const sql = require('mssql');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 📁 Cấu hình thư mục lưu file
const uploadDir = 'C:/VanBanDi/Upload';
// 🛠️ Tạo thư mục nếu chưa tồn tại
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
// 📦 Cấu hình multer để lưu file PDF
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    },
});
const upload = multer({ storage });

router.post('/vanbandi', async (req, res) => {
    try {
        const { SoVanBan, TenCoQuan } = req.body;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('SoVanBan', sql.NVarChar(50), SoVanBan || null)
            .input('TenCoQuan', sql.NVarChar(255), TenCoQuan || null)
            .execute('HD_VanBanDi_Get');

        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send('Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.');
    }
});
router.get('/lookup-vanbandi', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().execute('HD_GetLookUpVBD');

        res.json({
            loaiVanBan: result.recordsets[0],
            coQuan: result.recordsets[1],
            nguoiKy: result.recordsets[2],
        });
    } catch (err) {
        console.error('Lỗi khi lấy lookup văn bản đi:', err);
        res.status(500).send('Lỗi khi lấy dữ liệu lookup văn bản đi.');
    }
});


// ✅ API thêm văn bản đi
router.post('/them-vanbandi', upload.single('file'), async (req, res) => {
    try {
        const {
            TenVanBan, NgayVanBan, NguoiKyId,
            NoiNhanId, LoaiVanBanId,
            SoLuongBan, NgayChuyen, GhiChu, CreatedBy
        } = req.body;

        const file = req.file;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('TenVanBan', sql.NVarChar(255), TenVanBan)
            .input('NgayVanBan', sql.Date, NgayVanBan)
            .input('NguoiKyId', sql.Int, NguoiKyId)
            .input('NoiNhanId', sql.Int, NoiNhanId)
            .input('LoaiVanBanDiId', sql.Int, LoaiVanBanId)
            .input('SoLuongBan', sql.Int, SoLuongBan)
            .input('NgayChuyen', sql.Date, NgayChuyen)
            .input('GhiChu', sql.NVarChar(sql.MAX), GhiChu)
            .input('CreatedBy', sql.Int, CreatedBy)
            .output('SoVanBan', sql.NVarChar(50))
            .execute('HD_VanBanDi_Add');

        const soVanBan = result.output.SoVanBan;
        const newRecord = result.recordset?.[0];
        let finalPath = null;

        if (file && soVanBan) {
            const newFileName = soVanBan.replace(/\//g, '-') + '.pdf'; // Ex: 001-BC-CNTT.pdf
            const finalFilePath = path.join(uploadDir, newFileName);
            fs.renameSync(file.path, finalFilePath);

            finalPath = finalFilePath.replace(/\\/g, '/');

            // Cập nhật lại FilePath sau khi rename
            await pool.request()
                .input('SoVanBan', sql.NVarChar(50), soVanBan)
                .input('FilePath', sql.NVarChar(500), finalPath)
                .query(`
                    UPDATE HD_VanBanDi
                    SET FilePath = @FilePath
                    WHERE SoVanBan = @SoVanBan
                `);
        }

        res.json({
            success: true,
            message: 'Thêm văn bản đi thành công.',
            soVanBan,
            filePath: finalPath,
            data: newRecord
        });

    } catch (err) {
        console.error('❌ Lỗi khi thêm văn bản đi:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi thêm văn bản đi.' });
    }
});

router.put('/sua-vanbandi', upload.single('file'), async (req, res) => {
    try {
        const {
            Id,
            TenVanBan,
            NgayVanBan,
            NguoiKyId,
            NoiNhanId,
            LoaiVanBanId,
            SoLuongBan,
            NgayChuyen,
            GhiChu,
            UpdatedBy
        } = req.body;

        const file = req.file;
        const pool = await poolPromise;

        // 🔍 Lấy thông tin hiện tại của văn bản
        const oldData = await pool.request()
            .input('Id', sql.Int, Id)
            .query(`
                SELECT SoVanBan, FilePath
                FROM HD_VanBanDi
                WHERE Id = @Id
            `);

        if (!oldData.recordset.length) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy văn bản.' });
        }

        const { SoVanBan, FilePath: oldFilePath } = oldData.recordset[0];
        let finalPath = oldFilePath;

        // 📂 Nếu có file mới: đổi tên và ghi đè
        if (file && SoVanBan) {
            const newFileName = SoVanBan.replace(/\//g, '-') + '.pdf';
            const finalFilePath = path.join(uploadDir, newFileName);

            // ❌ Xoá file cũ nếu tồn tại
            if (oldFilePath && fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath);
            }

            // 📥 Ghi file mới
            fs.renameSync(file.path, finalFilePath);
            finalPath = finalFilePath.replace(/\\/g, '/');
        }

        // ✅ Cập nhật thông tin văn bản đi
        await pool.request()
            .input('Id', sql.Int, Id)
            .input('TenVanBan', sql.NVarChar(255), TenVanBan)
            .input('NgayVanBan', sql.Date, NgayVanBan)
            .input('NguoiKyId', sql.Int, NguoiKyId)
            .input('NoiNhanId', sql.Int, NoiNhanId)
            .input('LoaiVanBanDiId', sql.Int, LoaiVanBanId)
            .input('SoLuongBan', sql.Int, SoLuongBan)
            .input('NgayChuyen', sql.Date, NgayChuyen)
            .input('GhiChu', sql.NVarChar(sql.MAX), GhiChu)
            .input('FilePath', sql.NVarChar(500), finalPath)
            .input('UpdatedBy', sql.Int, UpdatedBy)
            .query(`
                UPDATE HD_VanBanDi
                SET
                    TenVanBan = @TenVanBan,
                    NgayVanBan = @NgayVanBan,
                    NguoiKyId = @NguoiKyId,
                    NoiNhanId = @NoiNhanId,
                    LoaiVanBanDiId = @LoaiVanBanDiId,
                    SoLuongBan = @SoLuongBan,
                    NgayChuyen = @NgayChuyen,
                    GhiChu = @GhiChu,
                    FilePath = @FilePath,
                    UpdatedAt = GETDATE(),
                    UpdatedBy = @UpdatedBy
                WHERE Id = @Id
            `);

        res.json({
            success: true,
            message: 'Cập nhật văn bản đi thành công.',
            filePath: finalPath
        });

    } catch (err) {
        console.error('❌ Lỗi khi sửa văn bản đi:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi sửa văn bản đi.' });
    }
});

module.exports = router;