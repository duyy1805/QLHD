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
const { sendPushToUsers } = require('../utils/push'); // path chỉnh cho đúng
// 📁 Thư mục lưu file đính kèm phiếu séc
const uploadDir = 'C:/DocumentsUpload/SoSec/Upload';

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ⚙️ Cấu hình multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Giữ tên gốc + timestamp cho dễ nhìn
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});
const upload = multer({ storage });

/* ========= Helpers ========= */
function httpError(res, err, fallback = "Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.") {
    console.error(err);
    const code = err?.number || err?.code;
    const msg = err?.originalError?.info?.message || err.message || fallback;
    // nếu THROW 72xxx từ proc => lỗi nghiệp vụ (400)
    const http = String(code || "").startsWith("72") ? 400 : 500;
    return res.status(http).json({ message: msg, code });
}

// GET /api/sosec/role/:userId  => { role: "TBP" | "KTT" | "GD" | "NhanVien" }
router.get("/role/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!userId) return res.status(400).json({ message: "userId không hợp lệ" });

        const pool = await poolPromise;
        const rs = await pool.request()
            .input("UserId", sql.Int, userId)
            .query("SELECT RoleCode = dbo.SS_fn_UserRoleCode(@UserId)");

        const role = rs.recordset?.[0]?.RoleCode || "NhanVien";
        res.json({ role });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Lấy role thất bại" });
    }
});

/* =========================================================================
 *                                ĐƠN VỊ
 * ========================================================================= */

// GET /api/sosec/donvi?tukhoa=&tontai=1
router.get("/donvi", async (req, res) => {
    try {
        const { tukhoa, tontai } = req.query;
        const pool = await poolPromise;
        const rs = await pool.request()
            .input("TuKhoa", sql.NVarChar(200), tukhoa || null)
            .input("TonTai", sql.Bit, tontai === undefined ? 1 : Number(tontai) ? 1 : 0)
            .execute("SS_sp_DonVi_DanhSach");

        res.json(rs.recordset); // [{ id, name, stk, TonTai }]
    } catch (err) {
        return httpError(res, err, "Có lỗi xảy ra khi lấy danh sách đơn vị.");
    }
});

// POST /donvi
router.post("/donvi", async (req, res) => {
    try {
        const { name, stk, maNganHang } = req.body;
        const pool = await poolPromise;
        const rs = await pool
            .request()
            .input("TenDonVi", sql.NVarChar(200), name || null)
            .input("SoTaiKhoan", sql.NVarChar(50), stk || null)
            .input("MaNganHang", sql.NVarChar(50), maNganHang || null)
            .output("NewId", sql.Int)
            .execute("SS_sp_DonVi_Tao");

        res.status(201).json({ id: rs.output.NewId, name, stk, maNganHang, TonTai: 1 });
    } catch (err) {
        return httpError(res, err, "Có lỗi xảy ra khi thêm đơn vị.");
    }
});


// PUT /api/sosec/donvi/:id
router.put("/donvi/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { name, stk, maNganHang } = req.body;
        if (!id) return res.status(400).json({ message: "id không hợp lệ" });

        const pool = await poolPromise;
        await pool.request()
            .input("DonViId", sql.Int, id)
            .input("TenDonVi", sql.NVarChar(200), name || null)
            .input("SoTaiKhoan", sql.NVarChar(50), stk || null)
            .input("MaNganHang", sql.NVarChar(50), maNganHang || null)
            .execute("SS_sp_DonVi_Update");

        res.json({ id, name, stk, maNganHang });
    } catch (err) {
        return httpError(res, err, "Có lỗi khi cập nhật đơn vị.");
    }
});


router.delete("/donvi/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);
        const pool = await poolPromise;
        await pool.request()
            .input("DonViId", sql.Int, id)
            .execute("SS_sp_DonVi_Xoa");

        res.json({ id, TonTai: 0 });
    } catch (err) {
        return httpError(res, err, "Có lỗi xảy ra khi xoá đơn vị.");
    }
});


/* =========================================================================
 *                               PHIẾU SÉC
 * ========================================================================= */

