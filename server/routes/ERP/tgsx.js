const express = require('express')
const router = express.Router()
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { poolPromise } = require('../../db');
const sql = require('mssql');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require("xlsx");

// upload vào memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const normalizeNVarchar = (v, maxLen) => {
    if (v === null || v === undefined) return null;

    const s = String(v)
        .replace(/\u0000/g, "")        // xoá NULL char
        .replace(/[\r\n\t]/g, " ")     // xoá control char
        .trim();

    if (s.length === 0) return null;   // ⛔ CỰC KỲ QUAN TRỌNG

    return s.slice(0, maxLen);
};
const parseExcelDate = (v) => {
    if (v === null || v === undefined) return null;

    // Trường hợp đã là Date
    if (v instanceof Date && !isNaN(v)) return v;

    // Excel date dạng number (rất hay)
    if (typeof v === "number") {
        // Excel epoch: 1899-12-30
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        return new Date(excelEpoch.getTime() + v * 86400000);
    }

    // String date
    const d = new Date(v);
    if (isNaN(d)) return null;

    return d;
};
/* ======================================================
   POST /api/tgsx/import-excel
====================================================== */
router.post("/import-excel", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "Chưa chọn file Excel" });
        }
        console.log(`Import file: ${req.file.originalname}, size: ${req.file.size} bytes`);
        /* ================== READ EXCEL ================== */
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });

        if (!workbook.Sheets["SAN_PHAM"] || !workbook.Sheets["DINH_MUC"]) {
            return res.status(400).json({
                message: "File Excel phải có sheet SAN_PHAM và DINH_MUC",
            });
        }

        const sanPhamRows = XLSX.utils.sheet_to_json(
            workbook.Sheets["SAN_PHAM"],
            { defval: null }
        );

        const dinhMucRows = XLSX.utils.sheet_to_json(
            workbook.Sheets["DINH_MUC"],
            { defval: null }
        );

        if (sanPhamRows.length === 0) {
            return res.status(400).json({ message: "Sheet SAN_PHAM rỗng" });
        }

        if (dinhMucRows.length === 0) {
            return res.status(400).json({ message: "Sheet DINH_MUC rỗng" });
        }

        /* ================== BASIC VALIDATE ================== */
        const sp = sanPhamRows[0];
        console.log(sp.ItemCode, typeof sp.ItemCode);
        if (!sp.ItemCode || !sp.TenSanPham || !sp.NgayApDung) {
            return res.status(400).json({
                message: "SAN_PHAM thiếu ItemCode / TenSanPham / NgayApDung",
            });
        }

        /* ================== CONNECT DB ================== */
        const pool = await poolPromise;

        /* ================== TVP: SAN_PHAM ================== */
        const tvSanPham = new sql.Table("TGSX_TV_SanPham");
        tvSanPham.columns.add("ItemCode", sql.NVarChar(50));
        tvSanPham.columns.add("TenSanPham", sql.NVarChar(255));
        tvSanPham.columns.add("NgayApDung", sql.Date);
        tvSanPham.columns.add("TrangThai", sql.Bit);
        tvSanPham.columns.add("GhiChu", sql.NVarChar(500));

        tvSanPham.rows.add(
            sp.ItemCode,
            sp.TenSanPham,
            parseExcelDate(sp.NgayApDung),
            sp.TrangThai === 1 || sp.TrangThai === true ? 1 : 0,
            sp.GhiChu || null
        );
        console.log(
            "ItemCode raw =", JSON.stringify(sp.ItemCode),
            "length =", sp.ItemCode?.length
        );
        /* ================== TVP: DINH_MUC ================== */
        const tvDinhMuc = new sql.Table("TGSX_TV_DinhMuc");

        tvDinhMuc.columns.add("RowNo", sql.Int);
        tvDinhMuc.columns.add("NhomCongDoan", sql.NVarChar(100));
        tvDinhMuc.columns.add("ThuTuNhom", sql.Int);
        tvDinhMuc.columns.add("TenNguyenCong", sql.NVarChar(255));
        tvDinhMuc.columns.add("ThuTuCongDoan", sql.Int);
        tvDinhMuc.columns.add("TG_DinhMuc_TH", sql.Decimal(10, 2));
        tvDinhMuc.columns.add("TG_DieuChinh", sql.Decimal(10, 2));
        for (let i = 1; i <= 11; i++) {
            tvDinhMuc.columns.add(`Tuan${i}`, sql.Decimal(10, 2));
        }
        tvDinhMuc.columns.add("GhiChu", sql.NVarChar(500));

        dinhMucRows.forEach((r, idx) => {
            if (!r.NhomCongDoan || !r.TenNguyenCong) {
                throw new Error(`Dòng ${idx + 2}: Thiếu NhomCongDoan / TenNguyenCong`);
            }

            tvDinhMuc.rows.add(
                r.RowNo,
                r.NhomCongDoan,
                r.ThuTuNhom,
                r.TenNguyenCong,
                r.ThuTuCongDoan,
                r.TG_DinhMuc_TH,
                r.TG_DieuChinh,
                r.Tuan1, r.Tuan2, r.Tuan3, r.Tuan4, r.Tuan5,
                r.Tuan6, r.Tuan7, r.Tuan8, r.Tuan9, r.Tuan10, r.Tuan11,
                r.GhiChu || null
            );
        });

        /* ================== EXEC STORED ================== */
        await pool
            .request()
            .input("SanPham", sql.TVP, tvSanPham)
            .input("DinhMuc", sql.TVP, tvDinhMuc)
            .execute("TGSX_ImportExcel_DinhMuc");

        res.json({
            success: true,
            message: "Import định mức thành công",
        });
    } catch (err) {
        console.error(err);

        // lỗi THROW 72xxx từ SQL
        if (err.number && String(err.number).startsWith("72")) {
            return res.status(400).json({
                success: false,
                message: err.message,
                code: err.number,
            });
        }

        res.status(500).json({
            success: false,
            message: err.message || "Import thất bại",
        });
    }
});

