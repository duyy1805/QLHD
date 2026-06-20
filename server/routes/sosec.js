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
const { sendPushToUsers } = require('../utils/push'); // path chá»‰nh cho Ä‘Ãºng
// ðŸ“ ThÆ° má»¥c lÆ°u file Ä‘Ã­nh kÃ¨m phiáº¿u sÃ©c
const uploadDir = 'C:/DocumentsUpload/SoSec/Upload';

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

function decodeMultipartFileName(fileName) {
    return Buffer.from(fileName, 'latin1').toString('utf8');
}

function resolveAttachmentPath(filePath) {
    if (!filePath) return null;
    if (fs.existsSync(filePath)) return filePath;

    const legacyPath = Buffer.from(filePath, 'utf8').toString('latin1');
    return fs.existsSync(legacyPath) ? legacyPath : null;
}

function normalizeAttachmentName(fileName) {
    if (typeof fileName !== 'string' || !/(Ãƒ|Ã‚|Ã„|Ã¡Â»|Ã¡Âº|Ã°Å¸)/.test(fileName)) {
        return fileName;
    }

    const decodedName = decodeMultipartFileName(fileName);
    return decodedName.includes('\uFFFD') ? fileName : decodedName;
}

// âš™ï¸ Cáº¥u hÃ¬nh multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Giá»¯ tÃªn gá»‘c + timestamp cho dá»… nhÃ¬n
        const originalName = path.basename(decodeMultipartFileName(file.originalname));
        const uniqueName = Date.now() + '-' + originalName;
        cb(null, uniqueName);
    }
});
const upload = multer({ storage });

/* ========= Helpers ========= */
function httpError(res, err, fallback = "CÃ³ lá»—i xáº£y ra khi truy váº¥n cÆ¡ sá»Ÿ dá»¯ liá»‡u.") {
    console.error(err);
    const code = err?.number || err?.code;
    const msg = err?.originalError?.info?.message || err.message || fallback;
    // náº¿u THROW 72xxx tá»« proc => lá»—i nghiá»‡p vá»¥ (400)
    const http = String(code || "").startsWith("72") ? 400 : 500;
    return res.status(http).json({ message: msg, code });
}


function mapPhieuSec(r) {
    return {
        id: r.PhieuSecId,
        ngay: r.Ngay,
        noiDung: r.NoiDung,
        donViId: r.DonViHuongThuId,
        soTien: Number(r.SoTien),
        nguoiDangKyId: r.NguoiDangKyId,
        idDonVi: r.IdDonVi,
        ghiChu: r.GhiChu,
        maLenhChi: r.MaLenhChi,
        trangThai: r.MaTrangThai,
        tbpTime: r.TBP_Time,
        kttTime: r.KTT_Time,
        gdTime: r.GD_Time,
        traLaiTime: r.TraLai_Time,
        lyDoTraLai: r.LyDoTraLai,
        tenDonVi: r.TenDonVi,
        tenChuyenKhoanHuongThu: r.TenChuyenKhoan ?? null,
        soTaiKhoanHuongThu: r.SoTaiKhoan ?? null,
        maNganHangHuongThu: r.MaNganHang ?? null,
        chiNhanhNganHangHuongThu: r.ChiNhanhNganHang ?? null,
        maSoSec: r.MaSoSec,
        loaiSec: r.LoaiSec || 'VND',
        maLoaiChiPhi: r.MaLoaiChiPhi || 'Khac',
        maLoaiTien: r.MaLoaiTien || 'VND',
        tenNguoiTao: r.TenNguoiTao ?? null,
        tenDonViNguoiTao: r.TenDonViNguoiTao ?? null,
    };
}
// GET /api/sosec/role/:userId  => { role: "TBP" | "KTT" | "GD" | "NhanVien" }
router.get("/role/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!userId) return res.status(400).json({ message: "userId khÃ´ng há»£p lá»‡" });

        const pool = await poolPromise;
        const rs = await pool.request()
            .input("UserId", sql.Int, userId)
            .query(`
                SELECT RoleCode = dbo.SS_fn_UserRoleCode(@UserId);
                SELECT MaQuyen = cn.Ma_ChucNang
                FROM Tag_System.dbo.PQ_TaiKhoan_ChucNang AS pq
                JOIN Tag_System.dbo.PQ_DM_ChucNang AS cn
                  ON cn.ID_ChucNang = pq.ID_ChucNang
                WHERE pq.ID_TaiKhoanDangNhap = @UserId
                  AND pq.CapNhat = 1
                  AND cn.TonTai = 1
                  AND cn.Ma_ChucNang IN (N'TBP', N'KTT', N'GD', N'Admin', N'TaoLenhChi', N'AdminDanhMuc')
                ORDER BY cn.Ma_ChucNang;
            `);

        const role = rs.recordsets?.[0]?.[0]?.RoleCode || "NhanVien";
        const permissions = (rs.recordsets?.[1] || []).map((row) => row.MaQuyen);
        res.json({ role, permissions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Láº¥y role tháº¥t báº¡i" });
    }
});