// GET /api/sosec/phieu?tukhoa=&trangthai=&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
router.get("/phieu", /* verifyToken, */ async (req, res) => {
    try {
        const { tukhoa, trangthai, dateFrom, dateTo } = req.query;
        const fromToken = req.user || {};
        // Tạm thời nhận từ query nếu chưa bật auth
        const userId = Number(req.query.userId || fromToken.userId) || null;
        const roleCode = (req.query.roleCode || fromToken.roleCode) || null;
        const idDonVi = Number(req.query.idDonVi || fromToken.idDonVi) || null;
        const pool = await poolPromise;
        const rs = await pool.request()
            .input("TuKhoa", sql.NVarChar(200), tukhoa || null)
            .input("TrangThaiMa", sql.NVarChar(30), trangthai || null)
            .input("DateFrom", sql.Date, dateFrom || null)
            .input("DateTo", sql.Date, dateTo || null)
            .input("RequesterUserId", sql.Int, userId)
            .input("RequesterRoleCode", sql.NVarChar(30), roleCode)
            .input("RequesterIdDonVi", sql.Int, idDonVi)
            .execute("SS_sp_PhieuSec_DanhSach");

        // Map về shape FE đang dùng
        const data = rs.recordset.map((r) => ({
            id: r.PhieuSecId,
            ngay: r.Ngay,
            noiDung: r.NoiDung,
            donViId: r.DonViHuongThuId,
            soTien: Number(r.SoTien),
            nguoiDangKyId: r.NguoiDangKyId,
            idDonVi: r.IdDonVi,
            ghiChu: r.GhiChu,
            maLenhChi: r.MaLenhChi,
            trangThai: r.MaTrangThai, // "ChoDuyet_TBP" | "ChoDuyet_KTT" | "ChoDuyet_GD" | "HoanThanh" | "TuChoi"
            tbpTime: r.TBP_Time,
            kttTime: r.KTT_Time,
            gdTime: r.GD_Time,
            tenDonVi: r.TenDonVi,
            maSoSec: r.MaSoSec,

            // thêm mới:
            tenNguoiTao: r.TenNguoiTao ?? null,
            tenDonViNguoiTao: r.TenDonViNguoiTao ?? null,
        }));
        res.json(data);
    } catch (err) {
        return httpError(res, err, "Có lỗi xảy ra khi lấy danh sách phiếu séc.");
    }
});

