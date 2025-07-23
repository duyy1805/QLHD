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
const { File } = require('buffer');

router.post('/hosothanhtoan', async (req, res) => {
    try {
        const { BoPhanId } = req.body;
        const pool = await poolPromise;
        const result = await pool.request()
            .input('BoPhanId', BoPhanId || null)
            .execute('HSTT_HoSoThanhToan_Get');

        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send('Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.');
    }
});

router.post('/hosothanhtoan/hosovanban', async (req, res) => {
    try {
        const { SoHoSo, BoPhanId } = req.body;
        const pool = await poolPromise;
        const result = await pool.request()
            .input('SoHoSo', SoHoSo || null)
            .input('BoPhanId', BoPhanId || null)
            .execute('HSTT_GetVanBanBy');

        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send('Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.');
    }
});

// 📁 Cấu hình thư mục lưu file
const uploadDir = 'C:/DocumentsUpload/HoSoThanhToan/Upload';

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

// ✅ API thêm hợp đồng
router.post('/them-hosothanhtoan', upload.single('file'), async (req, res) => {
    try {
        const {
            TenHoSo, CoQuanId, GhiChu, CreatedBy
        } = req.body;
        console.log('Received data:', {
            TenHoSo, CoQuanId, GhiChu, CreatedBy
        });
        const pool = await poolPromise;
        const result = await pool.request()
            .input('TenHoSo', sql.NVarChar(255), TenHoSo)
            .input('BoPhanId', sql.Int, CoQuanId)
            .input('GhiChu', sql.NVarChar(500), GhiChu)
            .input('CreatedBy', sql.Int, CreatedBy)
            .output('NewHoSoId', sql.NVarChar(50))
            .execute('HSTT_HoSoThanhToan_Add');

        const soVB = result.output.NewHoSoId;
        const newRecord = result.recordset?.[0];
        let finalPath = null;

        res.json({
            success: true,
            message: 'Thêm hồ sơ thành công.',
        });

    } catch (err) {
        console.error('❌ Lỗi khi thêm hồ sơ:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi thêm hồ sơ.' });
    }
});

// 📁 routes/hoso.js hoặc tương đương
router.put('/sua-hosothanhtoan', upload.none(), async (req, res) => {
    try {
        const {
            Id, TenHoSo, CoQuanId, GhiChu, UpdatedBy
        } = req.body;

        console.log('Received data for update:', {
            Id, TenHoSo, CoQuanId, GhiChu, UpdatedBy
        });

        const pool = await poolPromise;

        await pool.request()
            .input('Id', sql.Int, Id)
            .input('TenHoSo', sql.NVarChar(255), TenHoSo)
            .input('BoPhanId', sql.Int, CoQuanId)
            .input('GhiChu', sql.NVarChar(sql.MAX), GhiChu)
            .input('UpdatedBy', sql.Int, UpdatedBy)
            .execute('HSTT_HoSoThanhToan_Update');

        res.json({
            success: true,
            message: 'Cập nhật hồ sơ thành công.',
        });

    } catch (err) {
        console.error('❌ Lỗi khi cập nhật hồ sơ:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi cập nhật hồ sơ.' });
    }
});


router.delete('/xoa-hosothanhtoan/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPromise;

        // 1. Lấy tất cả file path từ HSTT_HoSoVanBan theo HoSoId
        const vanBanResult = await pool.request()
            .input('HoSoId', sql.Int, id)
            .query(`SELECT FilePath FROM HSTT_HoSoVanBan WHERE HoSoId = @HoSoId`);

        const filePaths = vanBanResult.recordset.map(row => row.FilePath);

        // 2. Xoá các file trong hệ thống nếu tồn tại
        filePaths.forEach(filePath => {
            if (filePath && fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                } catch (err) {
                    console.error(`⚠️ Không thể xóa file: ${filePath}`, err);
                }
            }
        });

        // 3. Gọi stored procedure để xóa dữ liệu liên quan trong DB
        await pool.request()
            .input('HoSoId', sql.Int, id)
            .execute('HSTT_DeleteHoSoThanhToan');

        res.json({ success: true, message: 'Đã xóa hồ sơ thanh toán và các file liên quan (nếu có).' });
    } catch (err) {
        console.error('❌ Lỗi khi xóa hồ sơ thanh toán:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi xóa hồ sơ thanh toán.' });
    }
});