/* =========================================================================
 *                                ÄÆ N Vá»Š
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

        const rows = rs.recordset || [];
        const bankRs = await pool.request().query(`
            SELECT MaNganHang, TenNganHang
            FROM dbo.SS_NganHang
        `);
        const bankMap = new Map((bankRs.recordset || []).map((row) => [row.MaNganHang, row.TenNganHang]));
        res.json(rows.map((row) => ({
            ...row,
            tenChuyenKhoan: row.tenChuyenKhoan ?? row.TenChuyenKhoan ?? null,
            tenNganHang: bankMap.get(row.maNganHang) || null,
        }))); // [{ id, name, stk, maNganHang, tenNganHang, TonTai }]
    } catch (err) {
        return httpError(res, err, "CÃ³ lá»—i xáº£y ra khi láº¥y danh sÃ¡ch Ä‘Æ¡n vá»‹.");
    }
});

// POST /donvi
router.post("/donvi", async (req, res) => {
    try {
        const { name, stk, maNganHang, chiNhanhNganHang, tenChuyenKhoan } = req.body;
        const pool = await poolPromise;
        const rs = await pool
            .request()
            .input("TenDonVi", sql.NVarChar(200), name || null)
            .input("SoTaiKhoan", sql.NVarChar(50), stk || null)
            .input("MaNganHang", sql.NVarChar(50), maNganHang || null)
            .input("ChiNhanhNganHang", sql.NVarChar(200), chiNhanhNganHang?.trim() || null)
            .input("TenChuyenKhoan", sql.NVarChar(300), tenChuyenKhoan?.trim() || null)
            .output("NewId", sql.Int)
            .execute("SS_sp_DonVi_Tao");

        res.status(201).json({ id: rs.output.NewId, name, stk, maNganHang, chiNhanhNganHang: chiNhanhNganHang?.trim() || null, tenChuyenKhoan: tenChuyenKhoan?.trim() || null, TonTai: 1 });
    } catch (err) {
        return httpError(res, err, "CÃ³ lá»—i xáº£y ra khi thÃªm Ä‘Æ¡n vá»‹.");
    }
});


// PUT /api/sosec/donvi/:id
router.put("/donvi/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);
        const {
            name,
            stk,
            maNganHang,
            chiNhanhNganHang,
            tenChuyenKhoan,
            requesterUserId,
            requesterRoleCode,
            phieuId,
        } = req.body;
        if (!id) return res.status(400).json({ message: "id không hợp lệ" });

        const pool = await poolPromise;
        const roleCode = String(requesterRoleCode || "");
        const isAdmin = roleCode === "Admin";
        const userId = Number(requesterUserId || req.user?.userId);
        const phieuSecId = Number(phieuId);

        if (!isAdmin) {
            if (!userId || !phieuSecId) {
                return res.status(403).json({ message: "Bạn không có quyền cập nhật đơn vị này." });
            }

            const permission = await pool.request()
                .input("PhieuSecId", sql.Int, phieuSecId)
                .input("DonViId", sql.Int, id)
                .input("RequesterUserId", sql.Int, userId)
                .query(`
                    SELECT TOP 1 PhieuSecId
                    FROM dbo.SS_vw_PhieuSec_Client
                    WHERE PhieuSecId = @PhieuSecId
                      AND DonViHuongThuId = @DonViId
                      AND NguoiDangKyId = @RequesterUserId
                      AND MaTrangThai = N'KhoiTao'
                `);

            if (!permission.recordset?.length) {
                return res.status(403).json({ message: "Chi duoc sua don vi cua phieu do ban tao khi dang nhap." });
            }
        }

        await pool.request()
            .input("DonViId", sql.Int, id)
            .input("TenDonVi", sql.NVarChar(200), name || null)
            .input("SoTaiKhoan", sql.NVarChar(50), stk || null)
            .input("MaNganHang", sql.NVarChar(50), maNganHang || null)
            .input("ChiNhanhNganHang", sql.NVarChar(200), chiNhanhNganHang?.trim() || null)
            .input("TenChuyenKhoan", sql.NVarChar(300), tenChuyenKhoan?.trim() || null)
            .execute("SS_sp_DonVi_Update");

        res.json({ id, name, stk, maNganHang, chiNhanhNganHang: chiNhanhNganHang?.trim() || null, tenChuyenKhoan: tenChuyenKhoan?.trim() || null });
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
        return httpError(res, err, "CÃ³ lá»—i xáº£y ra khi xoÃ¡ Ä‘Æ¡n vá»‹.");
    }
});

/* =========================================================================
 *                              NGAN HANG
 * ========================================================================= */

router.get("/nganhang", async (req, res) => {
    try {
        const { tukhoa, tontai } = req.query;
        const onlyActive = tontai === undefined ? null : Number(tontai) ? 1 : 0;
        const pool = await poolPromise;
        const rs = await pool.request()
            .input("TuKhoa", sql.NVarChar(200), tukhoa || null)
            .input("TonTai", sql.Bit, onlyActive)
            .query(`
                SELECT MaNganHang, TenNganHang, TonTai
                FROM dbo.SS_NganHang
                WHERE (@TonTai IS NULL OR TonTai = @TonTai)
                  AND (
                    @TuKhoa IS NULL
                    OR MaNganHang LIKE N'%' + @TuKhoa + N'%'
                    OR TenNganHang LIKE N'%' + @TuKhoa + N'%'
                  )
                ORDER BY MaNganHang;
            `);
        res.json(rs.recordset);
    } catch (err) {
        return httpError(res, err, "Co loi khi lay danh muc ngan hang.");
    }
});