router.get("/phieu/:id", /* verifyToken, */ async (req, res) => {
    try {
        const phieuId = Number(req.params.id);
        if (!phieuId) return res.status(400).json({ message: "id không hợp lệ" });

        const fromToken = req.user || {};
        // Tạm thời nhận từ query nếu chưa bật auth
        const userId = Number(req.query.userId || fromToken.userId) || null;
        const roleCode = (req.query.roleCode || fromToken.roleCode) || null;
        const idDonVi = Number(req.query.idDonVi || fromToken.idDonVi) || null;

        const pool = await poolPromise;
        console.log({ phieuId, userId, roleCode, idDonVi });
        let r;

        // ===== Cách 1: nếu có proc GetById thì dùng (khuyến nghị) =====
        try {
            const rs1 = await pool.request()
                .input("PhieuSecId", sql.Int, phieuId)
                .input("RequesterUserId", sql.Int, userId)
                .input("RequesterRoleCode", sql.NVarChar(30), roleCode)
                .input("RequesterIdDonVi", sql.Int, idDonVi)
                .execute("SS_sp_PhieuSec_GetById"); // <-- tạo proc này theo quyền của bạn

            r = rs1.recordset?.[0];
        } catch (e) {
            // Nếu proc chưa tồn tại thì fallback DanhSach
            const rs2 = await pool.request()
                .input("TuKhoa", sql.NVarChar(200), null)
                .input("TrangThaiMa", sql.NVarChar(30), null)
                .input("DateFrom", sql.Date, null)
                .input("DateTo", sql.Date, null)
                .input("RequesterUserId", sql.Int, userId)
                .input("RequesterRoleCode", sql.NVarChar(30), roleCode)
                .input("RequesterIdDonVi", sql.Int, idDonVi)
                .execute("SS_sp_PhieuSec_DanhSach");

            r = rs2.recordset.find(x => x.PhieuSecId === phieuId);
        }

        if (!r) return res.status(404).json({ message: "Không tìm thấy phiếu" });

        // Map về shape FE đang dùng
        const mapped = {
            id: r.PhieuSecId,
            maSoSec: r.MaSoSec,               // << quan trọng
            ngay: r.Ngay,
            noiDung: r.NoiDung,
            donViId: r.DonViHuongThuId,
            soTien: Number(r.SoTien),
            nguoiDangKyId: r.NguoiDangKyId,
            idDonVi: r.IdDonVi,
            ghiChu: r.GhiChu,
            trangThai: r.MaTrangThai,         // "ChoDuyet_TBP" | ...
            maLenhChi: r.MaLenhChi,           // nếu đã có
            tbpTime: r.TBP_Time,
            kttTime: r.KTT_Time,
            gdTime: r.GD_Time,
            tenDonVi: r.TenDonVi,

            // thêm mới:
            tenNguoiTao: r.TenNguoiTao ?? null,
            tenDonViNguoiTao: r.TenDonViNguoiTao ?? null,
            // nếu proc GetById/DanhSach có thêm các trường dưới thì tự hiện:
            ngayNhapLenhChi: r.NgayNhapLenhChi ?? null,
            nguoiNhapLenhChiId: r.NguoiNhapLenhChiId ?? null,
        };
        return res.json(mapped);
    } catch (err) {
        return httpError(res, err, "Có lỗi xảy ra khi lấy chi tiết phiếu.");
    }
});
// POST /api/sosec/phieu
// body: { noiDung, donViId, soTien, nguoiDangKyId, ghiChu }
// router.post("/phieu", /* verifyToken, */ async (req, res) => {
//     try {
//         const { noiDung, donViId, soTien, nguoiDangKyId, idDonVi, ghiChu } = req.body;
//         const pool = await poolPromise;
//         console.log({ noiDung, donViId, soTien, nguoiDangKyId, idDonVi, ghiChu });
//         const rs = await pool
//             .request()
//             .input("NoiDung", sql.NVarChar(500), noiDung || null)
//             .input("DonViHuongThuId", sql.Int, donViId)
//             .input("SoTien", sql.Decimal(18, 4), soTien)
//             .input("NguoiDangKyId", sql.Int, nguoiDangKyId || 0)
//             .input("IdDonVi", sql.Int, idDonVi || null)
//             .input("GhiChu", sql.NVarChar(500), ghiChu || null)
//             .output("NewId", sql.Int)
//             .execute("SS_sp_PhieuSec_Tao");
//         res.status(201).json({ id: rs.output.NewId });
//     } catch (err) {
//         return httpError(res, err, "Có lỗi xảy ra khi tạo phiếu séc.");
//     }
// });
// ⚠️ XÓA hoặc comment cái router.post("/phieu", /* verifyToken, */ ...) phía trên đi
// POST /api/sosec/phieu
router.post("/phieu", async (req, res) => {
    try {
        const {
            noiDung,
            donViId,       // DonViHuongThuId
            soTien,
            nguoiDangKyId,
            idDonVi,       // IdDonVi (đơn vị tạo phiếu)
            ghiChu
        } = req.body;

        const pool = await poolPromise;

        // 1. Gọi stored tạo phiếu
        const rs = await pool
            .request()
            .input("NoiDung", sql.NVarChar(500), noiDung || null)
            .input("DonViHuongThuId", sql.Int, donViId)
            .input("SoTien", sql.Decimal(18, 4), soTien)
            .input("NguoiDangKyId", sql.Int, nguoiDangKyId || null)
            .input("IdDonVi", sql.Int, idDonVi || null)
            .input("GhiChu", sql.NVarChar(500), ghiChu || null)
            .output("NewId", sql.Int)
            .execute("SS_sp_PhieuSec_Tao");

        const newId = rs.output.NewId;
        const info = rs.recordset?.[0];

        if (!newId || !info) {
            return res.status(500).json({ message: "Không lấy được thông tin phiếu sau khi tạo." });
        }

        const phieuId = info.Id || newId;
        const maSoSec = info.MaSoSec || ('SS-' + phieuId);
        const tbpUserId = info.TBPUserId;

        // 2. Gửi thông báo cho TBP (nếu có)
        if (tbpUserId) {
            try {
                await sendPushToUsers(
                    [tbpUserId],
                    'Sổ séc mới cần duyệt',
                    `Phiếu séc ${maSoSec} cần TBP duyệt.`,
                    { phieuSecId: phieuId, maSoSec }
                );
            } catch (pushErr) {
                console.error('⚠ Lỗi gửi push khi tạo phiếu:', pushErr);
            }
        } else {
            console.warn('⚠ Không tìm được TBPUserId trong SS_sp_PhieuSec_Tao.');
        }

        // 3. Trả về cho FE
        return res.status(201).json({
            id: phieuId,
            maSoSec,
        });
    } catch (err) {
        console.error('❌ Lỗi tạo phiếu séc:', err);
        return httpError(res, err, "Có lỗi xảy ra khi tạo phiếu séc.");
    }
});