// GET /hoso/vanban?SoHoSo=HS123&BoPhanId=5
router.get('/vanban', async (req, res) => {
    const { HoSoId, BoPhanId } = req.query;

    try {
        const pool = await poolPromise;
        const request = pool.request();

        request.input('HoSoId', sql.Int, HoSoId ? parseInt(HoSoId) : null);
        request.input('BoPhanId', sql.Int, BoPhanId ? parseInt(BoPhanId) : null);

        const result = await request.execute('HSTT_GetVanBanBy');
        res.json(result.recordset);
    } catch (err) {
        console.error('Lỗi khi lấy danh sách văn bản:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

router.post('/them-vanban', upload.single('file'), async (req, res) => {
    try {
        const {
            HoSoId, LoaiVanBanId, TieuDe, CreatedBy
        } = req.body;
        console.log('Received data for adding document:', {
            HoSoId, LoaiVanBanId, TieuDe, CreatedBy
        });
        const file = req.file;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('HoSoId', sql.Int, HoSoId)
            .input('LoaiVanBanId', sql.Int, LoaiVanBanId)
            .input('TieuDe', sql.NVarChar(255), TieuDe)
            .input('CreatedBy', sql.Int, CreatedBy)
            .output("Id", sql.Int)
            .execute('HSTT_HoSoVanBan_Add');

        let finalPath = null;

        if (file && TieuDe) {
            const newFileName = result.output.Id + '_' + TieuDe.replace(/\//g, '-') + '.pdf'; // ✅ Ví dụ: 001-Z176-TC-HD.pdf
            const finalDir = `C:/DocumentsUpload/HoSoThanhToan/Upload/${HoSoId}`;
            fs.mkdirSync(finalDir, { recursive: true });

            const newFilePath = path.join(finalDir, newFileName);
            fs.renameSync(file.path, newFilePath); // ✅ Di chuyển và đổi tên file

            finalPath = newFilePath.replace(/\\/g, '/');

            await pool.request()
                .input('Id', sql.Int, result.output.Id)
                .input('FilePath', sql.NVarChar(255), finalPath)
                .query(`
            UPDATE HSTT_HoSoVanBan
            SET FilePath = @FilePath
            WHERE Id = @Id
          `);
        }

        res.json({
            success: true,
            message: 'Thêm văn bản thành công.',
            id: result.output.Id,
            filePath: finalPath,
        });

    } catch (err) {
        console.error('❌ Lỗi khi thêm văn bản:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi thêm văn bản.' });
    }
});

router.put('/sua-vanban', upload.single('file'), async (req, res) => {
    try {
        const { Id, TieuDe, LoaiVanBanId } = req.body;
        const file = req.file;
        const pool = await poolPromise;

        // 📌 B1. Lấy file cũ (nếu có)
        const oldData = await pool.request()
            .input('Id', sql.Int, Id)
            .query(`SELECT FilePath, HoSoId FROM HSTT_HoSoVanBan WHERE Id = @Id`);

        if (!oldData.recordset.length) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy văn bản.' });
        }

        const { FilePath: oldFilePath, HoSoId } = oldData.recordset[0];
        let finalPath = oldFilePath;

        // 📂 B2. Nếu có file mới, xử lý lưu file
        if (file && TieuDe) {
            const sanitizedTieuDe = TieuDe.replace(/[\/\\?%*:|"<>]/g, '-');
            const newFileName = `${Id}_${sanitizedTieuDe}.pdf`;
            const finalDir = `C:/DocumentsUpload/HoSoThanhToan/Upload/${HoSoId}`;
            fs.mkdirSync(finalDir, { recursive: true });

            const newFilePath = path.join(finalDir, newFileName);

            // ❌ Xoá file cũ nếu tồn tại
            if (oldFilePath && fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath);
            }

            // 📥 Di chuyển file mới vào vị trí mới
            fs.renameSync(file.path, newFilePath);
            finalPath = newFilePath.replace(/\\/g, '/');
        }

        // ✅ B3. Gọi stored procedure cập nhật văn bản
        await pool.request()
            .input('Id', sql.Int, Id)
            .input('TieuDe', sql.NVarChar(255), TieuDe)
            .input('LoaiVanBanId', sql.Int, LoaiVanBanId)
            .input('FilePath', sql.NVarChar(255), finalPath)
            .execute('HSTT_HoSoVanBan_Update');

        res.json({
            success: true,
            message: 'Cập nhật văn bản thành công.',
            filePath: finalPath
        });

    } catch (err) {
        console.error('❌ Lỗi khi cập nhật văn bản:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi cập nhật văn bản.' });
    }
});


// Lấy thông tin liên quan đến hợp đồng
router.get('/lookup', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().execute('HSTT_GetLookupData');

        res.json({
            loaiVanBan: result.recordsets[0],
            coQuan: result.recordsets[1],
        });
    } catch (err) {
        console.error('Lỗi khi lấy lookup:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi lấy dữ liệu danh mục.' });
    }
});