router.post("/nganhang", async (req, res) => {
    try {
        const maNganHang = String(req.body?.maNganHang || "").trim().toUpperCase();
        const tenNganHang = String(req.body?.tenNganHang || "").trim();
        if (!/^[A-Z0-9]{2,50}$/.test(maNganHang) || !tenNganHang) {
            return res.status(400).json({ message: "Ma va ten ngan hang khong hop le." });
        }
        const pool = await poolPromise;
        await pool.request()
            .input("MaNganHang", sql.NVarChar(50), maNganHang)
            .input("TenNganHang", sql.NVarChar(300), tenNganHang)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.SS_NganHang WHERE MaNganHang = @MaNganHang)
                    THROW 72051, 'Ma ngan hang da ton tai', 1;
                INSERT dbo.SS_NganHang(MaNganHang, TenNganHang, TonTai)
                VALUES (@MaNganHang, @TenNganHang, 1);
            `);
        res.status(201).json({ MaNganHang: maNganHang, TenNganHang: tenNganHang, TonTai: true });
    } catch (err) {
        return httpError(res, err, "Co loi khi them ngan hang.");
    }
});

router.put("/nganhang/:maNganHang", async (req, res) => {
    try {
        const maNganHang = String(req.params.maNganHang || "").trim().toUpperCase();
        const tenNganHang = String(req.body?.tenNganHang || "").trim();
        const tonTai = req.body?.tonTai === undefined ? 1 : req.body.tonTai ? 1 : 0;
        if (!maNganHang || !tenNganHang) {
            return res.status(400).json({ message: "Ma va ten ngan hang khong hop le." });
        }
        const pool = await poolPromise;
        await pool.request()
            .input("MaNganHang", sql.NVarChar(50), maNganHang)
            .input("TenNganHang", sql.NVarChar(300), tenNganHang)
            .input("TonTai", sql.Bit, tonTai)
            .query(`
                UPDATE dbo.SS_NganHang
                SET TenNganHang = @TenNganHang, TonTai = @TonTai
                WHERE MaNganHang = @MaNganHang;
                IF @@ROWCOUNT = 0 THROW 72052, 'Khong tim thay ngan hang', 1;
            `);
        res.json({ MaNganHang: maNganHang, TenNganHang: tenNganHang, TonTai: !!tonTai });
    } catch (err) {
        return httpError(res, err, "Co loi khi cap nhat ngan hang.");
    }
});

router.delete("/nganhang/:maNganHang", async (req, res) => {
    try {
        const maNganHang = String(req.params.maNganHang || "").trim().toUpperCase();
        const pool = await poolPromise;
        await pool.request()
            .input("MaNganHang", sql.NVarChar(50), maNganHang)
            .query(`
                UPDATE dbo.SS_NganHang SET TonTai = 0 WHERE MaNganHang = @MaNganHang;
                IF @@ROWCOUNT = 0 THROW 72052, 'Khong tim thay ngan hang', 1;
            `);
        res.json({ MaNganHang: maNganHang, TonTai: false });
    } catch (err) {
        return httpError(res, err, "Co loi khi ngung su dung ngan hang.");
    }
});

/* =========================================================================
 *                              LOAI TIEN
 * ========================================================================= */

router.get("/loaitien", async (req, res) => {
    try {
        const pool = await poolPromise;
        const onlyActive = req.query.tontai === undefined ? null : Number(req.query.tontai) ? 1 : 0;
        const rs = await pool.request()
            .input("TonTai", sql.Bit, onlyActive)
            .query(`
                SELECT MaLoaiTien, TenLoaiTien, TonTai
                FROM dbo.SS_LoaiTien
                WHERE @TonTai IS NULL OR TonTai = @TonTai
                ORDER BY CASE WHEN MaLoaiTien = N'VND' THEN 0 ELSE 1 END, MaLoaiTien
            `);
        res.json(rs.recordset);
    } catch (err) {
        return httpError(res, err, "Co loi khi lay danh muc loai tien.");
    }
});

router.post("/loaitien", async (req, res) => {
    try {
        const maLoaiTien = String(req.body?.maLoaiTien || "").trim().toUpperCase();
        const tenLoaiTien = String(req.body?.tenLoaiTien || "").trim();
        if (!/^[A-Z0-9]{2,10}$/.test(maLoaiTien) || !tenLoaiTien) {
            return res.status(400).json({ message: "Ma va ten loai tien khong hop le." });
        }
        const pool = await poolPromise;
        await pool.request()
            .input("MaLoaiTien", sql.NVarChar(10), maLoaiTien)
            .input("TenLoaiTien", sql.NVarChar(100), tenLoaiTien)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.SS_LoaiTien WHERE MaLoaiTien = @MaLoaiTien)
                    THROW 72041, 'Ma loai tien da ton tai', 1;
                INSERT dbo.SS_LoaiTien(MaLoaiTien, TenLoaiTien, TonTai)
                VALUES (@MaLoaiTien, @TenLoaiTien, 1);
            `);
        res.status(201).json({ MaLoaiTien: maLoaiTien, TenLoaiTien: tenLoaiTien, TonTai: true });
    } catch (err) {
        return httpError(res, err, "Co loi khi them loai tien.");
    }
});

router.put("/loaitien/:maLoaiTien", async (req, res) => {
    try {
        const maLoaiTien = String(req.params.maLoaiTien || "").trim().toUpperCase();
        const tenLoaiTien = String(req.body?.tenLoaiTien || "").trim();
        const tonTai = req.body?.tonTai === undefined ? 1 : req.body.tonTai ? 1 : 0;
        if (!tenLoaiTien) return res.status(400).json({ message: "Ten loai tien khong duoc de trong." });
        const pool = await poolPromise;
        await pool.request()
            .input("MaLoaiTien", sql.NVarChar(10), maLoaiTien)
            .input("TenLoaiTien", sql.NVarChar(100), tenLoaiTien)
            .input("TonTai", sql.Bit, maLoaiTien === "VND" ? 1 : tonTai)
            .query(`
                UPDATE dbo.SS_LoaiTien
                SET TenLoaiTien = @TenLoaiTien, TonTai = @TonTai
                WHERE MaLoaiTien = @MaLoaiTien;
                IF @@ROWCOUNT = 0 THROW 72042, 'Khong tim thay loai tien', 1;
            `);
        res.json({ MaLoaiTien: maLoaiTien, TenLoaiTien: tenLoaiTien, TonTai: maLoaiTien === "VND" ? true : !!tonTai });
    } catch (err) {
        return httpError(res, err, "Co loi khi cap nhat loai tien.");
    }
});

router.delete("/loaitien/:maLoaiTien", async (req, res) => {
    try {
        const maLoaiTien = String(req.params.maLoaiTien || "").trim().toUpperCase();
        if (maLoaiTien === "VND") return res.status(400).json({ message: "Khong the ngung su dung VND." });
        const pool = await poolPromise;
        await pool.request()
            .input("MaLoaiTien", sql.NVarChar(10), maLoaiTien)
            .query(`
                UPDATE dbo.SS_LoaiTien SET TonTai = 0 WHERE MaLoaiTien = @MaLoaiTien;
                IF @@ROWCOUNT = 0 THROW 72042, 'Khong tim thay loai tien', 1;
            `);
        res.json({ MaLoaiTien: maLoaiTien, TonTai: false });
    } catch (err) {
        return httpError(res, err, "Co loi khi ngung su dung loai tien.");
    }
});


/* =========================================================================
 *                               PHIáº¾U SÃ‰C
 * ========================================================================= */

// GET /api/sosec/phieu?tukhoa=&trangthai=&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
router.get("/phieu", /* verifyToken, */ async (req, res) => {
    try {
        const { tukhoa, trangthai, dateFrom, dateTo, loaiSec, maLoaiTien } = req.query;
        const fromToken = req.user || {};
        // Táº¡m thá»i nháº­n tá»« query náº¿u chÆ°a báº­t auth
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
            .input("LoaiSec", sql.NVarChar(20), loaiSec || null)
            .input("MaLoaiTien", sql.NVarChar(10), maLoaiTien || null)
            .execute("SS_sp_PhieuSec_DanhSach");

        // Map vá» shape FE Ä‘ang dÃ¹ng
        const data = rs.recordset.map(mapPhieuSec);
        res.json(data);
    } catch (err) {
        return httpError(res, err, "CÃ³ lá»—i xáº£y ra khi láº¥y danh sÃ¡ch phiáº¿u sÃ©c.");
    }
});