// router.post("/phieu/:id/approve", async (req, res) => {
//     try {
//         const { id } = req.params;
//         const { nguoiDuyetId, tenNguoiDuyet, chapThuan, ghiChu, requesterUserId, requesterRoleCode, requesterIdDonVi } = req.body;
//         const pool = await poolPromise;

//         const fromToken = req.user || {};
//         // Tạm thời nhận từ query nếu chưa bật auth

//         console.log({ requesterUserId, requesterRoleCode, requesterIdDonVi });
//         await pool.request()
//             .input("PhieuSecId", sql.Int, Number(id))
//             .input("NguoiDuyetId", sql.Int, nguoiDuyetId)
//             .input("TenNguoiDuyet", sql.NVarChar(200), tenNguoiDuyet || null)
//             .input("ChapThuan", sql.Bit, !!chapThuan)
//             .input("GhiChu", sql.NVarChar(500), ghiChu || null)
//             .execute("SS_sp_PhieuSec_Duyet");

//         // lấy lại 1 record
//         const rs = await pool.request()
//             .input("TuKhoa", sql.NVarChar(200), null)
//             .input("TrangThaiMa", sql.NVarChar(30), null)
//             .input("DateFrom", sql.Date, null)
//             .input("DateTo", sql.Date, null)
//             .input("RequesterUserId", requesterUserId)
//             .input("RequesterRoleCode", requesterRoleCode)
//             .input("RequesterIdDonVi", requesterIdDonVi)
//             .execute("SS_sp_PhieuSec_DanhSach");

//         const r = rs.recordset.find(x => x.PhieuSecId === Number(id));
//         if (!r) return res.status(404).json({ message: "Không tìm thấy phiếu sau khi duyệt" });

//         // map về FE
//         const mapped = {
//             id: r.PhieuSecId,
//             ngay: r.Ngay,
//             noiDung: r.NoiDung,
//             donViId: r.DonViHuongThuId,
//             soTien: Number(r.SoTien),
//             nguoiDangKyId: r.NguoiDangKyId,
//             idDonVi: r.IdDonVi,
//             ghiChu: r.GhiChu,
//             trangThai: r.MaTrangThai,
//             maLenhChi: r.MaLenhChi,
//             tbpTime: r.TBP_Time,
//             kttTime: r.KTT_Time,
//             gdTime: r.GD_Time,
//             tenDonVi: r.TenDonVi,
//             maSoSec: r.MaSoSec,

//             // thêm mới:
//             tenNguoiTao: r.TenNguoiTao ?? null,
//             tenDonViNguoiTao: r.TenDonViNguoiTao ?? null,
//         };

