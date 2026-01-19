const express = require('express');
const router = express.Router();
const { poolPromise } = require('../db');
const sql = require('mssql');
const { sendPushToUsers } = require('../utils/push');

/* ========= Helpers ========= */
function httpError(res, err, fallback = "Có lỗi xảy ra khi truy vấn CSDL.") {
    console.error(err);
    const code = err?.number || err?.code;
    const msg = err?.originalError?.info?.message || err.message || fallback;
    const http = String(code || "").startsWith("72") ? 400 : 500;
    return res.status(http).json({ message: msg, code });
}

/* =========================================================
   1. DANH SÁCH HÓA ĐƠN
   GET /invoice
========================================================= */
router.get("/invoice", async (req, res) => {
    try {
        const {
            tuKhoa = null,
            trangThaiMa = null,
            dateFrom = null,
            dateTo = null,
            userId = null,
            roleCode = null,
            idDonVi = null,
        } = req.query;

        const pool = await poolPromise;
        const rs = await pool.request()
            .input("TuKhoa", sql.NVarChar(200), tuKhoa)
            .input("TrangThaiMa", sql.NVarChar(50), trangThaiMa)
            .input("DateFrom", sql.Date, dateFrom)
            .input("DateTo", sql.Date, dateTo)
            .input("RequesterUserId", sql.Int, userId)
            .input("RequesterRoleCode", sql.NVarChar(30), roleCode)
            .input("RequesterIdDonVi", sql.Int, idDonVi)
            .execute("INV_sp_HoaDon_DanhSach");

        // ⭐ MAP GIỐNG sosec.js
        const data = rs.recordset.map(r => ({
            hoaDonId: r.HoaDonId,
            ngayDangKy: r.NgayDangKy,
            maHoaDon: r.MaHoaDon,

            congTyId: r.CongTyId,
            tenCongTy: r.TenCongTy,

            soTienTruocThue: r.SoTienTruocThue,
            tongVAT: r.TongVAT,
            tongThanhTien: r.TongThanhTien,

            nguoiDangKyId: r.NguoiDangKyId,
            donViNguoiDangKyId: r.DonViNguoiDangKyId,
            tenNguoiTao: r.TenNguoiTao,
            tenDonViNguoiTao: r.TenDonViNguoiTao,

            trangThaiId: r.TrangThaiId,
            tenTrangThai: r.TenTrangThai,
            maTrangThai: r.MaTrangThai,

            ghiChu: r.GhiChu,

            tbpTime: r.TBP_Time,
            kttTime: r.KTT_Time,
            gdTime: r.GD_Time,

            tbpUserId: r.TBPUserId,
            kttUserId: r.KTTUserId,
            gdUserId: r.GDUserId,
        }));

        res.json(data);
    } catch (err) {
        httpError(res, err, "Lỗi lấy danh sách hóa đơn");
    }
});

/* =========================================================
   2. TẠO HÓA ĐƠN
   POST /invoice
========================================================= */
router.post("/invoice", async (req, res) => {
    try {
        const {
            ngayDangKy,
            congTyId,
            nguoiDangKyId,
            donViNguoiDangKyId,
            ghiChu
        } = req.body;

        const pool = await poolPromise;
        const rs = await pool.request()
            .input("NgayDangKy", sql.Date, ngayDangKy)
            .input("CongTyId", sql.Int, congTyId)
            .input("NguoiDangKyId", sql.Int, nguoiDangKyId)
            .input("DonViNguoiDangKyId", sql.Int, donViNguoiDangKyId)
            .input("GhiChu", sql.NVarChar(500), ghiChu || null)
            .output("NewId", sql.Int)
            .execute("INV_sp_HoaDon_Tao");

        const info = rs.recordset?.[0];

        // push cho TBP (y hệt sổ séc)
        if (info?.TBPUserId) {
            await sendPushToUsers(
                [info.TBPUserId],
                "Hóa đơn cần duyệt",
                `Hóa đơn ${info.MaHoaDon} cần TBP duyệt.`,
                { hoaDonId: info.HoaDonId }
            );
        }

        res.status(201).json({
            hoaDonId: info.HoaDonId,
            maHoaDon: info.MaHoaDon,
        });
    } catch (err) {
        httpError(res, err, "Lỗi tạo hóa đơn");
    }
});