// GET /api/sosec/lenhchi/pending?userId=
router.get("/lenhchi/pending", async (req, res) => {
    try {
        const userId = Number(req.query.userId || req.user?.userId);
        if (!userId) return res.status(400).json({ message: "userId khong hop le" });

        const pool = await poolPromise;
        const rs = await pool.request()
            .input("RequesterUserId", sql.Int, userId)
            .input("LoaiSec", sql.NVarChar(20), req.query.loaiSec || null)
            .input("MaLoaiTien", sql.NVarChar(10), req.query.maLoaiTien || null)
            .execute("SS_sp_LenhChi_DanhSachChoNhap");

        res.json(rs.recordset.map(mapPhieuSec));
    } catch (err) {
        return httpError(res, err, "Co loi khi lay danh sach cho nhap lenh chi.");
    }
});

router.get("/phieu/:id", /* verifyToken, */ async (req, res) => {
    try {
        const phieuId = Number(req.params.id);
        if (!phieuId) return res.status(400).json({ message: "id khÃ´ng há»£p lá»‡" });

        const fromToken = req.user || {};
        // Táº¡m thá»i nháº­n tá»« query náº¿u chÆ°a báº­t auth
        const userId = Number(req.query.userId || fromToken.userId) || null;
        const roleCode = (req.query.roleCode || fromToken.roleCode) || null;
        const idDonVi = Number(req.query.idDonVi || fromToken.idDonVi) || null;

        const pool = await poolPromise;
        console.log({ phieuId, userId, roleCode, idDonVi });
        let r;

        // ===== CÃ¡ch 1: náº¿u cÃ³ proc GetById thÃ¬ dÃ¹ng (khuyáº¿n nghá»‹) =====
        try {
            const rs1 = await pool.request()
                .input("PhieuSecId", sql.Int, phieuId)
                .input("RequesterUserId", sql.Int, userId)
                .input("RequesterRoleCode", sql.NVarChar(30), roleCode)
                .input("RequesterIdDonVi", sql.Int, idDonVi)
                .execute("SS_sp_PhieuSec_GetById"); // <-- táº¡o proc nÃ y theo quyá»n cá»§a báº¡n

            r = rs1.recordset?.[0];
        } catch (e) {
            // Náº¿u proc chÆ°a tá»“n táº¡i thÃ¬ fallback DanhSach
            const rs2 = await pool.request()
                .input("TuKhoa", sql.NVarChar(200), null)
                .input("TrangThaiMa", sql.NVarChar(30), null)
                .input("DateFrom", sql.Date, null)
                .input("DateTo", sql.Date, null)
                .input("RequesterUserId", sql.Int, userId)
                .input("RequesterRoleCode", sql.NVarChar(30), roleCode)
                .input("RequesterIdDonVi", sql.Int, idDonVi)
                .input("LoaiSec", sql.NVarChar(20), null)
                .input("MaLoaiTien", sql.NVarChar(10), null)
                .execute("SS_sp_PhieuSec_DanhSach");

            r = rs2.recordset.find(x => x.PhieuSecId === phieuId);
        }

        if (!r) return res.status(404).json({ message: "KhÃ´ng tÃ¬m tháº¥y phiáº¿u" });

        // Map vá» shape FE Ä‘ang dÃ¹ng
        const mapped = {
            id: r.PhieuSecId,
            maSoSec: r.MaSoSec,               // << quan trá»ng
            loaiSec: r.LoaiSec || 'VND',
            maLoaiChiPhi: r.MaLoaiChiPhi || 'Khac',
            maLoaiTien: r.MaLoaiTien || 'VND',
            ngay: r.Ngay,
            noiDung: r.NoiDung,
            donViId: r.DonViHuongThuId,
            soTien: Number(r.SoTien),
            nguoiDangKyId: r.NguoiDangKyId,
            idDonVi: r.IdDonVi,
            ghiChu: r.GhiChu,
            trangThai: r.MaTrangThai,         // "ChoDuyet_TBP" | ...
            maLenhChi: r.MaLenhChi,           // náº¿u Ä‘Ã£ cÃ³
            tbpTime: r.TBP_Time,
            kttTime: r.KTT_Time,
            gdTime: r.GD_Time,
            traLaiTime: r.TraLai_Time,
            lyDoTraLai: r.LyDoTraLai,
            tenDonVi: r.TenDonVi,
            tenChuyenKhoanHuongThu: r.TenChuyenKhoan ?? null,
            soTaiKhoanHuongThu: r.SoTaiKhoan ?? null,
            maNganHangHuongThu: r.MaNganHang ?? null,
            chiNhanhNganHangHuongThu: r.ChiNhanhNganHang ?? null,

            // thÃªm má»›i:
            tenNguoiTao: r.TenNguoiTao ?? null,
            tenDonViNguoiTao: r.TenDonViNguoiTao ?? null,
            // náº¿u proc GetById/DanhSach cÃ³ thÃªm cÃ¡c trÆ°á»ng dÆ°á»›i thÃ¬ tá»± hiá»‡n:
            ngayNhapLenhChi: r.NgayNhapLenhChi ?? null,
            nguoiNhapLenhChiId: r.NguoiNhapLenhChiId ?? null,
        };
        return res.json(mapped);
    } catch (err) {
        return httpError(res, err, "CÃ³ lá»—i xáº£y ra khi láº¥y chi tiáº¿t phiáº¿u.");
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
//         return httpError(res, err, "CÃ³ lá»—i xáº£y ra khi táº¡o phiáº¿u sÃ©c.");
//     }
// });
// âš ï¸ XÃ“A hoáº·c comment cÃ¡i router.post("/phieu", /* verifyToken, */ ...) phÃ­a trÃªn Ä‘i
// POST /api/sosec/phieu
router.post("/phieu", async (req, res) => {
    try {
        const {
            noiDung,
            donViId,       // DonViHuongThuId
            soTien,
            nguoiDangKyId,
            idDonVi,       // IdDonVi (Ä‘Æ¡n vá»‹ táº¡o phiáº¿u)
            ghiChu,
            loaiSec = "VND",
            maLoaiChiPhi,
            maLoaiTien
        } = req.body;

        const normalizedLoaiSec = loaiSec === "NgoaiTe" ? "NgoaiTe" : "VND";
        const normalizedLoaiTien = normalizedLoaiSec === "VND" ? "VND" : String(maLoaiTien || "").trim().toUpperCase();
        const normalizedLoaiChiPhi = normalizedLoaiSec === "NgoaiTe" ? "Khac" : maLoaiChiPhi;
        if (!["TienDien", "TienGiaCong", "Khac"].includes(normalizedLoaiChiPhi)) {
            return res.status(400).json({ message: "Vui long chon loai chi phi hop le." });
        }
        if (normalizedLoaiSec === "NgoaiTe" && (!normalizedLoaiTien || normalizedLoaiTien === "VND")) {
            return res.status(400).json({ message: "Vui long chon loai tien ngoai te." });
        }

        const pool = await poolPromise;

        // 1. Gá»i stored táº¡o phiáº¿u
        const rs = await pool
            .request()
            .input("NoiDung", sql.NVarChar(500), noiDung || null)
            .input("DonViHuongThuId", sql.Int, donViId)
            .input("SoTien", sql.Decimal(18, 4), soTien)
            .input("NguoiDangKyId", sql.Int, nguoiDangKyId || null)
            .input("IdDonVi", sql.Int, idDonVi || null)
            .input("GhiChu", sql.NVarChar(500), ghiChu || null)
            .input("LoaiSec", sql.NVarChar(20), normalizedLoaiSec)
            .input("MaLoaiChiPhi", sql.NVarChar(30), normalizedLoaiChiPhi)
            .input("MaLoaiTien", sql.NVarChar(10), normalizedLoaiTien)
            .output("NewId", sql.Int)
            .execute("SS_sp_PhieuSec_Tao");

        const newId = rs.output.NewId;
        const records = rs.recordset || [];
        const info = records[0];

        if (!newId || !info) {
            return res.status(500).json({ message: "KhÃ´ng láº¥y Ä‘Æ°á»£c thÃ´ng tin phiáº¿u sau khi táº¡o." });
        }

        const phieuId = info.Id || newId;
        const maSoSec = info.MaSoSec || (`SS-${normalizedLoaiTien}-${phieuId}`);
        // Tao phieu chi luu nhap, chua gui thong bao cho TBP.
        return res.status(201).json({
            id: phieuId,
            maSoSec,
            trangThai: 'KhoiTao',
        });
    } catch (err) {
        console.error('âŒ Lá»—i táº¡o phiáº¿u sÃ©c:', err);
        return httpError(res, err, "CÃ³ lá»—i xáº£y ra khi táº¡o phiáº¿u sÃ©c.");
    }
});

router.post("/phieu/:id/submit", async (req, res) => {
    try {
        const phieuSecId = Number(req.params.id);
        const requesterUserId = Number(req.body?.requesterUserId || req.user?.userId);

        if (!phieuSecId || !requesterUserId) {
            return res.status(400).json({ message: "Thieu thong tin phieu hoac nguoi trinh." });
        }

        const pool = await poolPromise;
        const rs = await pool.request()
            .input("PhieuSecId", sql.Int, phieuSecId)
            .input("RequesterUserId", sql.Int, requesterUserId)
            .execute("SS_sp_PhieuSec_Trinh");

        const records = rs.recordset || [];
        const tbpRows = rs.recordsets?.[1] || [];
        const row = records[0];
        if (!row) return res.status(404).json({ message: "Khong tim thay phieu sau khi trinh." });

        const mapped = mapPhieuSec(row);
        const maSoSec = mapped.maSoSec || `SS-${mapped.id}`;
        const tbpUserIds = [...new Set(tbpRows.map((item) => Number(item.TBPUserId)).filter(Boolean))];

        if (tbpUserIds.length) {
            try {
                await sendPushToUsers(
                    tbpUserIds,
                    'So sec moi can duyet',
                    `Phieu sec ${maSoSec} can TBP duyet.`,
                    { phieuSecId: mapped.id, maSoSec }
                );
            } catch (pushErr) {
                console.error('Loi gui push khi trinh phieu:', pushErr);
            }
        } else {
            console.warn('Khong tim duoc TBPUserId khi trinh phieu.');
        }

        return res.json(mapped);
    } catch (err) {
        return httpError(res, err, "Co loi khi trinh phieu sec.");
    }
});

router.put("/phieu/:id", async (req, res) => {
    try {
        const phieuSecId = Number(req.params.id);
        const {
            noiDung,
            donViId,
            soTien,
            ghiChu,
            requesterUserId,
            maLoaiChiPhi,
            maLoaiTien
        } = req.body;

        if (!phieuSecId || !requesterUserId) {
            return res.status(400).json({ message: "Thieu thong tin phieu hoac nguoi cap nhat." });
        }

        const pool = await poolPromise;
        await pool.request()
            .input("PhieuSecId", sql.Int, phieuSecId)
            .input("RequesterUserId", sql.Int, requesterUserId)
            .input("NoiDung", sql.NVarChar(500), noiDung || null)
            .input("DonViHuongThuId", sql.Int, donViId)
            .input("SoTien", sql.Decimal(18, 4), soTien)
            .input("GhiChu", sql.NVarChar(500), ghiChu || null)
            .input("MaLoaiChiPhi", sql.NVarChar(30), maLoaiChiPhi || null)
            .input("MaLoaiTien", sql.NVarChar(10), maLoaiTien || null)
            .execute("SS_sp_PhieuSec_Update");

        return res.json({ success: true, id: phieuSecId });
    } catch (err) {
        return httpError(res, err, "Co loi khi cap nhat phieu sec.");
    }
});

router.delete("/phieu/:id", async (req, res) => {
    try {
        const phieuSecId = Number(req.params.id);
        const requesterUserId = Number(req.body?.requesterUserId || req.user?.userId);

        if (!phieuSecId || !requesterUserId) {
            return res.status(400).json({ message: "Thieu thong tin phieu hoac nguoi xoa." });
        }

        const pool = await poolPromise;
        await pool.request()
            .input("PhieuSecId", sql.Int, phieuSecId)
            .input("RequesterUserId", sql.Int, requesterUserId)
            .execute("SS_sp_PhieuSec_Xoa");

        return res.json({ success: true, id: phieuSecId });
    } catch (err) {
        return httpError(res, err, "Co loi khi xoa phieu sec.");
    }
});

// router.post("/phieu/:id/approve", async (req, res) => {
//     try {
//         const { id } = req.params;
//         const { nguoiDuyetId, tenNguoiDuyet, chapThuan, ghiChu, requesterUserId, requesterRoleCode, requesterIdDonVi } = req.body;
//         const pool = await poolPromise;

//         const fromToken = req.user || {};
//         // Táº¡m thá»i nháº­n tá»« query náº¿u chÆ°a báº­t auth

//         console.log({ requesterUserId, requesterRoleCode, requesterIdDonVi });
//         await pool.request()
//             .input("PhieuSecId", sql.Int, Number(id))
//             .input("NguoiDuyetId", sql.Int, nguoiDuyetId)
//             .input("TenNguoiDuyet", sql.NVarChar(200), tenNguoiDuyet || null)
//             .input("ChapThuan", sql.Bit, !!chapThuan)
//             .input("GhiChu", sql.NVarChar(500), ghiChu || null)
//             .execute("SS_sp_PhieuSec_Duyet");

//         // láº¥y láº¡i 1 record
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
//         if (!r) return res.status(404).json({ message: "KhÃ´ng tÃ¬m tháº¥y phiáº¿u sau khi duyá»‡t" });

//         // map vá» FE
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

//             // thÃªm má»›i:
//             tenNguoiTao: r.TenNguoiTao ?? null,
//             tenDonViNguoiTao: r.TenDonViNguoiTao ?? null,
//         };

//         res.json(mapped);
//     } catch (err) {
//         console.error(err);
//         res.status(500).json({ message: "CÃ³ lá»—i xáº£y ra khi duyá»‡t phiáº¿u." });
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
            requesterIdDonVi,
            traLai = false
        } = req.body;

        if ((chapThuan === false || traLai) && !ghiChu?.trim()) {
            return res.status(400).json({ message: "Vui lÃ²ng nháº­p lÃ½ do tá»« chá»‘i hoáº·c tráº£ láº¡i." });
        }

        const pool = await poolPromise;

        // 1. Gá»i proc duyá»‡t
        await pool.request()
            .input("PhieuSecId", sql.Int, Number(id))
            .input("NguoiDuyetId", sql.Int, nguoiDuyetId)
            .input("TenNguoiDuyet", sql.NVarChar(200), tenNguoiDuyet || null)
            .input("ChapThuan", sql.Bit, !!chapThuan)
            .input("GhiChu", sql.NVarChar(500), ghiChu || null)
            .input("TraLai", sql.Bit, !!traLai)
            .execute("SS_sp_PhieuSec_Duyet");

        // 2. Láº¥y láº¡i 1 record sau khi duyá»‡t
        const rs = await pool.request()
            .input("TuKhoa", sql.NVarChar(200), null)
            .input("TrangThaiMa", sql.NVarChar(30), null)
            .input("DateFrom", sql.Date, null)
            .input("DateTo", sql.Date, null)
            .input("RequesterUserId", requesterUserId)
            .input("RequesterRoleCode", requesterRoleCode)
            .input("RequesterIdDonVi", requesterIdDonVi)
            .input("LoaiSec", sql.NVarChar(20), null)
            .input("MaLoaiTien", sql.NVarChar(10), null)
            .execute("SS_sp_PhieuSec_DanhSach");

        let r = rs.recordset.find(x => x.PhieuSecId === Number(id));
        if (!r && traLai) {
            const returned = await pool.request()
                .input("PhieuSecId", sql.Int, Number(id))
                .query(`
                    SELECT TOP 1 *
                    FROM dbo.SS_vw_PhieuSec_Client
                    WHERE PhieuSecId = @PhieuSecId
                `);
            r = returned.recordset[0];
        }
        if (!r) return res.status(404).json({ message: "KhÃ´ng tÃ¬m tháº¥y phiáº¿u sau khi duyá»‡t" });

        // ðŸ’¾ Äáº£m báº£o proc SS_sp_PhieuSec_DanhSach tráº£ thÃªm:
        // r.MaSoSec, r.TBPUserId, r.KTTUserId, r.GDUserId, r.NguoiDangKyId, ...

        // map vá» FE
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
            traLaiTime: r.TraLai_Time,
            lyDoTraLai: r.LyDoTraLai,
            tenDonVi: r.TenDonVi,
            tenChuyenKhoanHuongThu: r.TenChuyenKhoan ?? null,
            soTaiKhoanHuongThu: r.SoTaiKhoan ?? null,
            maNganHangHuongThu: r.MaNganHang ?? null,
            chiNhanhNganHangHuongThu: r.ChiNhanhNganHang ?? null,
            maSoSec: r.MaSoSec,
            loaiSec: r.LoaiSec || 'VND',
            maLoaiChiPhi: r.MaLoaiChiPhi || 'Khac',
            maLoaiTien: r.MaLoaiTien || 'VND',
            tenNguoiTao: r.TenNguoiTao ?? null,
            tenDonViNguoiTao: r.TenDonViNguoiTao ?? null,
        };

        // 3. Gá»­i push theo tráº¡ng thÃ¡i má»›i
        try {
            const targets = [];
            let title = '';
            let body = '';

            const trangThai = mapped.trangThai;
            const maSoSec = mapped.maSoSec || ('SS-' + mapped.id);

            if (traLai) {
                if (mapped.nguoiDangKyId) {
                    targets.push(mapped.nguoiDangKyId);
                    title = 'Phieu sec duoc tra lai ve Nhap';
                    body = `Phieu sec ${maSoSec} da duoc tra lai ve Nhap de chinh sua. Ly do: ${ghiChu || 'Khong ghi ro.'}`;
                }
            } else if (chapThuan) {
                // âœ… TrÆ°á»ng há»£p DUYá»†T
                if (trangThai === 'ChoDuyet_KTT' && r.KTTUserId) {
                    // TBP duyá»‡t xong, Ä‘áº©y lÃªn KTT
                    targets.push(r.KTTUserId);
                    title = 'Phiáº¿u sÃ©c cáº§n KTT duyá»‡t';
                    body = `Phiáº¿u sÃ©c ${maSoSec} Ä‘Ã£ Ä‘Æ°á»£c TBP duyá»‡t, chá» KTT phÃª duyá»‡t.`;
                } else if (trangThai === 'ChoDuyet_GD' && r.GDUserId) {
                    // KTT duyá»‡t xong, Ä‘áº©y lÃªn GD
                    targets.push(r.GDUserId);
                    title = 'Phiáº¿u sÃ©c cáº§n GiÃ¡m Ä‘á»‘c duyá»‡t';
                    body = `Phiáº¿u sÃ©c ${maSoSec} Ä‘Ã£ Ä‘Æ°á»£c KTT duyá»‡t, chá» GiÃ¡m Ä‘á»‘c phÃª duyá»‡t.`;
                } else if (trangThai === 'HoanThanh' && mapped.nguoiDangKyId) {
                    // GiÃ¡m Ä‘á»‘c duyá»‡t xong, bÃ¡o cho ngÆ°á»i Ä‘Äƒng kÃ½
                    targets.push(mapped.nguoiDangKyId);
                    title = 'Phiáº¿u sÃ©c Ä‘Ã£ Ä‘Æ°á»£c duyá»‡t xong';
                    body = `Phiáº¿u sÃ©c ${maSoSec} Ä‘Ã£ Ä‘Æ°á»£c duyá»‡t hoÃ n thÃ nh.`;
                }
            } else {
                // âŒ TrÆ°á»ng há»£p Tá»ª CHá»I
                if (trangThai === 'TuChoi' && mapped.nguoiDangKyId) {
                    targets.push(mapped.nguoiDangKyId);
                    title = 'Phiáº¿u sÃ©c bá»‹ tá»« chá»‘i';
                    body = `Phiáº¿u sÃ©c ${maSoSec} Ä‘Ã£ bá»‹ tá»« chá»‘i. LÃ½ do: ${ghiChu || 'KhÃ´ng ghi rÃµ.'}`;
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
            console.error('âš  Lá»—i gá»­i push khi duyá»‡t phiáº¿u:', pushErr);
            // KhÃ´ng throw ra ngoÃ i, trÃ¡nh lÃ m fail duyá»‡t vÃ¬ lá»—i push
        }

        res.json(mapped);
    } catch (err) {
        return httpError(res, err, "CÃ³ lá»—i xáº£y ra khi duyá»‡t phiáº¿u.");
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

        res.status(201).json({ message: "ÄÃ£ táº¡o lá»‡nh chi cho phiáº¿u " + id });
    } catch (err) {
        return httpError(res, err, "CÃ³ lá»—i khi táº¡o lá»‡nh chi");
    }
});