//         res.json(mapped);
//     } catch (err) {
//         console.error(err);
//         res.status(500).json({ message: "Có lỗi xảy ra khi duyệt phiếu." });
//     }
// });
router.post("/phieu/:id/approve", async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nguoiDuyetId,
            tenNguoiDuyet,
            chapThuan,
            ghiChu,
            requesterUserId,
            requesterRoleCode,
            requesterIdDonVi
        } = req.body;

        const pool = await poolPromise;

        // 1. Gọi proc duyệt
        await pool.request()
            .input("PhieuSecId", sql.Int, Number(id))
            .input("NguoiDuyetId", sql.Int, nguoiDuyetId)
            .input("TenNguoiDuyet", sql.NVarChar(200), tenNguoiDuyet || null)
            .input("ChapThuan", sql.Bit, !!chapThuan)
            .input("GhiChu", sql.NVarChar(500), ghiChu || null)
            .execute("SS_sp_PhieuSec_Duyet");

        // 2. Lấy lại 1 record sau khi duyệt
        const rs = await pool.request()
            .input("TuKhoa", sql.NVarChar(200), null)
            .input("TrangThaiMa", sql.NVarChar(30), null)
            .input("DateFrom", sql.Date, null)
            .input("DateTo", sql.Date, null)
            .input("RequesterUserId", requesterUserId)
            .input("RequesterRoleCode", requesterRoleCode)
            .input("RequesterIdDonVi", requesterIdDonVi)
            .execute("SS_sp_PhieuSec_DanhSach");

        const r = rs.recordset.find(x => x.PhieuSecId === Number(id));
        if (!r) return res.status(404).json({ message: "Không tìm thấy phiếu sau khi duyệt" });

        // 💾 Đảm bảo proc SS_sp_PhieuSec_DanhSach trả thêm:
        // r.MaSoSec, r.TBPUserId, r.KTTUserId, r.GDUserId, r.NguoiDangKyId, ...

        // map về FE
        const mapped = {
            id: r.PhieuSecId,
            ngay: r.Ngay,
            noiDung: r.NoiDung,
            donViId: r.DonViHuongThuId,
            soTien: Number(r.SoTien),
            nguoiDangKyId: r.NguoiDangKyId,
            idDonVi: r.IdDonVi,
            ghiChu: r.GhiChu,
            trangThai: r.MaTrangThai,
            maLenhChi: r.MaLenhChi,
            tbpTime: r.TBP_Time,
            kttTime: r.KTT_Time,
            gdTime: r.GD_Time,
            tenDonVi: r.TenDonVi,
            maSoSec: r.MaSoSec,
            tenNguoiTao: r.TenNguoiTao ?? null,
            tenDonViNguoiTao: r.TenDonViNguoiTao ?? null,
        };

        // 3. Gửi push theo trạng thái mới
        try {
            const targets = [];
            let title = '';
            let body = '';

            const trangThai = mapped.trangThai;
            const maSoSec = mapped.maSoSec || ('SS-' + mapped.id);

            if (chapThuan) {
                // ✅ Trường hợp DUYỆT
                if (trangThai === 'ChoDuyet_KTT' && r.KTTUserId) {
                    // TBP duyệt xong, đẩy lên KTT
                    targets.push(r.KTTUserId);
                    title = 'Phiếu séc cần KTT duyệt';
                    body = `Phiếu séc ${maSoSec} đã được TBP duyệt, chờ KTT phê duyệt.`;
                } else if (trangThai === 'ChoDuyet_GD' && r.GDUserId) {
                    // KTT duyệt xong, đẩy lên GD
                    targets.push(r.GDUserId);
                    title = 'Phiếu séc cần Giám đốc duyệt';
                    body = `Phiếu séc ${maSoSec} đã được KTT duyệt, chờ Giám đốc phê duyệt.`;
                } else if (trangThai === 'HoanThanh' && mapped.nguoiDangKyId) {
                    // Giám đốc duyệt xong, báo cho người đăng ký
                    targets.push(mapped.nguoiDangKyId);
                    title = 'Phiếu séc đã được duyệt xong';
                    body = `Phiếu séc ${maSoSec} đã được duyệt hoàn thành.`;
                }
            } else {
                // ❌ Trường hợp TỪ CHỐI
                if (trangThai === 'TuChoi' && mapped.nguoiDangKyId) {
                    targets.push(mapped.nguoiDangKyId);
                    title = 'Phiếu séc bị từ chối';
                    body = `Phiếu séc ${maSoSec} đã bị từ chối. Lý do: ${ghiChu || 'Không ghi rõ.'}`;
                }
            }
            console.log(targets, title, body);
            if (targets.length > 0) {
                const resultPush = await sendPushToUsers(
                    targets,
                    title,
                    body,
                    { phieuSecId: mapped.id, maSoSec }
                );
                console.log('Result push approve:', resultPush);
            }
        } catch (pushErr) {
            console.error('⚠ Lỗi gửi push khi duyệt phiếu:', pushErr);
            // Không throw ra ngoài, tránh làm fail duyệt vì lỗi push
        }

        res.json(mapped);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Có lỗi xảy ra khi duyệt phiếu." });
    }
});

// POST /api/sosec/phieu/:id/lenhchi
// body: { maLenhChi, nguoiNhapId }
router.post("/phieu/:id/lenhchi", async (req, res) => {
    try {
        const { id } = req.params;
        const { maLenhChi, nguoiNhapId } = req.body;

        const pool = await poolPromise;
        await pool.request()
            .input("PhieuSecId", sql.Int, id)
            .input("MaLenhChi", sql.NVarChar(50), maLenhChi)
            .input("NguoiNhapId", sql.Int, nguoiNhapId)
            .execute("SS_sp_LenhChi_Tao");

        res.status(201).json({ message: "Đã tạo lệnh chi cho phiếu " + id });
    } catch (err) {
        return httpError(res, err, "Có lỗi khi tạo lệnh chi");
    }
});