router.get("/sanpham/:id/export", async (req, res) => {
    try {
        const spId = Number(req.params.id);
        const pool = await poolPromise;

        const rs = await pool.request()
            .input("SanPhamId", sql.Int, spId)
            .execute("TGSX_GetSanPhamDetail");

        /* ========= RECORDSETS ========= */
        const sanPham = rs.recordsets[0]?.[0];
        const rows = rs.recordsets[1] || [];

        if (!sanPham) {
            return res.status(404).json({ message: "Không tìm thấy sản phẩm" });
        }

        /* ========= GROUP DATA ========= */
        const nhomMap = {};

        rows.forEach(r => {
            // group nhóm
            if (!nhomMap[r.NhomId]) {
                nhomMap[r.NhomId] = {
                    TenNhom: r.TenNhom,
                    ThuTuNhom: r.ThuTuNhom,
                    congDoanMap: {}
                };
            }

            const group = nhomMap[r.NhomId];

            // group công đoạn
            if (!group.congDoanMap[r.CongDoanId]) {
                group.congDoanMap[r.CongDoanId] = {
                    TenNguyenCong: r.TenCongDoan,
                    ThuTuCongDoan: r.ThuTuCongDoan,
                    TG_DinhMuc_TH: r.TG_DinhMuc_TH,
                    TG_DieuChinh: r.TG_DieuChinh,
                    HieuSuatTuan: {}
                };
            }

            // map tuần
            if (r.SoTuan != null) {
                group.congDoanMap[r.CongDoanId].HieuSuatTuan[r.SoTuan] = r.HieuSuat;
            }
        });

        /* ========= BUILD SHEET DINH_MUC ========= */
        const dmRows = [];

        Object.values(nhomMap)
            .sort((a, b) => a.ThuTuNhom - b.ThuTuNhom)
            .forEach(nhom => {
                Object.values(nhom.congDoanMap)
                    .sort((a, b) => a.ThuTuCongDoan - b.ThuTuCongDoan)
                    .forEach(cd => {
                        dmRows.push({
                            NhomCongDoan: nhom.TenNhom,
                            ThuTuNhom: nhom.ThuTuNhom,

                            TenNguyenCong: cd.TenNguyenCong,
                            ThuTuCongDoan: cd.ThuTuCongDoan,

                            TG_DinhMuc_TH: cd.TG_DinhMuc_TH,
                            TG_DieuChinh: cd.TG_DieuChinh,

                            Tuan1: cd.HieuSuatTuan[1] ?? null,
                            Tuan2: cd.HieuSuatTuan[2] ?? null,
                            Tuan3: cd.HieuSuatTuan[3] ?? null,
                            Tuan4: cd.HieuSuatTuan[4] ?? null,
                            Tuan5: cd.HieuSuatTuan[5] ?? null,
                            Tuan6: cd.HieuSuatTuan[6] ?? null,
                            Tuan7: cd.HieuSuatTuan[7] ?? null,
                            Tuan8: cd.HieuSuatTuan[8] ?? null,
                            Tuan9: cd.HieuSuatTuan[9] ?? null,
                            Tuan10: cd.HieuSuatTuan[10] ?? null,
                            Tuan11: cd.HieuSuatTuan[11] ?? null
                        });
                    });
            });

        /* ========= SHEET SAN_PHAM ========= */
        const spSheet = XLSX.utils.json_to_sheet([{
            ItemCode: sanPham.ItemCode,
            TenSanPham: sanPham.TenSanPham,
            NgayApDung: sanPham.NgayApDung,
            TrangThai: sanPham.TrangThai ? 1 : 0,
            GhiChu: sanPham.GhiChu
        }]);

        // ÉP ItemCode là STRING
        spSheet["A2"].t = "s";
        spSheet["A2"].z = "@"; // text format
        const dmSheet = XLSX.utils.json_to_sheet(dmRows);

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, spSheet, "SAN_PHAM");
        XLSX.utils.book_append_sheet(wb, dmSheet, "DINH_MUC");

        const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

        res.setHeader(
            "Content-Disposition",
            `attachment; filename=DINH_MUC_${sanPham.ItemCode}.xlsx`
        );
        res.send(buffer);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
});