/* =========================================================
   3. LƯU / TÍNH LẠI TỔNG TIỀN
   POST /invoice/:id/save
========================================================= */
router.post("/invoice/:id/save", async (req, res) => {
    try {
        const hoaDonId = Number(req.params.id);
        if (!hoaDonId) return res.status(400).json({ message: "Id không hợp lệ" });

        const pool = await poolPromise;
        const rs = await pool.request()
            .input("HoaDonId", sql.Int, hoaDonId)
            .execute("INV_sp_HoaDon_Luu");

        const r = rs.recordset?.[0];
        if (!r) return res.json(null);

        res.json({
            hoaDonId: r.HoaDonId,
            soTienTruocThue: r.SoTienTruocThue,
            tongVAT: r.TongVAT,
            tongThanhTien: r.TongThanhTien,
        });
    } catch (err) {
        httpError(res, err, "Lỗi lưu hóa đơn");
    }
});

/* =========================================================
   4. DANH SÁCH CHI TIẾT
   GET /invoice/:hoaDonId/items
========================================================= */
router.get("/invoice/:hoaDonId/items", async (req, res) => {
    try {
        const hoaDonId = Number(req.params.hoaDonId);

        const pool = await poolPromise;
        const rs = await pool.request()
            .input("HoaDonId", sql.Int, hoaDonId)
            .execute("INV_sp_HoaDonChiTiet_DanhSach");

        const data = rs.recordset.map(r => ({
            hoaDonChiTietId: r.HoaDonChiTietId,
            hoaDonId: r.HoaDonId,
            tenHangHoa: r.TenHangHoa,
            donViTinh: r.DonViTinh,
            soLuong: r.SoLuong,
            donGia: r.DonGia,
            vat: r.VAT,
            thanhTien: r.ThanhTien,
        }));

        res.json(data);
    } catch (err) {
        httpError(res, err, "Lỗi lấy chi tiết hóa đơn");
    }
});

/* =========================================================
   5. THÊM CHI TIẾT
========================================================= */
router.post("/invoice/:hoaDonId/items", async (req, res) => {
    try {
        const hoaDonId = Number(req.params.hoaDonId);
        const { tenHangHoa, donViTinh, soLuong, donGia, vat } = req.body;

        const pool = await poolPromise;
        await pool.request()
            .input("HoaDonId", sql.Int, hoaDonId)
            .input("TenHangHoa", sql.NVarChar(255), tenHangHoa)
            .input("DonViTinh", sql.NVarChar(50), donViTinh)
            .input("SoLuong", sql.Decimal(18, 3), soLuong)
            .input("DonGia", sql.Decimal(18, 2), donGia)
            .input("VAT", sql.Decimal(5, 2), vat)
            .execute("INV_sp_HoaDonChiTiet_Them");

        res.status(201).json({ success: true });
    } catch (err) {
        httpError(res, err, "Lỗi thêm chi tiết hóa đơn");
    }
});

/* =========================================================
   6. SỬA CHI TIẾT
========================================================= */
router.put("/invoice/items/:chiTietId", async (req, res) => {
    try {
        const chiTietId = Number(req.params.chiTietId);
        const { tenHangHoa, donViTinh, soLuong, donGia, vat } = req.body;

        const pool = await poolPromise;
        await pool.request()
            .input("HoaDonChiTietId", sql.Int, chiTietId)
            .input("TenHangHoa", sql.NVarChar(255), tenHangHoa)
            .input("DonViTinh", sql.NVarChar(50), donViTinh)
            .input("SoLuong", sql.Decimal(18, 3), soLuong)
            .input("DonGia", sql.Decimal(18, 2), donGia)
            .input("VAT", sql.Decimal(5, 2), vat)
            .execute("INV_sp_HoaDonChiTiet_Sua");

        res.json({ success: true });
    } catch (err) {
        httpError(res, err, "Lỗi sửa chi tiết hóa đơn");
    }
});

/* =========================================================
   7. XÓA CHI TIẾT
========================================================= */
router.delete("/invoice/items/:chiTietId", async (req, res) => {
    try {
        const chiTietId = Number(req.params.chiTietId);

        const pool = await poolPromise;
        await pool.request()
            .input("HoaDonChiTietId", sql.Int, chiTietId)
            .execute("INV_sp_HoaDonChiTiet_Xoa");

        res.json({ success: true });
    } catch (err) {
        httpError(res, err, "Lỗi xóa chi tiết hóa đơn");
    }
});

module.exports = router;