router.get("/dashboard", async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.query;
        const fromToken = req.user || {};
        const userId = Number(req.query.userId || fromToken.userId) || null;
        const roleCode = (req.query.roleCode || fromToken.roleCode) || null;
        const idDonVi = Number(req.query.idDonVi || fromToken.idDonVi) || null;

        const pool = await poolPromise;
        const rs = await pool.request()
            .input("RequesterUserId", sql.Int, userId)
            .input("RequesterRoleCode", sql.NVarChar(30), roleCode)
            .input("RequesterIdDonVi", sql.Int, idDonVi)
            .input("DateFrom", sql.Date, dateFrom || null)
            .input("DateTo", sql.Date, dateTo || null)
            .execute("SS_sp_PhieuSec_Dashboard");

        const r = rs.recordset?.[0] || {};
        return res.json({
            waitingTBP: Number(r.ChoDuyet_TBP || 0),
            waitingKTT: Number(r.ChoDuyet_KTT || 0),
            waitingGD: Number(r.ChoDuyet_GD || 0),
            completed: Number(r.HoanThanh || 0),
            rejected: Number(r.TuChoi || 0),
            total: Number(r.Tong || 0),
        });
    } catch (err) {
        return httpError(res, err, "Có lỗi khi lấy dashboard.");
    }
});

// GET /api/sosec/dashboard/summary
router.get("/dashboard/summary", async (req, res) => {
    try {
        const { dateFrom, dateTo, creatorDonViId, donViHuongThuId } = req.query;
        const fromToken = req.user || {};

        const userId = Number(req.query.userId || fromToken.userId) || null;
        const roleCode = (req.query.roleCode || fromToken.roleCode) || null;
        const idDonVi = Number(req.query.idDonVi || fromToken.idDonVi) || null;

        const pool = await poolPromise;
        const rs = await pool.request()
            .input("RequesterUserId", sql.Int, userId)
            .input("RequesterRoleCode", sql.NVarChar(30), roleCode)
            .input("RequesterIdDonVi", sql.Int, idDonVi)
            .input("DateFrom", sql.Date, dateFrom || null)
            .input("DateTo", sql.Date, dateTo || null)
            .input("FilterCreatorIdDonVi", sql.Int, creatorDonViId ? Number(creatorDonViId) : null)
            .input("FilterDonViHuongThuId", sql.Int, donViHuongThuId ? Number(donViHuongThuId) : null)
            .execute("SS_sp_PhieuSec_Summary");

        const r = rs.recordset?.[0] || {};
        res.json({
            totalCount: Number(r.TotalCount || 0),
            totalAmount: Number(r.TotalAmount || 0),
            byStatus: {
                waitingTBP: { count: Number(r.ChoDuyet_TBP_Count || 0), amount: Number(r.ChoDuyet_TBP_Amount || 0) },
                waitingKTT: { count: Number(r.ChoDuyet_KTT_Count || 0), amount: Number(r.ChoDuyet_KTT_Amount || 0) },
                waitingGD: { count: Number(r.ChoDuyet_GD_Count || 0), amount: Number(r.ChoDuyet_GD_Amount || 0) },
                completed: { count: Number(r.HoanThanh_Count || 0), amount: Number(r.HoanThanh_Amount || 0) },
                rejected: { count: Number(r.TuChoi_Count || 0), amount: Number(r.TuChoi_Amount || 0) },
            },
        });
    } catch (err) {
        return httpError(res, err, "Có lỗi khi lấy dashboard summary.");
    }
});

