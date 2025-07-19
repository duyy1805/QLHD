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

router.post('/hopdong', async (req, res) => {
    try {
        const { SoVanBanNoiBo, TenCoQuan } = req.body;
        const pool = await poolPromise;
        const result = await pool.request()
            .input('SoVanBanNoiBo', SoVanBanNoiBo || null)
            .input('TenCoQuan', TenCoQuan || null)
            .execute('HD_HopDong_Get');

        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send('Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.');
    }
});

// 📁 Cấu hình thư mục lưu file
const uploadDir = 'C:/HopDong/Upload';

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
router.post('/them-hopdong', upload.single('file'), async (req, res) => {
    try {
        const {
            LoaiVanBanId, CoQuanId, HeThongId,
            DoiTacId, TrichYeu, TinhTrangId, GhiChu, CreatedBy
        } = req.body;

        const file = req.file;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('LoaiVanBanId', sql.Int, LoaiVanBanId)
            .input('CoQuanId', sql.Int, CoQuanId)
            .input('HeThongId', sql.Int, HeThongId)
            .input('DoiTacId', sql.Int, DoiTacId)
            .input('TrichYeu', sql.NVarChar(500), TrichYeu)
            .input('TinhTrangId', sql.Int, TinhTrangId)
            .input('GhiChu', sql.NVarChar(500), GhiChu)
            .input('CreatedBy', sql.Int, CreatedBy)
            .output('SoVanBanNoiBo', sql.NVarChar(50))
            .execute('HD_HopDong_Add');

        const soVB = result.output.SoVanBanNoiBo;
        const newRecord = result.recordset?.[0];
        let finalPath = null;

        if (file && soVB) {
            const newFileName = soVB.replace(/\//g, '-') + '.pdf'; // ✅ Ví dụ: 001-Z176-TC-HD.pdf
            const finalDir = 'C:/HopDong/Upload';
            fs.mkdirSync(finalDir, { recursive: true });

            const newFilePath = path.join(finalDir, newFileName);
            fs.renameSync(file.path, newFilePath); // ✅ Di chuyển và đổi tên file

            finalPath = newFilePath.replace(/\\/g, '/');

            await pool.request()
                .input('SoVanBanNoiBo', sql.NVarChar(50), soVB)
                .input('FilePath', sql.NVarChar(255), finalPath)
                .query(`
            UPDATE HD_HopDong
            SET FilePath = @FilePath
            WHERE SoVanBanNoiBo = @SoVanBanNoiBo
          `);
        }

        res.json({
            success: true,
            message: 'Thêm hợp đồng thành công.',
            soVanBanNoiBo: soVB,
            filePath: finalPath,
        });

    } catch (err) {
        console.error('❌ Lỗi khi thêm hợp đồng:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi thêm hợp đồng.' });
    }
});

// ✅ API sửa hợp đồng
router.put('/sua-hopdong', upload.single('file'), async (req, res) => {
    try {
        const {
            Id,
            LoaiVanBanId,
            CoQuanId,
            HeThongId,
            DoiTacId,
            TrichYeu,
            TinhTrangId,
            GhiChu,
            CreatedBy
        } = req.body;

        const file = req.file;
        const pool = await poolPromise;

        // 🔍 Lấy Số VB hiện tại và FilePath cũ
        const oldData = await pool.request()
            .input('Id', sql.Int, Id)
            .query(`
          SELECT SoVanBanNoiBo, FilePath
          FROM HD_HopDong
          WHERE Id = @Id
        `);

        if (!oldData.recordset.length) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy hợp đồng.' });
        }

        const { SoVanBanNoiBo, FilePath: oldFilePath } = oldData.recordset[0];

        let finalPath = oldFilePath;

        // 📂 Nếu có file mới: đổi tên theo SoVanBanNoiBo và ghi đè
        if (file && SoVanBanNoiBo) {
            const newFileName = SoVanBanNoiBo.replace(/\//g, '-') + '.pdf';
            const finalDir = uploadDir;
            const newFilePath = path.join(finalDir, newFileName);

            // ❌ Xóa file cũ nếu tồn tại
            if (oldFilePath && fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath);
            }

            // 📥 Di chuyển và đổi tên file mới
            fs.renameSync(file.path, newFilePath);
            finalPath = newFilePath.replace(/\\/g, '/');
        }

        // ✅ Cập nhật CSDL
        await pool.request()
            .input('Id', sql.Int, Id)
            .input('LoaiVanBanId', sql.Int, LoaiVanBanId)
            .input('CoQuanId', sql.Int, CoQuanId)
            .input('HeThongId', sql.Int, HeThongId)
            .input('DoiTacId', sql.Int, DoiTacId)
            .input('TrichYeu', sql.NVarChar(500), TrichYeu)
            .input('TinhTrangId', sql.Int, TinhTrangId)
            .input('GhiChu', sql.NVarChar(500), GhiChu)
            .input('FilePath', sql.NVarChar(255), finalPath)
            .input('UpdatedBy', sql.Int, CreatedBy)
            .query(`
          UPDATE HD_HopDong
          SET
            LoaiVanBanId = @LoaiVanBanId,
            CoQuanId = @CoQuanId,
            HeThongId = @HeThongId,
            DoiTacId = @DoiTacId,
            TrichYeu = @TrichYeu,
            TinhTrangId = @TinhTrangId,
            GhiChu = @GhiChu,
            FilePath = @FilePath,
            UpdatedAt = GETDATE(),
            UpdatedBy = @UpdatedBy
          WHERE Id = @Id
        `);

        res.json({
            success: true,
            message: 'Cập nhật hợp đồng thành công.',
            filePath: finalPath,
        });

    } catch (err) {
        console.error('❌ Lỗi khi sửa hợp đồng:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi sửa hợp đồng.' });
    }
});

// DELETE /QLHD/xoa-hopdong/:id
router.delete('/xoa-hopdong/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const pool = await poolPromise;

        // 1. Lấy đường dẫn file để xóa (nếu có)
        const result = await pool.request()
            .input('Id', sql.Int, id)
            .query(`SELECT FilePath FROM HD_HopDong WHERE Id = @Id`);

        const filePath = result.recordset?.[0]?.FilePath;

        // 2. Xóa bản ghi trong DB
        await pool.request()
            .input('Id', sql.Int, id)
            .query(`DELETE FROM HD_HopDong WHERE Id = @Id`);

        // 3. Xóa file nếu tồn tại
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.json({ success: true, message: 'Đã xóa hợp đồng và file (nếu có).' });
    } catch (err) {
        console.error('❌ Lỗi khi xóa hợp đồng:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi xóa hợp đồng.' });
    }
});

// Lấy thông tin liên quan đến hợp đồng
router.get('/lookup', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().execute('HD_GetLookupData');

        res.json({
            loaiVanBan: result.recordsets[0],
            coQuan: result.recordsets[1],
            heThong: result.recordsets[2],
            doiTac: result.recordsets[3],
            tinhTrang: result.recordsets[4],
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