router.get("/dashboard", async (req, res) => {
    try {
        const { dateFrom, dateTo, loaiSec, maLoaiTien } = req.query;
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
            .input("LoaiSec", sql.NVarChar(20), loaiSec || null)
            .input("MaLoaiTien", sql.NVarChar(10), maLoaiTien || null)
            .execute("SS_sp_PhieuSec_Dashboard");

        const r = rs.recordset?.[0] || {};
        return res.json({
            draft: Number(r.KhoiTao || 0),
            waitingTBP: Number(r.ChoDuyet_TBP || 0),
            waitingKTT: Number(r.ChoDuyet_KTT || 0),
            waitingGD: Number(r.ChoDuyet_GD || 0),
            completed: Number(r.HoanThanh || 0),
            rejected: Number(r.TuChoi || 0),
            total: Number(r.Tong || 0),
        });
    } catch (err) {
        return httpError(res, err, "CÃ³ lá»—i khi láº¥y dashboard.");
    }
});

// GET /api/sosec/dashboard/summary
router.get("/dashboard/summary", async (req, res) => {
    try {
        const { dateFrom, dateTo, creatorDonViId, donViHuongThuId, loaiSec, maLoaiTien } = req.query;
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
            .input("LoaiSec", sql.NVarChar(20), loaiSec || null)
            .input("MaLoaiTien", sql.NVarChar(10), maLoaiTien || null)
            .execute("SS_sp_PhieuSec_Summary");

        const r = rs.recordset?.[0] || {};
        const nullableNumber = (value) => value == null ? null : Number(value);
        const byCurrency = (rs.recordsets?.[1] || []).map(row => ({
            maLoaiTien: row.MaLoaiTien,
            count: Number(row.TotalCount || 0),
            amount: Number(row.TotalAmount || 0),
        }));
        res.json({
            totalCount: Number(r.TotalCount || 0),
            totalAmount: nullableNumber(r.TotalAmount),
            byStatus: {
                draft: { count: Number(r.KhoiTao_Count || 0), amount: nullableNumber(r.KhoiTao_Amount) },
                waitingTBP: { count: Number(r.ChoDuyet_TBP_Count || 0), amount: nullableNumber(r.ChoDuyet_TBP_Amount) },
                waitingKTT: { count: Number(r.ChoDuyet_KTT_Count || 0), amount: nullableNumber(r.ChoDuyet_KTT_Amount) },
                waitingGD: { count: Number(r.ChoDuyet_GD_Count || 0), amount: nullableNumber(r.ChoDuyet_GD_Amount) },
                completed: { count: Number(r.HoanThanh_Count || 0), amount: nullableNumber(r.HoanThanh_Amount) },
                rejected: { count: Number(r.TuChoi_Count || 0), amount: nullableNumber(r.TuChoi_Amount) },
            },
            byCurrency,
        });
    } catch (err) {
        return httpError(res, err, "CÃ³ lá»—i khi láº¥y dashboard summary.");
    }
});