// GET /api/sosec/dashboard/grouped?groupBy=Month|CreatorDonVi|DonViHuongThu
router.get("/dashboard/grouped", async (req, res) => {
    try {
        const { dateFrom, dateTo, creatorDonViId, donViHuongThuId, groupBy = "Month" } = req.query;
        const fromToken = req.user || {};
        const userId = Number(req.query.userId || fromToken.userId) || null;
        const roleCode = (req.query.roleCode || fromToken.roleCode) || null;
        const idDonVi = Number(req.query.idDonVi || fromToken.idDonVi) || null;

        const pool = await poolPromise;
        const rs = await pool.request()
            .input("RequesterUserId", sql.Int, userId)
            .input("RequesterRoleCode", sql.NVarChar(30), roleCode)
            .input("RequesterIdDonVi", sql.Int, idDonVi)
            .input("DateFrom", sql.Date, dateFrom || null)
            .input("DateTo", sql.Date, dateTo || null)
            .input("FilterCreatorIdDonVi", sql.Int, creatorDonViId ? Number(creatorDonViId) : null)
            .input("FilterDonViHuongThuId", sql.Int, donViHuongThuId ? Number(donViHuongThuId) : null)
            .input("GroupBy", sql.NVarChar(30), groupBy)
            .execute("SS_sp_PhieuSec_GroupBy");

        const data = (rs.recordset || []).map(r => ({
            key: r.GroupKey,
            label: r.GroupLabel,
            count: Number(r.CountPhieu || 0),
            amount: Number(r.SumSoTien || 0),
        }));
        res.json(data);
    } catch (err) {
        return httpError(res, err, "Có lỗi khi lấy dashboard grouped.");
    }
});

/**
 * ✅ Upload 1 hoặc nhiều tài liệu cho 1 Phiếu séc
 * Frontend: formData.append("files", file1); formData.append("files", file2)...
 * POST /phieu/:phieuSecId/tailieu
 */
router.post('/phieu/:phieuSecId/tailieu', upload.array('files', 10), async (req, res) => {
    try {
        const { phieuSecId } = req.params;
        const files = req.files || [];
        const nguoiTao = req.body?.NguoiTao || 'system';

        if (!files.length) {
            return res.status(400).json({ success: false, message: 'Không có file nào được upload.' });
        }

        const pool = await poolPromise;

        for (const file of files) {
            // ❗ FIX MÃ HOÁ TÊN FILE
            const originalNameLatin1 = file.originalname;
            console.log({ originalNameLatin1 });
            const fileName = Buffer.from(originalNameLatin1, 'latin1').toString('utf8');

            // Nếu muốn đường dẫn đẹp hơn cũng convert luôn:
            const storedPath = file.path.replace(/\\/g, '/');
            const filePath = Buffer.from(storedPath, 'latin1').toString('utf8');

            await pool.request()
                .input('PhieuSecId', sql.Int, phieuSecId)
                .input('FilePath', sql.NVarChar(500), filePath)   // đã là Unicode đúng
                .input('FileName', sql.NVarChar(255), fileName)   // Unicode đúng
                .input('NguoiTao', sql.NVarChar(50), nguoiTao)
                .query(`
                    INSERT INTO SS_PhieuSecTaiLieu (PhieuSecId, FilePath, FileName, NguoiTao)
                    VALUES (@PhieuSecId, @FilePath, @FileName, @NguoiTao)
                `);
        }

        res.json({ success: true, message: 'Upload tài liệu thành công.' });
    } catch (err) {
        console.error('❌ Lỗi upload tài liệu phiếu séc:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi upload tài liệu phiếu séc.' });
    }
});


/**
 * 📄 Lấy danh sách tài liệu theo phiếu
 * GET /phieu/:phieuSecId/tailieu
 */