router.post("/import-excel/preview", upload.single("file"), async (req, res) => {
    try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });

        const spSheet = workbook.Sheets["SAN_PHAM"];
        const dmSheet = workbook.Sheets["DINH_MUC"];

        if (!spSheet || !dmSheet) {
            return res.status(400).json({
                message: "Thiếu sheet SAN_PHAM hoặc DINH_MUC"
            });
        }

        const sanPham = XLSX.utils.sheet_to_json(spSheet, { defval: null })[0];
        const dinhMucRows = XLSX.utils.sheet_to_json(dmSheet, { defval: null });

        // group theo nhóm
        const nhomMap = {};
        dinhMucRows.forEach(r => {
            if (!nhomMap[r.NhomCongDoan]) {
                nhomMap[r.NhomCongDoan] = {
                    TenNhom: r.NhomCongDoan,
                    CongDoan: []
                };
            }

            nhomMap[r.NhomCongDoan].CongDoan.push({
                TenCongDoan: r.TenNguyenCong,
                TG_DinhMuc_TH: r.TG_DinhMuc_TH,
                TG_DieuChinh: r.TG_DieuChinh,
                HieuSuatTuan: {
                    1: r.Tuan1, 2: r.Tuan2, 3: r.Tuan3,
                    4: r.Tuan4, 5: r.Tuan5, 6: r.Tuan6,
                    7: r.Tuan7, 8: r.Tuan8, 9: r.Tuan9,
                    10: r.Tuan10, 11: r.Tuan11
                },
                GhiChu: r.GhiChu
            });
        });

        res.json({
            SanPham: sanPham,
            NhomCongDoan: Object.values(nhomMap)
        });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});
/* ========= Helpers ========= */
function httpError(res, err, fallback = "Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.") {
    console.error(err);
    const code = err?.number || err?.code;
    const msg = err?.originalError?.info?.message || err.message || fallback;
    // nếu THROW 72xxx từ proc => lỗi nghiệp vụ (400)
    const http = String(code || "").startsWith("72") ? 400 : 500;
    return res.status(http).json({ message: msg, code });
}

router.get("/sanpham", async (req, res) => {
    try {
        const pool = await poolPromise;

        const rs = await pool.request()
            .execute("TGSX_GetSanPhamList");

        res.json(rs.recordset);
    } catch (err) {
        return httpError(res, err, "Không lấy được danh sách sản phẩm.");
    }
});

router.get("/sanpham/:id", async (req, res) => {
    try {
        const sanPhamId = Number(req.params.id);
        if (!sanPhamId) return res.status(400).json({ message: "ID không hợp lệ" });

        const pool = await poolPromise;

        const rs = await pool.request()
            .input("SanPhamId", sql.Int, sanPhamId)
            .execute("TGSX_GetSanPhamDetail");

        const sanPham = rs.recordsets[0]?.[0];
        const rows = rs.recordsets[1] || [];

        if (!sanPham)
            return res.status(404).json({ message: "Không tìm thấy sản phẩm" });

        // Build JSON nhóm → công đoạn → hiệu suất
        const mapNhom = {};

        for (const r of rows) {
            if (!mapNhom[r.NhomId]) {
                mapNhom[r.NhomId] = {
                    NhomId: r.NhomId,
                    TenNhom: r.TenNhom,
                    ThuTuNhom: r.ThuTuNhom,
                    CongDoan: {}
                };
            }

            if (!mapNhom[r.NhomId].CongDoan[r.CongDoanId]) {
                mapNhom[r.NhomId].CongDoan[r.CongDoanId] = {
                    CongDoanId: r.CongDoanId,
                    TenCongDoan: r.TenCongDoan,
                    TG_DinhMuc_TH: r.TG_DinhMuc_TH,
                    TG_DieuChinh: r.TG_DieuChinh,
                    ThuTuCongDoan: r.ThuTuCongDoan,
                    HieuSuatTuan: {}
                };
            }

            if (r.SoTuan !== null)
                mapNhom[r.NhomId].CongDoan[r.CongDoanId].HieuSuatTuan[r.SoTuan] = r.HieuSuat;
        }

        const nhomArray = Object.values(mapNhom).map(n => ({
            ...n,
            CongDoan: Object.values(n.CongDoan)
        }));

        res.json({
            SanPham: sanPham,
            NhomCongDoan: nhomArray
        });

    } catch (err) {
        return httpError(res, err, "Không lấy được chi tiết sản phẩm.");
    }
});

router.get("/table-data", async (req, res) => {
    try {
        const { maDonHang, tenDonVi } = req.query;

        const pool = await poolPromise;

        const request = pool.request();

        request.input(
            "Ma_DonHang",
            sql.NVarChar(50),
            maDonHang ? maDonHang.trim() : null
        );

        request.input(
            "Ten_DonVi",
            sql.NVarChar(255),
            tenDonVi ? tenDonVi.trim() : null
        );

        const rs = await request.execute("sp_TGSX_TableData");

        res.json({
            success: true,
            total: rs.recordset.length,
            data: rs.recordset
        });
    } catch (err) {
        return httpError(
            res,
            err,
            "Không lấy được dữ liệu thời gian sản xuất."
        );
    }
});

module.exports = router;