// Mapping loại lookup đến bảng & cột
const tableMap = {
    loaiVanBan: { table: "HD_LoaiVanBan", column: "TenLoai" },
    coQuan: { table: "HD_CoQuan", columns: ["TenCoQuan", "TenVietTat"] },
    heThong: { table: "HD_HeThong", column: "TenHeThong" },
    doiTac: { table: "HD_DoiTac", column: "TenDoiTac" },
    tinhTrang: { table: "HD_TinhTrang", column: "TenTinhTrang" },
};


// ✅ Thêm mới
router.post("/lookup/:type", async (req, res) => {
    const { type } = req.params;
    const { name, shortName } = req.body;

    const config = tableMap[type];
    if (!config) return res.status(400).json({ error: "Loại không hợp lệ" });

    const { table, columns } = config;

    try {
        const pool = await poolPromise;

        // Tạo chuỗi column và biến @ cho SQL
        const colNames = columns.join(", ");
        const paramNames = columns.map((_, i) => `@param${i}`).join(", ");

        // Tạo request và bind dữ liệu
        const request = pool.request();
        columns.forEach((col, i) => {
            const paramValue = i === 0 ? name : shortName;
            request.input(`param${i}`, paramValue);
        });

        const query = `
      INSERT INTO ${table} (${colNames})
      VALUES (${paramNames})
    `;

        await request.query(query);
        res.json({ success: true, message: "Đã thêm thành công" });
    } catch (err) {
        console.error("Lỗi thêm:", err);
        res.status(500).json({ error: "Lỗi khi thêm mới" });
    }
});


//cập nhật
router.put("/lookup/:type/:id", async (req, res) => {
    const { type, id } = req.params;
    const { name, shortName } = req.body;

    const config = tableMap[type];
    if (!config) {
        return res.status(400).json({ error: "Loại không hợp lệ" });
    }

    try {
        const pool = await poolPromise;

        let query = "";
        const request = await pool.request().input("id", id);

        if (type === "coQuan") {
            // Riêng cơ quan cần cập nhật cả tên và viết tắt
            query = `
          UPDATE HD_CoQuan
          SET TenCoQuan = @name, TenVietTat = @shortName
          WHERE Id = @id
        `;
            request.input("name", name).input("shortName", shortName);
        } else {
            // Các loại còn lại chỉ cập nhật 1 trường
            query = `
          UPDATE ${config.table}
          SET ${config.column} = @name
          WHERE Id = @id
        `;
            request.input("name", name);
        }

        await request.query(query);

        res.json({ success: true, message: "Đã cập nhật thành công" });
    } catch (err) {
        console.error("Lỗi cập nhật:", err);
        res.status(500).json({ error: "Lỗi khi cập nhật" });
    }
});


// ✅ Xóa
router.delete("/lookup/:type/:id", async (req, res) => {
    const { type, id } = req.params;

    const config = tableMap[type];
    if (!config) return res.status(400).json({ error: "Loại không hợp lệ" });

    try {
        const pool = await poolPromise;
        const query = `DELETE FROM ${config.table} WHERE Id = @id`;

        await pool.request().input("id", id).query(query);
        res.json({ success: true, message: "Đã xóa thành công" });
    } catch (err) {
        console.error("Lỗi xóa:", err);
        res.status(500).json({ error: "Lỗi khi xóa" });
    }
});

module.exports = router