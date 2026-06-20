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
const uploadDir = 'C:/DocumentsUpload/VanBanDi/Upload';
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
        const { SoVanBan, CoQuanId } = req.body;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('SoVanBan', sql.NVarChar(50), SoVanBan || null)
            .input('CoQuanId', sql.Int, CoQuanId || null)
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
            CoQuanBanHanhId, CoQuanNhanIds, LoaiVanBanId,
            SoLuongBan, NgayChuyen, GhiChu, CreatedBy
        } = req.body;

        const file = req.file;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('TenVanBan', sql.NVarChar(255), TenVanBan)
            .input('NgayVanBan', sql.Date, NgayVanBan)
            .input('NguoiKyId', sql.Int, NguoiKyId)
            .input('CoQuanBanHanhId', sql.Int, CoQuanBanHanhId)
            .input('CoQuanNhanIds', sql.NVarChar(255), CoQuanNhanIds)
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
            CoQuanBanHanhId,
            CoQuanNhanIds,
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
            .input('CoQuanBanHanhId', sql.Int, CoQuanBanHanhId)
            .input('CoQuanNhanIds', sql.NVarChar(255), CoQuanNhanIds)
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
                    CoQuanBanHanhId = @CoQuanBanHanhId,
                    NoiNhanId = @CoQuanNhanIds,
                    LoaiVanBanDiId = @LoaiVanBanDiId,
                    SoLuongBan = @SoLuongBan,
                    NgayChuyen = @NgayChuyen,
                    GhiChu = @GhiChu,
                    FilePath = @FilePath,
                    UpdatedAt = GETDATE(),
                    UpdatedBy = @UpdatedBy
                WHERE Id = @Id
            `);

        // 🔄 Cập nhật bảng HD_VanBanDi_CoQuanNhan
        await pool.request()
            .input('VanBanDiId', sql.Int, Id)
            .query('DELETE FROM HD_VanBanDi_CoQuanNhan WHERE VanBanDiId = @VanBanDiId');

        // ⚙️ Chèn lại các cơ quan nhận mới
        const coQuanIds = CoQuanNhanIds?.split(',').map(id => id.trim()).filter(id => id !== '');
        for (const coQuanId of coQuanIds) {
            await pool.request()
                .input('VanBanDiId', sql.Int, Id)
                .input('CoQuanId', sql.Int, coQuanId)
                .query(`
            INSERT INTO HD_VanBanDi_CoQuanNhan (VanBanDiId, CoQuanId)
            VALUES (@VanBanDiId, @CoQuanId)
        `);
        }
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


router.delete('/xoa-vanbandi/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const pool = await poolPromise;

        // 1. Lấy đường dẫn file để xóa (nếu có)
        const result = await pool.request()
            .input('Id', sql.Int, id)
            .query(`SELECT FilePath FROM HD_VanBanDi WHERE Id = @Id`);

        const filePath = result.recordset?.[0]?.FilePath;

        // 2. Xóa bản ghi trong DB
        await pool.request()
            .input('Id', sql.Int, id)
            .query(`DELETE FROM HD_VanBanDi_CoQuanNhan WHERE VanBanDiId = @Id`);

        await pool.request()
            .input('Id', sql.Int, id)
            .query(`DELETE FROM HD_VanBanDi WHERE Id = @Id`);

        // 3. Xóa file nếu tồn tại
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.json({ success: true, message: 'Đã xóa văn bản đi và file (nếu có).' });
    } catch (err) {
        console.error('❌ Lỗi khi xóa văn bản:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi xóa văn bản.' });
    }
});

const tableMap = {
    loaiVanBan: { table: "HD_LoaiVanBanDi", columns: ["TenLoai", "KyHieu"] },
    coQuan: { table: "HD_CoQuan", columns: ["TenCoQuan", "TenVietTat"] },
    nguoiKy: { table: "HD_NguoiKy", columns: ["HoTen", "ChucVu"] },
};

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

router.put("/lookup/:type/:id", async (req, res) => {
    const { type, id } = req.params;
    const { name, shortName } = req.body;

    const config = tableMap[type];
    if (!config || !Array.isArray(config.columns) || config.columns.length === 0) {
        return res.status(400).json({ error: "Loại không hợp lệ hoặc thiếu cấu hình columns" });
    }

    const { table, columns } = config;

    try {
        const pool = await poolPromise;
        const request = pool.request();

        // Gắn giá trị cho từng field
        columns.forEach((col, i) => {
            const value = i === 0 ? name : shortName;
            request.input(`param${i}`, value);
        });

        // ID để xác định dòng cần cập nhật
        request.input("id", id);

        // Tạo câu truy vấn cập nhật
        const setClause = columns.map((col, i) => `${col} = @param${i}`).join(", ");

        const query = `
            UPDATE ${table}
            SET ${setClause}
            WHERE Id = @id
        `;

        await request.query(query);
        res.json({ success: true, message: "Cập nhật thành công" });
    } catch (err) {
        console.error("❌ Lỗi cập nhật:", err);
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

router.get("/truy-nguyen/Kiem_Select_Bo", async (req, res) => {
    try {
        const { ID_LXVT_BC } = req.query;
        const pool = await poolPromise;
        const result = await pool.request()
            .input("ID_LXVT_BC", ID_LXVT_BC)
            .execute("TAG_Giang.dbo.DA_TruyNguyen_KiemTongHop_Select_Bo");
        res.json(result.recordset);
    } catch (err) {
        console.error("Lỗi khi truy vấn:", err);
        res.status(500).json({ error: "Lỗi khi truy vấn" });
    }
});

router.get("/truy-nguyen/dm-loi", async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .query("SELECT * FROM TAG_Giang.dbo.DA_TruyNguyen_Loi");
        res.json(result.recordset);
    } catch (err) {
        console.error("Lỗi khi truy vấn:", err);
        res.status(500).json({ error: "Lỗi khi truy vấn" });
    }
});

router.get("/truy-nguyen/dm-loi-chitiet", async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .query("SELECT * FROM TAG_Giang.dbo.DA_TruyNguyen_Loi_chitiet");
        res.json(result.recordset);
    } catch (err) {
        console.error("Lỗi khi truy vấn:", err);
        res.status(500).json({ error: "Lỗi khi truy vấn" });
    }
});

router.post("/truy-nguyen/kiem-save-list", async (req, res) => {
    try {
        const { ID_TaiKhoan, ISDat, ID_LXVT_BC, data } = req.body;

        const pool = await poolPromise;

        let ID_Kiem = null;

        for (const item of data) {
            const result = await pool.request()
                .input("ID_TaiKhoan", ID_TaiKhoan)
                .input("ISDat", ISDat)
                .input("ID_LXVT_BC", ID_LXVT_BC)
                .input("ID_LoiPhoi", item.ID_LoiPhoi)
                .input("SoLuong_Bo", item.SoLuong_Bo)
                .input("SoLuong_BTP", item.SoLuong_BTP)
                .input("SoLuong_BoKiem", item.SoLuong_BoKiem)
                .input("SoLuong_BTPKiem", item.SoLuong_BTPKiem)
                .input("SoLoi", item.SoLoi)
                .input("MucDoiLoi", item.MucDoiLoi)
                .input("LoaiLoi", item.LoaiLoi)
                .execute("TAG_Giang.dbo.DA_TruyNguyen_Kiem_Save_Bo");

            // lấy ID_Kiem từ lần đầu
            if (!ID_Kiem) {
                ID_Kiem = result.recordset[0]?.ID_Kiem;
            }
        }

        res.json({
            success: true,
            ID_Kiem
        });

    } catch (err) {
        console.error("Lỗi khi lưu danh sách kiểm:", err);
        res.status(500).json({ error: "Lỗi khi lưu danh sách kiểm" });
    }
});

module.exports = router;