// GET /api/sosec/dashboard/grouped?groupBy=Month|CreatorDonVi|DonViHuongThu
router.get("/dashboard/grouped", async (req, res) => {
    try {
        const { dateFrom, dateTo, creatorDonViId, donViHuongThuId, groupBy = "Month", loaiSec, maLoaiTien } = req.query;
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
            .input("LoaiSec", sql.NVarChar(20), loaiSec || null)
            .input("MaLoaiTien", sql.NVarChar(10), maLoaiTien || null)
            .execute("SS_sp_PhieuSec_GroupBy");

        const data = (rs.recordset || []).map(r => ({
            key: r.GroupKey,
            label: r.GroupLabel,
            count: Number(r.CountPhieu || 0),
            amount: Number(r.SumSoTien || 0),
            maLoaiTien: r.MaLoaiTien,
        }));
        res.json(data);
    } catch (err) {
        return httpError(res, err, "CÃ³ lá»—i khi láº¥y dashboard grouped.");
    }
});

/**
 * âœ… Upload 1 hoáº·c nhiá»u tÃ i liá»‡u cho 1 Phiáº¿u sÃ©c
 * Frontend: formData.append("files", file1); formData.append("files", file2)...
 * POST /phieu/:phieuSecId/tailieu
 */
router.post('/phieu/:phieuSecId/tailieu', upload.array('files', 10), async (req, res) => {
    try {
        const { phieuSecId } = req.params;
        const files = req.files || [];
        const nguoiTao = req.body?.NguoiTao || 'system';

        if (!files.length) {
            return res.status(400).json({ success: false, message: 'KhÃ´ng cÃ³ file nÃ o Ä‘Æ°á»£c upload.' });
        }

        const pool = await poolPromise;

        for (const file of files) {
            // â— FIX MÃƒ HOÃ TÃŠN FILE
            const fileName = path.basename(decodeMultipartFileName(file.originalname));
            const filePath = file.path.replace(/\\/g, '/');

            await pool.request()
                .input('PhieuSecId', sql.Int, phieuSecId)
                .input('FilePath', sql.NVarChar(500), filePath)   // Ä‘Ã£ lÃ  Unicode Ä‘Ãºng
                .input('FileName', sql.NVarChar(255), fileName)   // Unicode Ä‘Ãºng
                .input('NguoiTao', sql.NVarChar(50), nguoiTao)
                .query(`
                    INSERT INTO SS_PhieuSecTaiLieu (PhieuSecId, FilePath, FileName, NguoiTao)
                    VALUES (@PhieuSecId, @FilePath, @FileName, @NguoiTao)
                `);
        }

        res.json({ success: true, message: 'Upload tÃ i liá»‡u thÃ nh cÃ´ng.' });
    } catch (err) {
        console.error('âŒ Lá»—i upload tÃ i liá»‡u phiáº¿u sÃ©c:', err);
        res.status(500).json({ success: false, message: 'Lá»—i khi upload tÃ i liá»‡u phiáº¿u sÃ©c.' });
    }
});