router.get('/phieu/:phieuSecId/tailieu', async (req, res) => {
    try {
        const { phieuSecId } = req.params;
        const pool = await poolPromise;

        const result = await pool.request()
            .input('PhieuSecId', sql.Int, phieuSecId)
            .query(`
                SELECT TaiLieuId, FileName, NguoiTao, NgayTao
                FROM SS_PhieuSecTaiLieu
                WHERE PhieuSecId = @PhieuSecId AND IsDeleted = 0
                ORDER BY NgayTao DESC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error('❌ Lỗi lấy tài liệu phiếu séc:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi lấy tài liệu phiếu séc.' });
    }
});

/**
 * 👀 Xem / tải file
 * GET /phieu/tailieu/:taiLieuId
 */
router.get('/phieu/tailieu/:taiLieuId', async (req, res) => {
    try {
        const { taiLieuId } = req.params;
        const pool = await poolPromise;

        const result = await pool.request()
            .input('TaiLieuId', sql.Int, taiLieuId)
            .query(`
                SELECT FilePath, FileName
                FROM SS_PhieuSecTaiLieu
                WHERE TaiLieuId = @TaiLieuId AND IsDeleted = 0
            `);

        const row = result.recordset[0];
        if (!row) {
            return res.status(404).send('Không tìm thấy tài liệu.');
        }

        const filePath = row.FilePath;
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).send('File không tồn tại trên server.');
        }

        res.setHeader(
            'Content-Disposition',
            `inline; filename="${encodeURIComponent(row.FileName)}"`
        );
        res.sendFile(path.resolve(filePath));
    } catch (err) {
        console.error('❌ Lỗi xem tài liệu phiếu séc:', err);
        res.status(500).send('Lỗi khi xem tài liệu phiếu séc.');
    }
});

// GET /phieu/tailieu/:taiLieuId
router.get('/phieu/tailieu/:taiLieuId', async (req, res) => {
    try {
        const { taiLieuId } = req.params;
        const pool = await poolPromise;
        console.log({ taiLieuId });
        const result = await pool.request()
            .input('TaiLieuId', sql.Int, taiLieuId)
            .query(`
                SELECT FilePath, FileName
                FROM SS_PhieuSecTaiLieu
                WHERE TaiLieuId = @TaiLieuId AND IsDeleted = 0
            `);

        const row = result.recordset[0];
        if (!row) return res.status(404).send('Không tìm thấy tài liệu.');

        const filePath = row.FilePath;
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).send('File không tồn tại trên server.');
        }

        res.setHeader(
            'Content-Disposition',
            `inline; filename="${encodeURIComponent(row.FileName)}"`
        );
        res.sendFile(path.resolve(filePath));
    } catch (err) {
        console.error('❌ Lỗi xem tài liệu phiếu séc:', err);
        res.status(500).send('Lỗi khi xem tài liệu phiếu séc.');
    }
});

// DELETE /phieu/tailieu/:taiLieuId
router.delete('/phieu/tailieu/:taiLieuId', async (req, res) => {
    try {
        const { taiLieuId } = req.params;
        const pool = await poolPromise;

        // 1. Lấy đường dẫn file
        const result = await pool.request()
            .input('TaiLieuId', sql.Int, taiLieuId)
            .query(`
                SELECT FilePath
                FROM SS_PhieuSecTaiLieu
                WHERE TaiLieuId = @TaiLieuId
            `);

        const row = result.recordset[0];
        if (!row) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu.' });
        }

        const filePath = row.FilePath;

        // 2. Xoá file trên server
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                console.error('⚠ Không xoá được file, nhưng tiếp tục xoá DB:', e);
            }
        }

        // 3. Xoá/đánh dấu xoá trong DB
        await pool.request()
            .input('TaiLieuId', sql.Int, taiLieuId)
            .query(`
                UPDATE SS_PhieuSecTaiLieu
                SET IsDeleted = 1
                WHERE TaiLieuId = @TaiLieuId
            `);
        // hoặc nếu muốn xoá hẳn: DELETE FROM SS_PhieuSecTaiLieu WHERE TaiLieuId = @TaiLieuId

        res.json({ success: true, message: 'Đã xoá tài liệu.' });
    } catch (err) {
        console.error('❌ Lỗi xoá tài liệu phiếu séc:', err);
        res.status(500).json({ success: false, message: 'Lỗi khi xoá tài liệu phiếu séc.' });
    }
});

// 📡 Đăng ký / cập nhật device token cho 1 user
router.post('/device/register', async (req, res) => {
    try {
        const { userId, roleCode, pushToken, platform } = req.body;

        if (!userId || !pushToken) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu userId hoặc pushToken',
            });
        }

        const pool = await poolPromise;

        // Nếu token đã tồn tại cho user này -> bật lại IsActive
        await pool.request()
            .input('UserId', sql.Int, userId)
            .input('RoleCode', sql.NVarChar(50), roleCode || null)
            .input('PushToken', sql.NVarChar(255), pushToken)
            .input('Platform', sql.NVarChar(20), platform || null)
            .query(`
                MERGE SS_DeviceToken AS target
                USING (
                    SELECT @UserId AS UserId, @PushToken AS PushToken
                ) AS src
                ON target.UserId = src.UserId AND target.PushToken = src.PushToken
                WHEN MATCHED THEN
                    UPDATE SET 
                        IsActive = 1,
                        RoleCode = @RoleCode,
                        Platform = @Platform
                WHEN NOT MATCHED THEN
                    INSERT (UserId, RoleCode, PushToken, Platform, IsActive)
                    VALUES (@UserId, @RoleCode, @PushToken, @Platform, 1);
            `);

        return res.json({ success: true });
    } catch (err) {
        console.error('❌ Lỗi /device/register:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi server khi đăng ký device',
        });
    }
});

module.exports = router