/**
 * ðŸ“„ Láº¥y danh sÃ¡ch tÃ i liá»‡u theo phiáº¿u
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

        res.json(result.recordset.map(row => ({
            ...row,
            FileName: normalizeAttachmentName(row.FileName),
        })));
    } catch (err) {
        console.error('âŒ Lá»—i láº¥y tÃ i liá»‡u phiáº¿u sÃ©c:', err);
        res.status(500).json({ success: false, message: 'Lá»—i khi láº¥y tÃ i liá»‡u phiáº¿u sÃ©c.' });
    }
});

/**
 * ðŸ‘€ Xem / táº£i file
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
            return res.status(404).send('KhÃ´ng tÃ¬m tháº¥y tÃ i liá»‡u.');
        }

        const filePath = resolveAttachmentPath(row.FilePath);
        if (!filePath) {
            return res.status(404).send('File khÃ´ng tá»“n táº¡i trÃªn server.');
        }

        res.setHeader(
            'Content-Disposition',
            `inline; filename="${encodeURIComponent(normalizeAttachmentName(row.FileName))}"`
        );
        res.sendFile(path.resolve(filePath));
    } catch (err) {
        console.error('âŒ Lá»—i xem tÃ i liá»‡u phiáº¿u sÃ©c:', err);
        res.status(500).send('Lá»—i khi xem tÃ i liá»‡u phiáº¿u sÃ©c.');
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
        if (!row) return res.status(404).send('KhÃ´ng tÃ¬m tháº¥y tÃ i liá»‡u.');

        const filePath = resolveAttachmentPath(row.FilePath);
        if (!filePath) {
            return res.status(404).send('File khÃ´ng tá»“n táº¡i trÃªn server.');
        }

        res.setHeader(
            'Content-Disposition',
            `inline; filename="${encodeURIComponent(normalizeAttachmentName(row.FileName))}"`
        );
        res.sendFile(path.resolve(filePath));
    } catch (err) {
        console.error('âŒ Lá»—i xem tÃ i liá»‡u phiáº¿u sÃ©c:', err);
        res.status(500).send('Lá»—i khi xem tÃ i liá»‡u phiáº¿u sÃ©c.');
    }
});

// DELETE /phieu/tailieu/:taiLieuId
router.delete('/phieu/tailieu/:taiLieuId', async (req, res) => {
    try {
        const { taiLieuId } = req.params;
        const pool = await poolPromise;

        // 1. Láº¥y Ä‘Æ°á»ng dáº«n file
        const result = await pool.request()
            .input('TaiLieuId', sql.Int, taiLieuId)
            .query(`
                SELECT FilePath
                FROM SS_PhieuSecTaiLieu
                WHERE TaiLieuId = @TaiLieuId
            `);

        const row = result.recordset[0];
        if (!row) {
            return res.status(404).json({ success: false, message: 'KhÃ´ng tÃ¬m tháº¥y tÃ i liá»‡u.' });
        }

        const filePath = resolveAttachmentPath(row.FilePath);

        // 2. XoÃ¡ file trÃªn server
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                console.error('âš  KhÃ´ng xoÃ¡ Ä‘Æ°á»£c file, nhÆ°ng tiáº¿p tá»¥c xoÃ¡ DB:', e);
            }
        }

        // 3. XoÃ¡/Ä‘Ã¡nh dáº¥u xoÃ¡ trong DB
        await pool.request()
            .input('TaiLieuId', sql.Int, taiLieuId)
            .query(`
                UPDATE SS_PhieuSecTaiLieu
                SET IsDeleted = 1
                WHERE TaiLieuId = @TaiLieuId
            `);
        // hoáº·c náº¿u muá»‘n xoÃ¡ háº³n: DELETE FROM SS_PhieuSecTaiLieu WHERE TaiLieuId = @TaiLieuId

        res.json({ success: true, message: 'ÄÃ£ xoÃ¡ tÃ i liá»‡u.' });
    } catch (err) {
        console.error('âŒ Lá»—i xoÃ¡ tÃ i liá»‡u phiáº¿u sÃ©c:', err);
        res.status(500).json({ success: false, message: 'Lá»—i khi xoÃ¡ tÃ i liá»‡u phiáº¿u sÃ©c.' });
    }
});

// ðŸ“¡ ÄÄƒng kÃ½ / cáº­p nháº­t device token cho 1 user
router.post('/device/register', async (req, res) => {
    try {
        const { userId, roleCode, pushToken, platform } = req.body;

        if (!userId || !pushToken) {
            return res.status(400).json({
                success: false,
                message: 'Thiáº¿u userId hoáº·c pushToken',
            });
        }

        const pool = await poolPromise;

        // Náº¿u token Ä‘Ã£ tá»“n táº¡i cho user nÃ y -> báº­t láº¡i IsActive
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
        console.error('âŒ Lá»—i /device/register:', err);
        return res.status(500).json({
            success: false,
            message: 'Lá»—i server khi Ä‘Äƒng kÃ½ device',
        });
    }
});

module.exports = router

