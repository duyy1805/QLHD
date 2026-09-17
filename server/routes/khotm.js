const express = require("express");
const router = express.Router();
const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { verifyToken, verifyAdmin } = require("../middleware/auth");
const { tagpoolPromise } = require("../db2");
// const { tagpoolPromise } = require('../dbtest');
const sql = require("mssql");

// Chi cap nhat QRCode. ID_ViTriKho duoc khoa va giu nguyen trong suot giao dich.
const updateBtpPackageQrOnly = async (pool, idPackage, qrCode) => {
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const result = await new sql.Request(transaction)
      .input("ID_TheKhoKienBTP_QROnly", sql.Int, idPackage)
      .input("QRCode_QROnly", sql.NVarChar(100), qrCode).query(`
                DECLARE @CurrentLocationId int;
                DECLARE @PackageExists bit = 0;

                SELECT
                    @PackageExists = 1,
                    @CurrentLocationId = ID_ViTriKho
                FROM dbo.TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK)
                WHERE ID_TheKhoKienBTP = @ID_TheKhoKienBTP_QROnly
                  AND TonTai = 1;

                IF @PackageExists = 0
                BEGIN
                    SELECT -2 AS StatusCode, N'Không tìm thấy kiện' AS Message;
                END
                ELSE IF EXISTS
                (
                    SELECT 1
                    FROM dbo.TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK)
                    WHERE QRCode = @QRCode_QROnly
                      AND ID_TheKhoKienBTP <> @ID_TheKhoKienBTP_QROnly
                      AND TonTai = 1
                )
                BEGIN
                    SELECT -3 AS StatusCode, N'QRCode đã tồn tại ở kiện khác' AS Message;
                END
                ELSE
                BEGIN
                    UPDATE dbo.TheKhoKienBTP
                    SET QRCode = @QRCode_QROnly
                    WHERE ID_TheKhoKienBTP = @ID_TheKhoKienBTP_QROnly
                      AND TonTai = 1;

                    SELECT
                        1 AS StatusCode,
                        N'Cập nhật QR thành công' AS Message,
                        @CurrentLocationId AS ID_ViTriKho;
                END;
            `);
    await transaction.commit();
    return result.recordset?.[0];
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

router.post("/getthongtinkien", async (req, res) => {
  try {
    const { QRCode } = req.body || {};
    if (!QRCode || typeof QRCode !== "string" || !QRCode.trim()) {
      return res
        .status(400)
        .json({ ok: false, message: "Thiếu hoặc sai QRCode" });
    }

    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("QRCode", sql.NVarChar(100), QRCode.trim())
      .execute("sp_GetThongTinTheoQRCode");
    const recordset = result.recordset || [];
    if (recordset.length === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Không tìm thấy thông tin kiện" });
    }
    return res.json({ ok: true, data: recordset });
  } catch (err) {
    console.error("getthongtinkien SP error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Lỗi máy chủ", detail: err?.message });
  }
});

router.post("/updateqrcodekien", async (req, res) => {
  try {
    const { ID_TheKhoKienBTP, QRCode } = req.body || {};

    if (!ID_TheKhoKienBTP || !QRCode || typeof QRCode !== "string") {
      return res.status(400).json({
        ok: false,
        message: "Thiếu hoặc sai dữ liệu",
      });
    }

    const pool = await tagpoolPromise;

    const response = await updateBtpPackageQrOnly(
      pool,
      Number(ID_TheKhoKienBTP),
      QRCode.trim(),
    );

    if (!response) {
      return res.status(500).json({
        ok: false,
        message: "Không nhận được phản hồi từ database",
      });
    }

    if (response.StatusCode !== 1) {
      return res.status(400).json({
        ok: false,
        message: response.Message,
      });
    }

    return res.json({
      ok: true,
      message: response.Message,
      idViTriKho: response.ID_ViTriKho ?? null,
      locationChanged: false,
    });
  } catch (err) {
    console.error("updateqrcodekien error:", err);
    return res.status(500).json({
      ok: false,
      message: "Lỗi máy chủ",
      detail: err?.message,
    });
  }
});

router.post(
  "/find-by-qr",
  /* verifyToken, */ async (req, res) => {
    try {
      const { qrcode, startDate, endDate } = req.body || {};
      if (!qrcode || typeof qrcode !== "string" || !qrcode.trim()) {
        return res
          .status(400)
          .json({ ok: false, message: "Thiếu hoặc sai QRCode" });
      }

      const pool = await tagpoolPromise;

      // GỌI STORED PROCEDURE
      const result = await pool
        .request()
        .input("QRCode", sql.NVarChar(100), qrcode.trim())
        .input("StartDate", sql.Date, startDate || null)
        .input("EndDate", sql.Date, endDate || null)
        .execute("sp_KhoTM_PXK_FindByQRCode");

      // recordsets: [KQ1, KQ2, KQ3, KQ4]
      const headerKien = result.recordsets?.[0]?.[0] || null; // 1 kiện mới nhất
      const chiTietKien = result.recordsets?.[1] || [];
      const phieuPicked = result.recordsets?.[2] || []; // phiếu đã pick
      const phieuSuggest = result.recordsets?.[3] || []; // phiếu gợi ý thêm

      // ---- OPTIONAL: gộp phiếu → pick để UI dễ hiển thị ----
      const groupedPicked = phieuPicked.reduce((acc, p) => {
        let grp = acc.find((x) => x.ID_PhieuXuatBTP === p.ID_PhieuXuatBTP);
        if (!grp) {
          grp = {
            ID_PhieuXuatBTP: p.ID_PhieuXuatBTP,
            So_PhieuXuatBTP: p.So_PhieuXuatBTP,
            Ngay_XuatBTP: p.Ngay_XuatBTP,
            TrangThai: p.TrangThai,
            details: [],
          };
          acc.push(grp);
        }
        grp.details.push(p);
        return acc;
      }, []);

      const groupedSuggest = phieuSuggest.reduce((acc, p) => {
        let grp = acc.find((x) => x.ID_PhieuXuatBTP === p.ID_PhieuXuatBTP);
        if (!grp) {
          grp = {
            ID_PhieuXuatBTP: p.ID_PhieuXuatBTP,
            So_PhieuXuatBTP: p.So_PhieuXuatBTP,
            Ngay_XuatBTP: p.Ngay_XuatBTP,
            TrangThai: p.TrangThai,
            details: [],
          };
          acc.push(grp);
        }
        grp.details.push(p);
        return acc;
      }, []);

      return res.json({
        ok: true,
        data: {
          kien: headerKien,
          chiTietKien,
          phieuPicked,
          phieuSuggest,
          groupedPicked,
          groupedSuggest,
        },
      });
    } catch (err) {
      console.error("find-by-qr SP error:", err);
      return res
        .status(500)
        .json({ ok: false, message: "Lỗi máy chủ", detail: err?.message });
    }
  },
);

router.post("/phieu-detail", async (req, res) => {
  try {
    const { idPhieuXuat } = req.body || {};
    if (!idPhieuXuat) {
      return res
        .status(400)
        .json({ ok: false, message: "Thiếu ID_PhieuXuatBTP" });
    }

    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("ID_PhieuXuatBTP", sql.Int, idPhieuXuat)
      .execute("sp_KhoTM_PXK_GetDetailByPhieu");

    const details = result.recordset || [];

    return res.json({
      ok: true,
      data: details,
    });
  } catch (err) {
    console.error("phieu-detail SP error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Lỗi máy chủ", detail: err?.message });
  }
});

router.post("/insert-pick", async (req, res) => {
  try {
    const { idPhieuXuat, qrcode } = req.body || {};
    if (!idPhieuXuat || !qrcode) {
      return res
        .status(400)
        .json({ ok: false, message: "Thiếu tham số idPhieuXuat hoặc qrcode" });
    }

    const pool = await tagpoolPromise;

    const result = await pool
      .request()
      .input("ID_PhieuXuatBTP", sql.Int, idPhieuXuat)
      .input("QRCode", sql.NVarChar(100), qrcode)
      .execute("sp_KhoTM_InsertPick");

    const recordset = result.recordset || [];

    if (recordset.length > 0 && recordset[0].Inserted === 1) {
      return res.json({
        ok: true,
        message: recordset[0].Reason,
        data: recordset,
      });
    } else {
      return res.json({
        ok: false,
        message: recordset[0]?.Reason || "Không insert được",
        data: recordset,
      });
    }
  } catch (err) {
    console.error("insert-pick SP error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Lỗi máy chủ", detail: err?.message });
  }
});

router.post("/phieu-line-remaining", async (req, res) => {
  try {
    const { idPhieuXuat } = req.body || {};
    if (!idPhieuXuat) {
      return res.status(400).json({ ok: false, message: "Thiếu tham số" });
    }

    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("ID_PhieuXuatBTP", sql.Int, idPhieuXuat).query(`
        ;WITH pick AS (
          SELECT ISNULL(SUM(SoLuong_XuatKho),0) AS DaPick
          FROM PhieuXuatBTP_ChiTiet_TheKhoKien
          WHERE ID_PhieuXuatBTP = @ID_PhieuXuatBTP
        )
        SELECT TOP 1
          pxc.SoLuong_XuatKho AS SoLuongYeuCau,
          (SELECT DaPick FROM pick) AS DaPick,
          (pxc.SoLuong_XuatKho - (SELECT DaPick FROM pick)) AS ConLaiPhieu
        FROM PhieuXuatBTP_ChiTiet pxc
        WHERE pxc.ID_PhieuXuatBTP = @ID_PhieuXuatBTP
      `);

    const row = result.recordset?.[0];
    if (!row)
      return res.json({ ok: false, message: "Không tìm thấy dòng phiếu" });

    return res.json({
      ok: true,
      soLuongYeuCau: Number(row.SoLuongYeuCau || 0),
      daPick: Number(row.DaPick || 0),
      conLaiPhieu: Math.max(0, Number(row.ConLaiPhieu || 0)),
    });
  } catch (err) {
    console.error("phieu-line-remaining error:", err);
    res
      .status(500)
      .json({ ok: false, message: "Lỗi máy chủ", detail: err?.message });
  }
});

router.post("/merge-kien", async (req, res) => {
  try {
    const { targetPackageId, detailIds } = req.body || {};

    // Validate input
    if (
      !targetPackageId ||
      !Array.isArray(detailIds) ||
      detailIds.length === 0
    ) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu targetPackageId hoặc detailIds",
      });
    }

    // Chuẩn hoá mảng id (toàn số nguyên dương)
    const ids = detailIds
      .map((x) => parseInt(x, 10))
      .filter((x) => Number.isInteger(x) && x > 0);

    if (ids.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "detailIds không hợp lệ" });
    }

    const idsIn = ids.join(","); // ví dụ: "1,2,3"
    const pool = await tagpoolPromise;

    const result = await pool
      .request()
      .input("TargetId", sql.Int, parseInt(targetPackageId, 10)).query(`
        SET NOCOUNT ON;
        SET XACT_ABORT ON;

        BEGIN TRY
            BEGIN TRAN;

            DECLARE @updated INT = 0;
            DECLARE @deactivated INT = 0;

            -- Discover owners, then lock every package in deterministic order.
            DECLARE @Owners TABLE (DetailId int PRIMARY KEY, PackageId int NOT NULL);
            INSERT @Owners
            SELECT ID_TheKhoKienBTP_ChiTiet, ID_TheKhoKienBTP
            FROM dbo.TheKhoKienBTP_ChiTiet
            WHERE ID_TheKhoKienBTP_ChiTiet IN (${idsIn});
            IF (SELECT COUNT(*) FROM @Owners) <> ${new Set(ids).size}
                THROW 51045, N'Chi tiết kiện không còn tồn tại, vui lòng tải lại', 1;
            DECLARE @LockId int, @LockedId int;
            DECLARE PackageLocks CURSOR LOCAL FAST_FORWARD FOR
                SELECT PackageId FROM @Owners UNION SELECT @TargetId ORDER BY PackageId;
            OPEN PackageLocks;
            FETCH NEXT FROM PackageLocks INTO @LockId;
            WHILE @@FETCH_STATUS = 0
            BEGIN
                SET @LockedId = NULL;
                SELECT @LockedId = ID_TheKhoKienBTP
                FROM dbo.TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK)
                WHERE ID_TheKhoKienBTP = @LockId AND ISNULL(TonTai, 1) = 1;
                IF @LockedId IS NULL THROW 51045, N'Kiện gộp không còn hiệu lực', 1;
                FETCH NEXT FROM PackageLocks INTO @LockId;
            END;
            CLOSE PackageLocks;
            DEALLOCATE PackageLocks;
            IF EXISTS (
                SELECT 1 FROM @Owners o
                LEFT JOIN dbo.TheKhoKienBTP_ChiTiet d WITH (UPDLOCK, HOLDLOCK)
                  ON d.ID_TheKhoKienBTP_ChiTiet = o.DetailId
                WHERE d.ID_TheKhoKienBTP_ChiTiet IS NULL OR d.ID_TheKhoKienBTP <> o.PackageId
            ) THROW 51045, N'Chi tiết kiện đã thay đổi, vui lòng tải lại', 1;

            -- 1) Ghi lại các kiện nguồn (khác Target) chứa các chi tiết sẽ chuyển
            DECLARE @Src TABLE (Id INT PRIMARY KEY);
            INSERT INTO @Src (Id)
            SELECT DISTINCT d.ID_TheKhoKienBTP
            FROM TheKhoKienBTP_ChiTiet AS d
            WHERE d.ID_TheKhoKienBTP_ChiTiet IN (${idsIn})
              AND d.ID_TheKhoKienBTP <> @TargetId;

            -- 2) Merge: chuyển các chi tiết sang kiện đích
            UPDATE d
            SET d.ID_TheKhoKienBTP = @TargetId
            FROM TheKhoKienBTP_ChiTiet AS d
            WHERE d.ID_TheKhoKienBTP_ChiTiet IN (${idsIn})
              AND d.ID_TheKhoKienBTP <> @TargetId;

            SET @updated = @@ROWCOUNT;

            -- 3) Đánh dấu TonTai = 0 cho các kiện nguồn đã rỗng (soft delete)
            ;WITH EmptySrc AS (
              SELECT p.ID_TheKhoKienBTP
              FROM TheKhoKienBTP p
              WHERE p.ID_TheKhoKienBTP IN (SELECT Id FROM @Src)
                AND NOT EXISTS (
                    SELECT 1
                    FROM TheKhoKienBTP_ChiTiet c
                    WHERE c.ID_TheKhoKienBTP = p.ID_TheKhoKienBTP
                )
            )
            UPDATE p
            SET p.TonTai = 0, p.QRCode = null
            FROM TheKhoKienBTP p
            JOIN EmptySrc e ON e.ID_TheKhoKienBTP = p.ID_TheKhoKienBTP
            WHERE ISNULL(p.TonTai, 1) <> 0;  -- chỉ cập nhật khi khác 0

            SET @deactivated = @@ROWCOUNT;

            COMMIT;

            -- Giữ 'deletedPackages' làm alias để tương thích nếu client có dùng
            SELECT
              @updated     AS updated,
              @deactivated AS deactivatedPackages,
              @deactivated AS deletedPackages;
        END TRY
        BEGIN CATCH
            IF XACT_STATE() <> 0 ROLLBACK;
            THROW;
        END CATCH
      `);

    const row = result.recordset?.[0] || {};
    return res.json({
      ok: true,
      updated: row.updated ?? 0,
      deactivatedPackages: row.deactivatedPackages ?? 0,
      deletedPackages: row.deletedPackages ?? 0,
    });
  } catch (err) {
    console.error("merge-kien error:", err);
    return res
      .status(err.number === 51045 || err.number === 1205 ? 409 : 500)
      .json({
        ok: false,
        message: "Lỗi máy chủ",
        detail: err?.message,
      });
  }
});

router.post("/split-kien", async (req, res) => {
  try {
    const {
      sourcePackageId,
      phieuNhapId,
      qrCode,
      viTriKhoId,
      tonTai,
      chiTiet,
    } = req.body || {};

    if (
      !sourcePackageId ||
      !qrCode ||
      !viTriKhoId ||
      !Array.isArray(chiTiet) ||
      chiTiet.length === 0
    ) {
      return res
        .status(400)
        .json({ ok: false, message: "Thiếu dữ liệu tạo kiện" });
    }

    const pool = await tagpoolPromise;
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const src = await new sql.Request(tx).input(
        "SourceId",
        sql.Int,
        sourcePackageId,
      ).query(`
                    SELECT ID_TheKhoKienBTP
                    FROM TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK)
                    WHERE ID_TheKhoKienBTP = @SourceId
                `);

      if (src.recordset.length === 0) {
        throw new Error("Không tìm thấy kiện gốc");
      }

      // A) CHECK QR CODE TỒN TẠI (chỉ tính bản ghi còn hiệu lực)
      const dup = await new sql.Request(tx).input(
        "QRCode",
        sql.NVarChar(100),
        qrCode,
      ).query(`
          SELECT TOP 1 ID_TheKhoKienBTP
          FROM TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK)
          WHERE QRCode = @QRCode
        `);

      if (dup.recordset.length > 0) {
        await tx.rollback();
        return res
          .status(409)
          .json({ ok: false, message: "QRCode đã tồn tại, không thể tạo mới" });
      }

      // 1) Tạo kiện mới
      const rNew = await new sql.Request(tx)
        .input("PhieuNhapId", sql.Int, phieuNhapId || null)
        .input("QRCode", sql.NVarChar(100), qrCode)
        .input("ViTriKhoId", sql.Int, viTriKhoId)
        .input("TonTai", sql.Bit, tonTai ?? 1).query(`
          INSERT INTO TheKhoKienBTP (ID_PhieuNhapBTP, QRCode, ID_ViTriKho, TonTai, ID_TheKhoKienBTP_Xuat, ID_PhieuXuatBTP, SoKien)
          VALUES (@PhieuNhapId, @QRCode, @ViTriKhoId, @TonTai, NULL, NULL, NULL);
          SELECT CAST(SCOPE_IDENTITY() AS INT) AS NewKienId;
        `);

      const newKienId = rNew.recordset?.[0]?.NewKienId;

      // 2) Với từng chi tiết: insert vào kiện mới + giảm đúng dòng ở kiện gốc
      for (const ct of chiTiet) {
        const soLuongTach = Number(ct.SoLuong || 0);
        if (!soLuongTach || soLuongTach <= 0) continue;

        const sourceDetailRequest = new sql.Request(tx).input(
          "SourceId",
          sql.Int,
          sourcePackageId,
        );
        let sourceDetail;
        if (ct.ID_TheKhoKienBTP_ChiTiet) {
          sourceDetail = await sourceDetailRequest.input(
            "DetailId",
            sql.Int,
            ct.ID_TheKhoKienBTP_ChiTiet,
          ).query(`
              SELECT TOP (1) DauTuan
              FROM TheKhoKienBTP_ChiTiet WITH (UPDLOCK, HOLDLOCK)
              WHERE ID_TheKhoKienBTP = @SourceId
                AND ID_TheKhoKienBTP_ChiTiet = @DetailId;
            `);
        } else {
          sourceDetail = await sourceDetailRequest
            .input("DonHangSanPhamId", sql.Int, ct.ID_DonHang_SanPham)
            .input("SoLuong", sql.Decimal(18, 2), soLuongTach).query(`
              SELECT TOP (1) DauTuan
              FROM TheKhoKienBTP_ChiTiet WITH (UPDLOCK, HOLDLOCK)
              WHERE ID_TheKhoKienBTP = @SourceId
                AND ID_DonHang_SanPham = @DonHangSanPhamId
                AND SoLuong >= @SoLuong
              ORDER BY ID_TheKhoKienBTP_ChiTiet DESC;
            `);
        }
        if (!sourceDetail.recordset?.length) {
          throw new Error(
            `Không tìm thấy chi tiết kiện nguồn cho ID_DonHang_SanPham=${ct.ID_DonHang_SanPham}`,
          );
        }
        const dauTuanFromSourceDetail =
          sourceDetail.recordset[0].DauTuan || null;

        // 2a) Insert chi tiết kiện mới
        await new sql.Request(tx)
          .input("NewKienId", sql.Int, newKienId)
          .input("DonHangSanPhamId", sql.Int, ct.ID_DonHang_SanPham || null)
          .input("SoLuong", sql.Int, soLuongTach)
          .input("ItemCode", sql.NVarChar(50), ct.ItemCode || null)
          .input("TenSanPham", sql.NVarChar(200), ct.Ten_SanPham || null)
          .input("TonTai", sql.Bit, 1)
          .input("ID_DonHang", sql.Int, ct.ID_DonHang || null)
          .input("ID_QuyTrinhSanXuat", sql.Int, ct.ID_QuyTrinhSanXuat || null)
          .input(
            "Ten_QuyTrinhSanXuat",
            sql.NVarChar(200),
            ct.Ten_QuyTrinhSanXuat || null,
          )
          .input("ID_DonHang_LoSanXuat", sql.Int, ct.ID_DonHang_LoSanXuat || 0)
          .input("ID_KeHoachSanXuat", sql.Int, ct.ID_KeHoachSanXuat || 0)
          .input("ID_PhieuNhapBTP", sql.Int, phieuNhapId || null)
          .input("DauTuan", sql.NVarChar(50), dauTuanFromSourceDetail).query(`
            INSERT INTO TheKhoKienBTP_ChiTiet
              (ID_TheKhoKienBTP, ID_DonHang_SanPham, SoLuong, ItemCode, Ten_SanPham, TonTai, ID_DonHang, ID_QuyTrinhSanXuat, Ten_QuyTrinhSanXuat, ID_KeHoachSanXuat, ID_PhieuNhapBTP, ID_DonHang_LoSanXuat, DauTuan)
            VALUES
              (@NewKienId, @DonHangSanPhamId, @SoLuong, @ItemCode, @TenSanPham, @TonTai, @ID_DonHang, @ID_QuyTrinhSanXuat, @Ten_QuyTrinhSanXuat, @ID_KeHoachSanXuat, @ID_PhieuNhapBTP, @ID_DonHang_LoSanXuat, @DauTuan);
          `);

        // 2b) Trừ đúng dòng chi tiết ở kiện gốc
        const reqUpdate = new sql.Request(tx)
          .input("SourceId", sql.Int, sourcePackageId)
          .input("SoLuong", sql.Int, soLuongTach);

        let updateSql, rUpd;
        if (ct.ID_TheKhoKienBTP_ChiTiet) {
          // ưu tiên theo ID chi tiết
          rUpd = await reqUpdate.input(
            "DetailId",
            sql.Int,
            ct.ID_TheKhoKienBTP_ChiTiet,
          ).query(`
              UPDATE TheKhoKienBTP_ChiTiet WITH (ROWLOCK, UPDLOCK)
              SET SoLuong = SoLuong - @SoLuong
              WHERE ID_TheKhoKienBTP = @SourceId
                AND ID_TheKhoKienBTP_ChiTiet = @DetailId
                AND SoLuong >= @SoLuong;
              SELECT @@ROWCOUNT AS affected;
            `);
        } else {
          // fallback (kém an toàn): theo ID_DonHang_SanPham, trừ 1 dòng gần nhất
          rUpd = await reqUpdate.input(
            "DonHangSanPhamId",
            sql.Int,
            ct.ID_DonHang_SanPham,
          ).query(`
              ;WITH cte AS (
                SELECT TOP (1) *
                FROM TheKhoKienBTP_ChiTiet WITH (ROWLOCK, UPDLOCK)
                WHERE ID_TheKhoKienBTP = @SourceId
                  AND ID_DonHang_SanPham = @DonHangSanPhamId
                  AND SoLuong >= @SoLuong
                ORDER BY ID_TheKhoKienBTP_ChiTiet DESC
              )
              UPDATE cte SET SoLuong = SoLuong - @SoLuong;
              SELECT @@ROWCOUNT AS affected;
            `);
        }

        const affected = rUpd.recordset?.[0]?.affected || 0;
        if (affected === 0) {
          throw new Error(
            `Không thể trừ số lượng (thiếu dòng/không đủ tồn) cho ID_DonHang_SanPham=${ct.ID_DonHang_SanPham}`,
          );
        }
      }

      await tx.commit();
      return res.json({ ok: true, newKienId, inserted: chiTiet.length });
    } catch (e) {
      await tx.rollback();
      console.error("split-kien error:", e);
      return res
        .status(500)
        .json({ ok: false, message: "Lỗi máy chủ", detail: e.message });
    }
  } catch (err) {
    console.error("split-kien error OUTER:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Lỗi máy chủ", detail: err?.message });
  }
});

// API kho BTP chạy trực tiếp trên Node, thay thế Z76_ERP.
const toIntOrNull = (value) => {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const normalizeDauTuan = (value) => {
  const normalized = String(value ?? "").trim();
  if (normalized.length > 50) throw new Error("Dấu tuần tối đa 50 ký tự");
  return normalized || null;
};

const mapImportSearchRow = (row) => ({
  ...row,
  id: row.Id,
  soPhieu: row.SoPhieu,
  ngayNhap: row.NgayNhap,
  idKhoNhap: row.ID_KhoNhap,
  khoNhap: row.KhoNhap,
  idHinhThucNhapBTP: row.ID_HinhThucNhapBTP,
  loaiPhieu: row.LoaiPhieu,
  trangThai: Boolean(row.TrangThai),
  khachHang: row.KhachHang,
  maDonHang: row.MaDonHang,
});

const mapExportSearchRow = (row) => ({
  ...row,
  id: row.Id,
  soPhieu: row.SoPhieu,
  ngayXuat: row.NgayXuat,
  idKhoXuat: row.ID_KhoXuat,
  khoXuat: row.KhoXuat,
  idHinhThucXuatBTP: row.ID_HinhThucXuatBTP,
  loaiPhieu: row.LoaiPhieu,
  trangThai: Boolean(row.TrangThai),
  khachHang: row.KhachHang,
  maDonHang: row.MaDonHang,
});

const groupQuantity = (items, keys, quantityKey) => {
  const grouped = new Map();
  items.forEach((item) => {
    const key = keys.map((name) => toIntOrNull(item[name]) || 0).join("|");
    grouped.set(key, (grouped.get(key) || 0) + toNumber(item[quantityKey]));
  });
  return grouped;
};

const quantitiesFit = (
  allowedRows,
  requestedRows,
  keys,
  allowedQuantityKey,
  requestedQuantityKey,
) => {
  const allowed = groupQuantity(allowedRows, keys, allowedQuantityKey);
  const requested = groupQuantity(requestedRows, keys, requestedQuantityKey);
  if (allowed.size !== requested.size) return false;
  return [...requested.entries()].every(
    ([key, quantity]) =>
      quantity >= 0 && allowed.has(key) && quantity <= allowed.get(key),
  );
};

// Du lieu BTP cu co the luu 0 cho lo/san pham trong khi dong ERP co ID day du.
// Gia tri 0 duoc xem la "khong xac dinh"; van tru so luong khoi tung dong ERP
// de khong cho phep cung mot han muc bi tinh lap lai cho nhieu dong kien.
const importQuantitiesFit = (
  allowedRows,
  requestedRows,
  keys,
  allowedQuantityKey,
  requestedQuantityKey,
) => {
  const requested = [
    ...groupQuantity(requestedRows, keys, requestedQuantityKey).entries(),
  ]
    .map(([key, quantity]) => ({
      values: key.split("|").map(Number),
      quantity,
    }))
    .sort(
      (left, right) =>
        right.values.filter(Boolean).length -
        left.values.filter(Boolean).length,
    );
  const allowed = allowedRows.map((row) => ({
    values: keys.map((name) => toIntOrNull(row[name]) || 0),
    remaining: toNumber(row[allowedQuantityKey]),
  }));

  for (const item of requested) {
    if (item.quantity < 0) return false;
    const candidates = allowed.filter((limit) =>
      item.values.every(
        (value, index) =>
          value === 0 ||
          limit.values[index] === 0 ||
          value === limit.values[index],
      ),
    );
    if (
      candidates.reduce((sum, limit) => sum + limit.remaining, 0) <
      item.quantity
    )
      return false;

    let quantityLeft = item.quantity;
    for (const limit of candidates) {
      const used = Math.min(limit.remaining, quantityLeft);
      limit.remaining -= used;
      quantityLeft -= used;
      if (quantityLeft <= 0) break;
    }
  }
  return true;
};

const importDetailResponse = (recordsets = []) => {
  const header = recordsets[0]?.[0] || {};
  const materials = recordsets[1] || [];
  const packageHeaders = recordsets[2] || [];
  const packageDetails = (recordsets[3] || []).filter((row) => row.TonTai == null || Number(row.TonTai) !== 0);
  return {
    id: header.ID_PhieuNhapBTP,
    soPhieu: header.So_PhieuNhapBTP,
    loaiPhieu: header.Ten_HinhThucNhapBTP,
    khoNhap: header.Ten_Kho,
    trangThai: Boolean(header.QrStatus),
    ngayNhap: header.Ngay_NhapBTP,
    chiTiets: materials.map((row) => ({
      ...row,
      idKeHoachSanXuat: row.ID_KeHoachSanXuat,
      idDonHangLoSanXuat: row.ID_DonHang_LoSanXuat,
      soLoSanXuat: row.So_LoSanXuat,
      idDonHangSanPham: row.ID_DonHang_SanPham,
      itemCode: row.ItemCode,
      soLuong: row.SoLuong_NhapKho,
      idDonHang: row.ID_DonHang,
      maDonHang: row.Ma_DonHang,
      tenSanPham: row.Ten_SanPham,
      idQuyTrinhSanXuat: row.ID_QuyTrinhSanXuat,
      ten_QuyTrinhSanXuat: row.Ten_QuyTrinhSanXuat,
    })),
    kiens: packageHeaders.map((row) => ({
      ...row,
      idTheKhoKienBTP: row.ID_TheKhoKienBTP,
      idViTriKho: row.ID_ViTriKho,
      maViTriKho: row.MaViTriKho,
      qrCode: row.QrCode ?? row.QRCode,
      soLuongTon: toNumber(row.SoLuongTon),
      bTPs: packageDetails
        .filter(
          (detail) =>
            Number(detail.ID_TheKhoKienBTP) === Number(row.ID_TheKhoKienBTP),
        )
        .map((detail) => ({
          ...detail,
          idTheKhoKienBTPChiTiet: detail.ID_TheKhoKienBTP_ChiTiet,
          idTheKhoKienBTP: detail.ID_TheKhoKienBTP,
          soLuongTon: toNumber(detail.SoLuongTon),
          itemCode: detail.ItemCode,
          tenSanPham: detail.Ten_SanPham,
          idKeHoachSanXuat: detail.ID_KeHoachSanXuat,
          idDonHangLoSanXuat: detail.ID_DonHang_LoSanXuat,
          soLoSanXuat: detail.So_LoSanXuat,
          idDonHangSanPham: detail.ID_DonHang_SanPham,
          idQuyTrinhSanXuat: detail.ID_QuyTrinhSanXuat,
          ten_QuyTrinhSanXuat: detail.Ten_QuyTrinhSanXuat,
          idDonHang: detail.ID_DonHang,
          maDonHang: detail.Ma_DonHang,
          tuoiTon: detail.TuoiTon,
          dauTuan: detail.DauTuan,
        })),
    })),
  };
};

const ensureImportEditable = async (request, idPhieuNhap) => {
  const result = await request
    .input("ID_PhieuNhapBTP_Edit", sql.Int, idPhieuNhap)
    .query(
      `SELECT TOP (1) QrStatus FROM PhieuNhapBTP WHERE ID_PhieuNhapBTP = @ID_PhieuNhapBTP_Edit AND TonTai = 1;`,
    );
  if (!result.recordset?.length)
    throw new Error("Không tìm thấy phiếu nhập BTP");
  if (result.recordset[0].QrStatus)
    throw new Error("Phiếu nhập BTP đã xác nhận, không thể cập nhật");
};

router.get("/btp/phieunhap/types", async (_req, res) => {
  try {
    const pool = await tagpoolPromise;
    const result = await pool.request().query(`
            SELECT ID_HinhThucNhapBTP AS idHinhThucNhapBTP, Ten_HinhThucNhapBTP AS loaiPhieu
            FROM DM_HinhThucNhapBTP;
        `);
    res.json(result.recordset || []);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Không tải được loại phiếu nhập BTP",
        detail: error.message,
      });
  }
});

router.get("/btp/phieunhap/khos", async (_req, res) => {
  try {
    const pool = await tagpoolPromise;
    const result = await pool.request().query(`
            SELECT ID_Kho AS idKhoBTP, Ten_Kho AS khoNhap FROM DM_Kho WHERE LoaiKho = N'BTP';
        `);
    res.json(result.recordset || []);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Không tải được kho BTP", detail: error.message });
  }
});

router.post("/btp/phieunhap/tim-kiem", async (req, res) => {
  try {
    const body = req.body || {};
    const pageSize = Math.min(
      100,
      Math.max(1, Number(body.PageSize || body.pageSize || 20)),
    );
    const pageIndex = Math.max(
      0,
      Number(body.PageIndex || body.pageIndex || 0),
    );
    const warehouseIds = (Array.isArray(body.idKho) ? body.idKho : [])
      .map(Number)
      .filter(Number.isInteger)
      .join(",");
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("WarehouseId", sql.NVarChar(200), warehouseIds)
      .input("Status", sql.Bit, body.trangThai ?? null)
      .input(
        "ReviewNumber",
        sql.NVarChar(255),
        String(body.soPhieu || "").trim(),
      )
      .input("Type", sql.Int, toIntOrNull(body.loaiPhieu))
      .input("Take", sql.Int, pageSize)
      .input("Skip", sql.Int, pageIndex * pageSize)
      .input(
        "ID_TaiKhoanDangNhap",
        sql.Int,
        toIntOrNull(body.IdTaiKhoanDangNhap) || 0,
      )
      .query(
        `SELECT * FROM dbo.SearchPhieuNhapBTP(@WarehouseId, @Status, @ReviewNumber, @Type, @Take, @Skip, @ID_TaiKhoanDangNhap);`,
      );
    res.json({
      data: (result.recordset || []).map(mapImportSearchRow),
      pageSize,
      pageIndex,
    });
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Không tìm kiếm được phiếu nhập BTP",
        detail: error.message,
      });
  }
});

router.get('/btp/phieunhap/:id', async (req, res) => {
    try {
        const id = toIntOrNull(req.params.id);
        if (!id) return res.status(400).json({ message: 'Phiếu nhập BTP không hợp lệ' });
        const pool = await tagpoolPromise;
        const result = await pool.request().input('ID_PhieuNhapBTP', sql.Int, id).execute('App_PhieuNhapBTP_ThongTinChiTiet');
        if (!result.recordsets?.[0]?.length) return res.status(404).json({ message: 'Không tìm thấy phiếu nhập BTP' });
        const activeDetails = await pool.request()
            .input('ID_PhieuNhap_ActiveDetails', sql.Int, id)
            .query(`
                SELECT ct.ID_TheKhoKienBTP_ChiTiet
                FROM TheKhoKienBTP_ChiTiet ct
                INNER JOIN TheKhoKienBTP k ON k.ID_TheKhoKienBTP = ct.ID_TheKhoKienBTP
                WHERE k.ID_PhieuNhapBTP = @ID_PhieuNhap_ActiveDetails
                  AND ISNULL(k.TonTai, 1) = 1 AND ISNULL(ct.TonTai, 1) = 1;
            `);
        const activeIds = new Set((activeDetails.recordset || []).map((row) => Number(row.ID_TheKhoKienBTP_ChiTiet)));
        result.recordsets[3] = (result.recordsets[3] || [])
            .filter((row) => activeIds.has(Number(row.ID_TheKhoKienBTP_ChiTiet)));
        res.json(importDetailResponse(result.recordsets));
    } catch (error) {
        res.status(500).json({ message: 'Không tải được chi tiết phiếu nhập BTP', detail: error.message });
    }
});

router.get("/btp/phieunhap/kien/:qrcode/:idKien", async (req, res) => {
  try {
    const idKien = toIntOrNull(req.params.idKien);
    if (!idKien)
      return res.status(400).json({ message: "Kiện BTP không hợp lệ" });
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("QrCode", sql.NVarChar(255), req.params.qrcode)
      .input("ID_TheKhoKienBTP", sql.Int, idKien)
      .execute("App_ThongTinKienBTPChiTiet_By_QrCode");
    const header = result.recordsets?.[0]?.[0];
    if (!header)
      return res.status(404).json({ message: "Không tìm thấy kiện BTP" });
    res.json({
      ...header,
      idTheKhoKienBTP: header.ID_TheKhoKienBTP,
      idPhieuNhapBTP: header.ID_PhieuNhapBTP,
      qrCode: header.QRCode,
      idViTriKho: header.ID_ViTriKho,
      maViTriKho: header.MaViTriKho,
      tonTai: Boolean(header.TonTai),
      bTPs: (result.recordsets?.[1] || []).map((row) => ({
        ...row,
        dauTuan: row.DauTuan,
      })),
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Không tải được kiện BTP", detail: error.message });
  }
});

router.post("/btp/phieunhap/add-kien", async (req, res) => {
  try {
    const soLuongKien = toIntOrNull(req.body?.soLuongKien);
    const idPhieuNhap = toIntOrNull(req.body?.id_PhieuNhapBTP);
    if (!soLuongKien || !idPhieuNhap || soLuongKien <= 0)
      return res.status(400).json({ message: "Dữ liệu tạo kiện không hợp lệ" });
    const pool = await tagpoolPromise;
    await ensureImportEditable(pool.request(), idPhieuNhap);
    const result = await pool
      .request()
      .input("SoLuongKien", sql.Int, soLuongKien)
      .input("ID_PhieuNhapBTP", sql.Int, idPhieuNhap)
      .output("InsertResult", sql.NVarChar(50))
      .execute("App_BTP_PhieuNhapBTP_AddKien");
    const status = result.output?.InsertResult;
    if (status !== "success")
      return res.status(400).json({ message: status || "Tạo kiện thất bại" });
    res.json({ ok: true, message: status });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/btp/phieunhap/xoa-kien", async (req, res) => {
  try {
    const idPhieuNhap = toIntOrNull(req.body?.idPhieuNhapBTP);
    const ids = [
      ...new Set(
        (req.body?.idTheKhoKienBTP || []).map(Number).filter(Number.isInteger),
      ),
    ];
    if (!idPhieuNhap || !ids.length)
      return res.status(400).json({ message: "Chưa chọn kiện cần xóa" });
    const pool = await tagpoolPromise;
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await ensureImportEditable(new sql.Request(tx), idPhieuNhap);
      const params = ids.map((_, index) => `@DeleteId${index}`);
      const request = new sql.Request(tx).input(
        "DeleteImportId",
        sql.Int,
        idPhieuNhap,
      );
      ids.forEach((id, index) =>
        request.input(`DeleteId${index}`, sql.Int, id),
      );
      const result = await request.query(`
                UPDATE TheKhoKienBTP
                SET TonTai = 0, QRCode = NULL
                OUTPUT inserted.ID_TheKhoKienBTP
                WHERE ID_PhieuNhapBTP = @DeleteImportId
                  AND ID_TheKhoKienBTP IN (${params.join(",")})
                  AND NOT EXISTS (
                      SELECT 1 FROM TheKhoKienBTP_ChiTiet ct
                      WHERE ct.ID_TheKhoKienBTP = TheKhoKienBTP.ID_TheKhoKienBTP AND ISNULL(ct.TonTai, 1) = 1
                  );
            `);
      await tx.commit();
      const deletedIds = (result.recordset || []).map(
        (row) => row.ID_TheKhoKienBTP,
      );
      res.json({
        ok: true,
        deletedIds,
        notDeletedIds: ids.filter((id) => !deletedIds.includes(id)),
      });
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/btp/phieunhap/add-chi-tiet', async (req, res) => {
    const body = req.body || {};
    const idKien = toIntOrNull(body.ID_TheKhoKienBTP);
    const idPhieuNhap = toIntOrNull(body.ID_PhieuNhapBTP);
    const idDetail = toIntOrNull(body.ID_TheKhoKienBTP_ChiTiet);
    const btps = Array.isArray(body.bTPs) ? body.bTPs : [];
    if (!idKien || !idPhieuNhap || btps.length !== 1) return res.status(400).json({ message: 'Mỗi lần lưu cần đúng một dòng BTP' });
    try {
        const pool = await tagpoolPromise;
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            await ensureImportEditable(new sql.Request(tx), idPhieuNhap);
            await new sql.Request(tx)
                .input('ID_PhieuNhap_Lock', sql.Int, idPhieuNhap)
                .query('SELECT ID_PhieuNhapBTP FROM PhieuNhapBTP WITH (UPDLOCK, HOLDLOCK) WHERE ID_PhieuNhapBTP = @ID_PhieuNhap_Lock;');
            const packageResult = await new sql.Request(tx)
                .input('ID_Kien_AddDetail', sql.Int, idKien)
                .input('ID_PhieuNhap_AddDetail', sql.Int, idPhieuNhap)
                .query(`
                    SELECT TOP (1) ID_TheKhoKienBTP
                    FROM TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK)
                    WHERE ID_TheKhoKienBTP = @ID_Kien_AddDetail
                      AND ID_PhieuNhapBTP = @ID_PhieuNhap_AddDetail
                      AND TonTai = 1;
                `);
            if (!packageResult.recordset?.length) throw new Error('Kiện không thuộc phiếu nhập BTP này');
            const item = btps[0];
            const soLuong = Number(item.SoLuong ?? item.soLuong);
            const itemCode = String(item.ItemCode || '').trim();
            if (!Number.isFinite(soLuong) || soLuong <= 0 || !itemCode) throw new Error('BTP hoặc số lượng không hợp lệ');
            const dauTuan = normalizeDauTuan(item.DauTuan ?? item.dauTuan);
            if (idDetail) {
                const existing = await new sql.Request(tx)
                    .input('ID_Kien_ExistingDetail', sql.Int, idKien)
                    .input('ID_ExistingDetail', sql.Int, idDetail)
                    .query(`
                        SELECT ItemCode, ID_KeHoachSanXuat, ID_DonHang_LoSanXuat,
                               ID_DonHang_SanPham, ID_QuyTrinhSanXuat, ID_DonHang
                        FROM TheKhoKienBTP_ChiTiet WITH (UPDLOCK, HOLDLOCK)
                        WHERE ID_TheKhoKienBTP = @ID_Kien_ExistingDetail
                          AND ID_TheKhoKienBTP_ChiTiet = @ID_ExistingDetail
                          AND ISNULL(TonTai, 1) = 1;
                    `);
                const row = existing.recordset?.[0];
                if (!row || String(row.ItemCode || '').trim().toUpperCase() !== itemCode.toUpperCase()
                    || [['ID_KeHoachSanXuat', 'IdKeHoachSanXuat'],
                        ['ID_DonHang_LoSanXuat', 'IdDonHangLoSanXuat'],
                        ['ID_DonHang_SanPham', 'IdDonHangSanPham'],
                        ['ID_QuyTrinhSanXuat', 'IdQuyTrinhSanXuat'],
                        ['ID_DonHang', 'IdDonHang']]
                        .some(([field, payloadField]) => (toIntOrNull(row[field]) || 0) !== (toIntOrNull(item[payloadField]) || 0))) {
                    throw new Error('Chỉ có thể sửa số lượng và dấu tuần của dòng BTP hiện có');
                }
            }
            const detailRequest = new sql.Request(tx)
                    .input('ID_TheKhoKienBTP', sql.Int, idKien)
                    .input('ID_PhieuNhapBTP', sql.Int, idPhieuNhap)
                    .input('ID_TheKhoKienBTP_ChiTiet', sql.Int, idDetail)
                    .input('ID_KeHoachSanXuat', sql.Int, toIntOrNull(item.IdKeHoachSanXuat) || 0)
                    .input('ID_DonHang_LoSanXuat', sql.Int, toIntOrNull(item.IdDonHangLoSanXuat) || 0)
                    .input('ID_DonHang_SanPham', sql.Int, toIntOrNull(item.IdDonHangSanPham) || 0)
                    .input('ItemCode', sql.NVarChar(255), itemCode)
                    .input('Ten_SanPham', sql.NVarChar(255), item.tenSanPham || item.TenSanPham || null)
                    .input('ID_QuyTrinhSanXuat', sql.Int, toIntOrNull(item.IdQuyTrinhSanXuat) || 0)
                    .input('Ten_QuyTrinhSanXuat', sql.NVarChar(255), item.Ten_QuyTrinhSanXuat || null)
                    .input('ID_DonHang', sql.Int, toIntOrNull(item.IdDonHang) || 0)
                    .input('SoLuong', sql.Decimal(18, 2), soLuong)
                    .input('DauTuan', sql.NVarChar(50), dauTuan);
            const result = await detailRequest.query(`
                IF @ID_TheKhoKienBTP_ChiTiet IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM TheKhoKienBTP_ChiTiet WITH (UPDLOCK, HOLDLOCK)
                    WHERE ID_TheKhoKienBTP_ChiTiet = @ID_TheKhoKienBTP_ChiTiet
                      AND ID_TheKhoKienBTP = @ID_TheKhoKienBTP AND ISNULL(TonTai, 1) = 1
                ) THROW 51046, N'Chi tiết kiện không còn tồn tại', 1;

                IF EXISTS (
                    SELECT 1 FROM TheKhoKienBTP_ChiTiet WITH (UPDLOCK, HOLDLOCK)
                    WHERE ID_TheKhoKienBTP = @ID_TheKhoKienBTP AND ISNULL(TonTai, 1) = 1
                      AND (@ID_TheKhoKienBTP_ChiTiet IS NULL OR ID_TheKhoKienBTP_ChiTiet <> @ID_TheKhoKienBTP_ChiTiet)
                      AND UPPER(LTRIM(RTRIM(ISNULL(ItemCode, N'')))) = UPPER(@ItemCode)
                      AND ISNULL(ID_KeHoachSanXuat, 0) = @ID_KeHoachSanXuat
                      AND ISNULL(ID_DonHang_LoSanXuat, 0) = @ID_DonHang_LoSanXuat
                      AND ISNULL(ID_DonHang_SanPham, 0) = @ID_DonHang_SanPham
                      AND ISNULL(ID_QuyTrinhSanXuat, 0) = @ID_QuyTrinhSanXuat
                      AND ISNULL(ID_DonHang, 0) = @ID_DonHang
                      AND ISNULL(NULLIF(LTRIM(RTRIM(DauTuan)), N''), N'') = ISNULL(@DauTuan, N'')
                ) THROW 51047, N'BTP và dấu tuần đã có trong kiện, hãy sửa dòng hiện có', 1;

                IF @ID_TheKhoKienBTP_ChiTiet IS NULL
                BEGIN
                    INSERT INTO TheKhoKienBTP_ChiTiet
                        (ID_TheKhoKienBTP, ID_PhieuNhapBTP, ID_KeHoachSanXuat, ID_DonHang_LoSanXuat,
                         ID_DonHang_SanPham, ItemCode, Ten_SanPham, ID_QuyTrinhSanXuat,
                         Ten_QuyTrinhSanXuat, ID_DonHang, SoLuong, TonTai, DauTuan)
                    VALUES
                        (@ID_TheKhoKienBTP, @ID_PhieuNhapBTP, @ID_KeHoachSanXuat, @ID_DonHang_LoSanXuat,
                         @ID_DonHang_SanPham, @ItemCode, @Ten_SanPham, @ID_QuyTrinhSanXuat,
                         @Ten_QuyTrinhSanXuat, @ID_DonHang, @SoLuong, 1, @DauTuan);
                    SELECT CAST(SCOPE_IDENTITY() AS int) AS IdDetail;
                END
                ELSE
                BEGIN
                    UPDATE TheKhoKienBTP_ChiTiet
                    SET SoLuong = @SoLuong, DauTuan = @DauTuan
                    WHERE ID_TheKhoKienBTP_ChiTiet = @ID_TheKhoKienBTP_ChiTiet
                      AND ID_TheKhoKienBTP = @ID_TheKhoKienBTP AND ISNULL(TonTai, 1) = 1;
                    SELECT @ID_TheKhoKienBTP_ChiTiet AS IdDetail;
                END;
            `);
            const importDetail = await new sql.Request(tx)
                .input('ID_PhieuNhapBTP', sql.Int, idPhieuNhap)
                .execute('App_PhieuNhapBTP_ThongTinChiTiet');
            const requested = (importDetail.recordsets?.[1] || [])
                .filter((row) => String(row.ItemCode || '').trim().toUpperCase() === itemCode.toUpperCase())
                .reduce((sum, row) => sum + toNumber(row.SoLuong_NhapKho), 0);
            const allocatedResult = await new sql.Request(tx)
                .input('ID_PhieuNhap_Allocated', sql.Int, idPhieuNhap)
                .input('ItemCode_Allocated', sql.NVarChar(255), itemCode)
                .query(`
                    SELECT ISNULL(SUM(ct.SoLuong), 0) AS Allocated
                    FROM TheKhoKienBTP_ChiTiet ct
                    INNER JOIN TheKhoKienBTP k ON k.ID_TheKhoKienBTP = ct.ID_TheKhoKienBTP
                    WHERE k.ID_PhieuNhapBTP = @ID_PhieuNhap_Allocated
                      AND ISNULL(k.TonTai, 1) = 1 AND ISNULL(ct.TonTai, 1) = 1
                      AND UPPER(LTRIM(RTRIM(ct.ItemCode))) = UPPER(@ItemCode_Allocated);
                `);
            if (requested <= 0 || toNumber(allocatedResult.recordset?.[0]?.Allocated) > requested + 0.000001) {
                throw new Error('Số lượng BTP vượt quá số lượng của phiếu nhập');
            }
            await tx.commit();
            res.json({ ok: true, message: 'success', idDetail: result.recordset?.[0]?.IdDetail });
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

router.post('/btp/phieunhap/xoa-chi-tiet', async (req, res) => {
    const idKien = toIntOrNull(req.body?.ID_TheKhoKienBTP);
    const idPhieuNhap = toIntOrNull(req.body?.ID_PhieuNhapBTP);
    const idDetail = toIntOrNull(req.body?.ID_TheKhoKienBTP_ChiTiet);
    if (!idKien || !idPhieuNhap || !idDetail) return res.status(400).json({ message: 'Chi tiết kiện không hợp lệ' });
    try {
        const pool = await tagpoolPromise;
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            await ensureImportEditable(new sql.Request(tx), idPhieuNhap);
            const result = await new sql.Request(tx)
                .input('ID_PhieuNhap_DeleteDetail', sql.Int, idPhieuNhap)
                .input('ID_Kien_DeleteDetail', sql.Int, idKien)
                .input('ID_Detail_DeleteDetail', sql.Int, idDetail)
                .query(`
                    UPDATE ct SET TonTai = 0
                    FROM TheKhoKienBTP_ChiTiet ct
                    INNER JOIN TheKhoKienBTP k WITH (UPDLOCK, HOLDLOCK)
                      ON k.ID_TheKhoKienBTP = ct.ID_TheKhoKienBTP
                    WHERE k.ID_PhieuNhapBTP = @ID_PhieuNhap_DeleteDetail AND ISNULL(k.TonTai, 1) = 1
                      AND ct.ID_TheKhoKienBTP = @ID_Kien_DeleteDetail
                      AND ct.ID_TheKhoKienBTP_ChiTiet = @ID_Detail_DeleteDetail
                      AND ISNULL(ct.TonTai, 1) = 1;
                    SELECT @@ROWCOUNT AS Deleted;
                `);
            if (result.recordset?.[0]?.Deleted !== 1) throw new Error('Không tìm thấy chi tiết BTP cần xóa');
            await tx.commit();
            res.json({ ok: true, idDetail });
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

router.post("/btp/phieunhap/gan-qr", async (req, res) => {
  try {
    const idKien = toIntOrNull(req.body?.idKien);
    const qrCode = String(req.body?.qrCode || "").trim();
    if (!idKien || !qrCode)
      return res.status(400).json({ message: "QR hoặc kiện không hợp lệ" });
    const pool = await tagpoolPromise;
    const info = await pool
      .request()
      .input("ID_Kien_QR", sql.Int, idKien)
      .query(
        `SELECT ID_PhieuNhapBTP FROM TheKhoKienBTP WHERE ID_TheKhoKienBTP=@ID_Kien_QR AND TonTai=1;`,
      );
    if (!info.recordset?.length)
      return res.status(404).json({ message: "Không tìm thấy kiện BTP" });
    await ensureImportEditable(
      pool.request(),
      info.recordset[0].ID_PhieuNhapBTP,
    );
    const result = await updateBtpPackageQrOnly(pool, idKien, qrCode);
    if (!result || result.StatusCode !== 1)
      return res
        .status(400)
        .json({ message: result?.Message || "Gán QR thất bại" });
    res.json({
      ok: true,
      message: "success",
      idViTriKho: result.ID_ViTriKho ?? null,
      locationChanged: false,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/btp/phieunhap/gan-vi-tri", async (req, res) => {
  const items = Array.isArray(req.body?.viTriKienBTPs)
    ? req.body.viTriKienBTPs
    : [];
  if (!items.length)
    return res.status(400).json({ message: "Chưa chọn kiện cần gán vị trí" });
  try {
    const pool = await tagpoolPromise;
    const tx = new sql.Transaction(pool);
    let rolledBack = false;
    tx.on("rollback", () => {
      rolledBack = true;
    });
    await tx.begin();
    try {
      for (const item of [...items].sort(
        (a, b) => Number(a.ID_TheKhoKienBTP) - Number(b.ID_TheKhoKienBTP),
      )) {
        const idKien = toIntOrNull(item.ID_TheKhoKienBTP);
        const idViTri = toIntOrNull(item.ID_ViTriKho);
        if (!idKien || !idViTri)
          throw new Error("Kiện hoặc vị trí không hợp lệ");
        const result = await new sql.Request(tx)
          .input("ID_Kien_VT", sql.Int, idKien)
          .query(
            `SELECT ID_PhieuNhapBTP FROM TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK) WHERE ID_TheKhoKienBTP=@ID_Kien_VT AND TonTai=1;`,
          );
        if (!result.recordset?.length)
          throw new Error("Không tìm thấy kiện BTP");
        await ensureImportEditable(
          new sql.Request(tx),
          result.recordset[0].ID_PhieuNhapBTP,
        );
        await new sql.Request(tx)
          .input("ID_TheKhoKienBTP", sql.Int, idKien)
          .input("ID_ViTriKho", sql.Int, idViTri)
          .input(
            "ID_TaiKhoan",
            sql.Int,
            toIntOrNull(req.body?.IdTaiKhoanDangNhap),
          )
          .input("LoaiThaoTac", sql.VarChar(20), "GAN_VI_TRI_NHAP")
          .execute("dbo.App_BTP_CapNhatViTriKien");
      }
      await tx.commit();
      res.json({ ok: true, message: "success" });
    } catch (error) {
      if (!rolledBack) await tx.rollback();
      throw error;
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.put('/btp/phieunhap/xac-nhan', async (req, res) => {
    try {
        const idPhieuNhap = toIntOrNull(req.body?.IdPhieuNhap);
        const packages = Array.isArray(req.body?.kiens) ? req.body.kiens : [];
        const details = packages.flatMap((item) => Array.isArray(item.bTPs) ? item.bTPs : []);
        if (!idPhieuNhap || !packages.length || !details.length) return res.status(400).json({ message: 'Phiếu nhập chưa có kiện hợp lệ' });
        if (packages.some((item) => !item.qrCode || !toIntOrNull(item.idViTriKho))) return res.status(400).json({ message: 'Chưa gán hết vị trí và QRCode' });
        if (packages.some((item) => !Array.isArray(item.bTPs) || !item.bTPs.length
            || item.bTPs.some((detail) => toNumber(detail.soLuongTon) <= 0))) {
            return res.status(400).json({ message: 'Mỗi kiện phải có ít nhất một dòng BTP với số lượng lớn hơn 0' });
        }
        const positiveDetails = details.filter((item) => toNumber(item.soLuongTon) > 0);
        if (!positiveDetails.length) return res.status(400).json({ message: 'Phiếu nhập chưa có số lượng BTP' });
        if (positiveDetails.some((item) => !toIntOrNull(item.idTheKhoKienBTPChiTiet))) {
            return res.status(400).json({ message: 'Chi tiết kiện chưa được lưu, vui lòng tải lại phiếu nhập' });
        }
        const pool = await tagpoolPromise;
        await ensureImportEditable(pool.request(), idPhieuNhap);
        const allowedResult = await pool.request()
            .input('ID_PhieuNhapBTP_Quantity', sql.Int, idPhieuNhap)
            .query(`
                DECLARE @CheckTheoKH int = (
                    SELECT COUNT(*) FROM PhieuNhapBTP_KeHoachSanXuat WHERE ID_PhieuNhapBTP = @ID_PhieuNhapBTP_Quantity
                );
                IF @CheckTheoKH <> 0
                BEGIN
                    SELECT pnct.ID_KeHoachSanXuat,
                           ISNULL(pnct.ID_DonHang_SanPham, 0) AS ID_DonHang_SanPham,
                           ISNULL(l.ID_DonHang, 0) AS ID_DonHang,
                           ISNULL(pnct.ID_DonHang_LoSanXuat, 0) AS ID_DonHang_LoSanXuat,
                           ISNULL(SUM(SoLuong_NhapKho), 0) AS SoLuong_NhapKho
                    FROM PhieuNhapBTP_KeHoachSanXuat pnct
                    LEFT JOIN TAG_QLSX.dbo.KeHoachSanXuat kh ON kh.ID_KeHoachSanXuat = pnct.ID_KeHoachSanXuat
                    LEFT JOIN TAG_QLSX.dbo.LenhSanXuat l ON l.ID_LenhSanXuat = kh.ID_LenhSanXuat
                    WHERE pnct.ID_PhieuNhapBTP = @ID_PhieuNhapBTP_Quantity
                    GROUP BY pnct.ID_KeHoachSanXuat, ISNULL(pnct.ID_DonHang_SanPham, 0), ISNULL(l.ID_DonHang, 0), ISNULL(pnct.ID_DonHang_LoSanXuat, 0);
                END
                ELSE
                BEGIN
                    SELECT 0 AS ID_KeHoachSanXuat,
                           ISNULL(ID_DonHang_SanPham, 0) AS ID_DonHang_SanPham,
                           ISNULL(ID_DonHang, 0) AS ID_DonHang,
                           ISNULL(ID_DonHang_LoSanXuat, 0) AS ID_DonHang_LoSanXuat,
                           ISNULL(SUM(SoLuong_NhapKho), 0) AS SoLuong_NhapKho
                    FROM PhieuNhapBTP_ChiTiet
                    WHERE ID_PhieuNhapBTP = @ID_PhieuNhapBTP_Quantity
                    GROUP BY ISNULL(ID_DonHang_SanPham, 0), ISNULL(ID_DonHang, 0), ISNULL(ID_DonHang_LoSanXuat, 0);
                END;
            `);
        const importKeys = ['ID_KeHoachSanXuat', 'ID_DonHang_SanPham', 'ID_DonHang', 'ID_DonHang_LoSanXuat'];
        const requestedDetails = positiveDetails.map((item) => ({
            ID_KeHoachSanXuat: item.idKeHoachSanXuat,
            ID_DonHang_SanPham: item.idDonHangSanPham,
            ID_DonHang: item.idDonHang,
            ID_DonHang_LoSanXuat: item.idDonHangLoSanXuat,
            SoLuong_NhapKho: item.soLuongTon,
        }));
        if (!importQuantitiesFit(allowedResult.recordset || [], requestedDetails, importKeys, 'SoLuong_NhapKho', 'SoLuong_NhapKho')) {
            return res.status(400).json({ message: 'Số lượng nhập phải bằng số lượng trên ERP' });
        }
        const table = new sql.Table('dbo.TheKhoKienBTPChiTietNhapsType');
        table.columns.add('ID_PhieuNhapBTP', sql.Int);
        table.columns.add('ID_TheKhoKienBTPChiTiet', sql.Int);
        table.columns.add('ID_TheKhoKienBTP', sql.Int);
        table.columns.add('ID_KeHoachSanXuat', sql.Int);
        table.columns.add('ID_DonHang_LoSanXuat', sql.Int);
        table.columns.add('ID_DonHang_SanPham', sql.Int);
        table.columns.add('ItemCode', sql.NVarChar(50));
        table.columns.add('Ten_SanPham', sql.NVarChar(200));
        table.columns.add('ID_QuyTrinhSanXuat', sql.Int);
        table.columns.add('Ten_QuyTrinhSanXuat', sql.NVarChar(50));
        table.columns.add('ID_DonHang', sql.Int);
        table.columns.add('Ma_DonHang', sql.NVarChar(200));
        table.columns.add('SoLuong', sql.Decimal(18, 2));
        positiveDetails.forEach((item) => table.rows.add(
            idPhieuNhap,
            toIntOrNull(item.idTheKhoKienBTPChiTiet) || 0,
            toIntOrNull(item.idTheKhoKienBTP) || 0,
            toIntOrNull(item.idKeHoachSanXuat) || 0,
            toIntOrNull(item.idDonHangLoSanXuat) || 0,
            toIntOrNull(item.idDonHangSanPham) || 0,
            item.itemCode || null,
            item.tenSanPham || null,
            toIntOrNull(item.idQuyTrinhSanXuat) || 0,
            item.ten_QuyTrinhSanXuat || null,
            toIntOrNull(item.idDonHang) || 0,
            item.maDonHang || null,
            toNumber(item.soLuongTon),
        ));
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            await ensureImportEditable(new sql.Request(tx), idPhieuNhap);
            const result = await new sql.Request(tx)
                .input('TheKhoKienBTPChiTietNhapsTable', table)
                .output('InsertResult', sql.NVarChar(50))
                .execute('App_XacNhanPhieuNhap_BTP');
            const status = result.output?.InsertResult;
            if (status !== 'success') throw new Error(status || 'Xác nhận phiếu nhập thất bại');
            const persisted = await new sql.Request(tx)
                .input('ID_PhieuNhap_VerifyDetails', sql.Int, idPhieuNhap)
                .query(`
                    SELECT ct.ID_TheKhoKienBTP_ChiTiet, ct.ID_TheKhoKienBTP, ct.SoLuong, ct.DauTuan
                    FROM TheKhoKienBTP_ChiTiet ct
                    INNER JOIN TheKhoKienBTP k ON k.ID_TheKhoKienBTP = ct.ID_TheKhoKienBTP
                    WHERE k.ID_PhieuNhapBTP = @ID_PhieuNhap_VerifyDetails
                      AND ISNULL(k.TonTai, 1) = 1 AND ISNULL(ct.TonTai, 1) = 1;
                `);
            const persistedById = new Map((persisted.recordset || [])
                .map((row) => [Number(row.ID_TheKhoKienBTP_ChiTiet), row]));
            const submittedIds = new Set(positiveDetails.map((item) => Number(item.idTheKhoKienBTPChiTiet)));
            if (submittedIds.size !== positiveDetails.length || persistedById.size !== submittedIds.size
                || positiveDetails.some((item) => {
                const row = persistedById.get(Number(item.idTheKhoKienBTPChiTiet));
                return !row || Number(row.ID_TheKhoKienBTP) !== Number(item.idTheKhoKienBTP)
                    || Math.abs(toNumber(row.SoLuong) - toNumber(item.soLuongTon)) > 0.000001
                    || String(row.DauTuan || '').trim() !== String(item.dauTuan || '').trim();
            })) throw new Error('Thủ tục xác nhận không giữ đúng toàn bộ chi tiết BTP và dấu tuần của kiện');
            await tx.commit();
            res.json({ ok: true, isSuccess: status });
        } catch (error) {
            try { await tx.rollback(); } catch (_) { /* Thủ tục có thể đã tự rollback. */ }
            throw error;
        }
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

router.get("/btp/phieuxuat/types", async (_req, res) => {
  try {
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .query(
        `SELECT ID_HinhThucXuatBTP AS idHinhThucXuatBTP, Ten_HinhThucXuatBTP AS loaiPhieu FROM DM_HinhThucXuatBTP;`,
      );
    res.json(result.recordset || []);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Không tải được loại phiếu xuất BTP",
        detail: error.message,
      });
  }
});

router.post("/btp/phieuxuat/tim-kiem", async (req, res) => {
  try {
    const body = req.body || {};
    const pageSize = Math.min(100, Math.max(1, Number(body.PageSize || 20)));
    const pageIndex = Math.max(0, Number(body.PageIndex || 0));
    const warehouseIds = (Array.isArray(body.idKho) ? body.idKho : [])
      .map(Number)
      .filter(Number.isInteger)
      .join(",");
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("WarehouseId", sql.NVarChar(200), warehouseIds)
      .input("Status", sql.Bit, body.trangThai ?? null)
      .input(
        "ReviewNumber",
        sql.NVarChar(255),
        String(body.soPhieu || "").trim(),
      )
      .input("Type", sql.Int, toIntOrNull(body.loaiPhieu))
      .input("Take", sql.Int, pageSize)
      .input("Skip", sql.Int, pageIndex * pageSize)
      .input(
        "ID_TaiKhoanDangNhap",
        sql.Int,
        toIntOrNull(body.IdTaiKhoanDangNhap) || 0,
      )
      .query(
        `SELECT * FROM dbo.SearchPhieuXuatBTP(@WarehouseId, @Status, @ReviewNumber, @Type, @Take, @Skip, @ID_TaiKhoanDangNhap);`,
      );
    res.json({
      data: (result.recordset || []).map(mapExportSearchRow),
      pageSize,
      pageIndex,
    });
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Không tìm kiếm được phiếu xuất BTP",
        detail: error.message,
      });
  }
});

router.get("/btp/phieuxuat/goi-y-kien", async (req, res) => {
  try {
    const idPhieuXuat = toIntOrNull(req.query.idPhieuXuat);
    if (!idPhieuXuat)
      return res.status(400).json({ message: "Phiếu xuất BTP không hợp lệ" });

    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("ID_PhieuXuatBTP", sql.Int, idPhieuXuat)
      .input(
        "ID_DonHang_LoSanXuat",
        sql.Int,
        toIntOrNull(req.query.idDonHangLoSanXuat) || 0,
      )
      .input(
        "ID_DonHang_SanPham",
        sql.Int,
        toIntOrNull(req.query.idDonHangSanPham) || 0,
      )
      .input("ID_DonHang", sql.Int, toIntOrNull(req.query.idDonHang) || 0)
      .input(
        "ID_QuyTrinhSanXuat",
        sql.Int,
        toIntOrNull(req.query.idQuyTrinhSanXuat) || 0,
      )
      .execute("KhoTM_BTP_PhieuXuat_GoiYKienTheoDauTuan");

    const packagesById = new Map();
    for (const row of result.recordset || []) {
      const packageId = toIntOrNull(row.IdTheKhoKienBTP);
      const detailId = toIntOrNull(row.IdTheKhoKienBTPChiTiet);
      if (!packageId || !detailId) continue;

      let packageItem = packagesById.get(packageId);
      if (!packageItem) {
        packageItem = {
          idTheKhoKienBTP: packageId,
          qrCode: String(row.QRCode || "").trim(),
          idViTriKho: toIntOrNull(row.IdViTriKho),
          maViTriKho: row.MaViTriKho || null,
          maNha: row.MaNha || null,
          earliestWeekMark: null,
          totalStockQuantity: 0,
          details: [],
        };
        packagesById.set(packageId, packageItem);
      }

      const weekMark =
        row.DauTuan == null ? null : String(row.DauTuan).trim() || null;
      const stockQuantity = Math.max(0, toNumber(row.SoLuongTon));
      if (packageItem.earliestWeekMark == null && weekMark != null)
        packageItem.earliestWeekMark = weekMark;
      packageItem.totalStockQuantity += stockQuantity;
      packageItem.details.push({
        idTheKhoKienBTPChiTiet: detailId,
        idTheKhoKienBTP: packageId,
        qrCode: packageItem.qrCode,
        idViTriKho: packageItem.idViTriKho,
        maViTriKho: packageItem.maViTriKho,
        idDonHangLoSanXuat: toIntOrNull(row.IdDonHangLoSanXuat) || 0,
        soLoSanXuat: row.SoLoSanXuat || null,
        idDonHangSanPham: toIntOrNull(row.IdDonHangSanPham) || 0,
        idDonHang: toIntOrNull(row.IdDonHang) || 0,
        idQuyTrinhSanXuat: toIntOrNull(row.IdQuyTrinhSanXuat) || 0,
        itemCode: row.ItemCode || null,
        tenSanPham: row.TenSanPham || null,
        maDonHang: row.MaDonHang || null,
        weekMark,
        weekMarkSource: row.NguonDauTuan || null,
        stockQuantity,
        ngayNhap: row.NgayNhap || null,
      });
    }

    res.json({ items: Array.from(packagesById.values()) });
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Không tải được kiện gợi ý theo dấu tuần",
        detail: error.message,
      });
  }
});

router.get("/btp/phieuxuat/:id", async (req, res) => {
  try {
    const id = toIntOrNull(req.params.id);
    if (!id)
      return res.status(400).json({ message: "Phiếu xuất BTP không hợp lệ" });
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("ID_PhieuXuatBTP", sql.Int, id)
      .execute("App_BTP_PhieuXuat_ThongTinChiTiet");
    const header = result.recordsets?.[0]?.[0];
    if (!header)
      return res.status(404).json({ message: "Không tìm thấy phiếu xuất BTP" });
    res.json({
      id: header.ID_PhieuXuatBTP,
      soPhieu: header.So_PhieuXuatBTP,
      loaiPhieu: header.Ten_HinhThucXuatBTP,
      ngayXuat: header.Ngay_XuatBTP,
      trangThai: Boolean(header.QrStatus),
      chiTiets: (result.recordsets?.[1] || []).map((row) => ({
        ...row,
        idDonHangLoSanXuat: row.ID_DonHang_LoSanXuat,
        soLoSanXuat: row.So_LoSanXuat,
        idDonHangSanPham: row.ID_DonHang_SanPham,
        idDonHang: row.ID_DonHang,
        itemCode: row.ItemCode,
        tenSanPham: row.Ten_SanPham,
        soLuongLenhXuat: row.SoLuong_XuatKho,
        maDonHang: row.Ma_DonHang,
      })),
      kiens: (result.recordsets?.[2] || []).map((row) => ({
        ...row,
        idTheKhoKienBTPChiTiet: row.ID_TheKhoKienBTP_ChiTiet,
        idTheKhoKienBTP: row.ID_TheKhoKienBTP,
        idViTriKho: row.ID_ViTriKho,
        qrCode: row.QRCode,
        soLuong: row.SoLuong_XuatKho,
        soLuongTon: row.SoLuongTon,
        idDonHangLoSanXuat: row.ID_DonHang_LoSanXuat,
        soLoSanXuat: row.So_LoSanXuat,
        idDonHangSanPham: row.ID_DonHang_SanPham,
        tenSanPham: row.Ten_SanPham,
        itemCode: row.ItemCode,
        idDonHang: row.ID_DonHang,
        maDonHang: row.Ma_DonHang,
      })),
    });
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Không tải được chi tiết phiếu xuất BTP",
        detail: error.message,
      });
  }
});

router.get(
  "/btp/phieuxuat/kien/:qrcode/:idPhieuXuat/:idDonHangLoSanXuat",
  async (req, res) => {
    try {
      const pool = await tagpoolPromise;
      const result = await pool
        .request()
        .input("QrCode", sql.NVarChar(255), req.params.qrcode)
        .input("ID_PhieuXuatBTP", sql.Int, toIntOrNull(req.params.idPhieuXuat))
        .input(
          "ID_DonHang_LoSanXuat",
          sql.Int,
          toIntOrNull(req.params.idDonHangLoSanXuat) || 0,
        )
        .execute("App_ChiTiet_PhieuXuatBTP_ByKien");
      const header = result.recordsets?.[0]?.[0];
      if (!header)
        return res.status(404).json({ message: "Không tìm thấy kiện phù hợp" });
      const qrCode = header.QRCode ?? header.QrCode;
      const details = (result.recordsets?.[1] || []).map((row) => ({
        ...row,
        idTheKhoKienBTPChiTiet: row.ID_TheKhoKienBTP_ChiTiet,
        idTheKhoKienBTP: row.ID_TheKhoKienBTP ?? header.ID_TheKhoKienBTP,
        idDonHangLoSanXuat: row.ID_DonHang_LoSanXuat,
        idDonHangSanPham: row.ID_DonHang_SanPham,
        idDonHang: row.ID_DonHang,
        itemCode: row.ItemCode,
        tenSanPham: row.Ten_SanPham,
        soLuongBanDau: row.SoLuong,
        soLuongTon: row.SoLuongTon,
        soLuongXuat: row.SoLuongXuat,
        qrCode,
        QRCode: qrCode,
        idViTriKho: header.ID_ViTriKho,
        maViTriKho: header.MaViTriKho,
      }));
      res.json({
        ...header,
        idTheKhoKienBTP: header.ID_TheKhoKienBTP,
        idPhieuNhapBTP: header.ID_PhieuNhapBTP,
        qrCode,
        idViTriKho: header.ID_ViTriKho,
        maViTriKho: header.MaViTriKho,
        bTPs: details,
      });
    } catch (error) {
      res
        .status(500)
        .json({
          message: "Không tải được kiện xuất BTP",
          detail: error.message,
        });
    }
  },
);

router.get("/btp/phieuxuat/list-kien", async (req, res) => {
  try {
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("ID_PhieuXuatBTP", sql.Int, toIntOrNull(req.query.idPhieuXuat))
      .input("MaNha", sql.NVarChar(100), String(req.query.maNha || ""))
      .input(
        "ID_DonHang_LoSanXuat",
        sql.Int,
        toIntOrNull(req.query.idDonHangLoSanxuat) || 0,
      )
      .input(
        "ID_DonHang_SanPham",
        sql.Int,
        toIntOrNull(req.query.idDonHangSanPham) || 0,
      )
      .input("ID_DonHang", sql.Int, toIntOrNull(req.query.idDonHang) || 0)
      .input(
        "ID_QuyTrinhSanXuat",
        sql.Int,
        toIntOrNull(req.query.IdQuyTrinhSanXuat) || 0,
      )
      .execute("App_ThongTinListKien_By_PhieuXuatBTP");
    res.json(result.recordset || []);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Không tải được danh sách kiện BTP",
        detail: error.message,
      });
  }
});

router.put("/btp/phieuxuat/xac-nhan", async (req, res) => {
  try {
    const idPhieuXuat = toIntOrNull(req.body?.IdPhieuXuat);
    const picks = Array.isArray(req.body?.Kiens) ? req.body.Kiens : [];
    if (!idPhieuXuat || !picks.length)
      return res.status(400).json({ message: "Phiếu xuất chưa có kiện" });
    if (picks.some((item) => toNumber(item.SoLuongXuatKho) <= 0))
      return res.status(400).json({ message: "Số lượng xuất phải lớn hơn 0" });
    const table = new sql.Table("dbo.ChiTietKienBTPsType");
    table.columns.add("ID_TheKhoKienBTP_ChiTiet", sql.Int);
    table.columns.add("ID_DonHang_LoSanXuat", sql.Int);
    table.columns.add("ID_DonHang_SanPham", sql.Int);
    table.columns.add("ID_DonHang", sql.Int);
    table.columns.add("SoLuong_XuatKho", sql.Decimal(18, 2));
    picks.forEach((item) =>
      table.rows.add(
        toIntOrNull(item.IdTheKhoKienBTPChiTiet) || 0,
        toIntOrNull(item.IdDonHangLoSanXuat) || 0,
        toIntOrNull(item.IdDonHangSanPham) || 0,
        toIntOrNull(item.IdDonHang) || 0,
        toNumber(item.SoLuongXuatKho),
      ),
    );
    const pool = await tagpoolPromise;
    const statusResult = await pool
      .request()
      .input("ID_PhieuXuatBTP_Status", sql.Int, idPhieuXuat)
      .query(
        `SELECT TOP (1) QrStatus FROM PhieuXuatBTP WHERE ID_PhieuXuatBTP=@ID_PhieuXuatBTP_Status AND TonTai=1;`,
      );
    if (!statusResult.recordset?.length)
      return res.status(404).json({ message: "Không tìm thấy phiếu xuất BTP" });
    if (statusResult.recordset[0].QrStatus)
      return res.status(409).json({ message: "Phiếu xuất BTP đã xác nhận" });
    const allowedResult = await pool
      .request()
      .input("ID_PhieuXuatBTP_Quantity", sql.Int, idPhieuXuat).query(`
                SELECT ISNULL(ID_DonHang, 0) AS ID_DonHang,
                       ISNULL(SUM(SoLuong_XuatKho), 0) AS SoLuong_XuatKho
                FROM PhieuXuatBTP_ChiTiet
                WHERE ID_PhieuXuatBTP = @ID_PhieuXuatBTP_Quantity
                GROUP BY ISNULL(ID_DonHang, 0);
            `);
    const requestedByOrder = picks.map((item) => ({
      ID_DonHang: item.IdDonHang,
      SoLuong_XuatKho: item.SoLuongXuatKho,
    }));
    if (
      !quantitiesFit(
        allowedResult.recordset || [],
        requestedByOrder,
        ["ID_DonHang"],
        "SoLuong_XuatKho",
        "SoLuong_XuatKho",
      )
    ) {
      return res
        .status(400)
        .json({ message: "Số lượng xuất lớn hơn trên ERP" });
    }
    const result = await pool
      .request()
      .input("ChiTietKienBTPsTable", table)
      .input("ID_PhieuXuatBTP", sql.Int, idPhieuXuat)
      .output("InsertResult", sql.NVarChar(50))
      .execute(
        "App_Update_PhieuXuatBTP_ChiTiet_By_PhieuXuatBTP_ChiTiet_TheKhoKien",
      );
    const status = result.output?.InsertResult;
    if (status !== "success")
      return res
        .status(400)
        .json({ message: status || "Xác nhận phiếu xuất thất bại" });
    res.json({ ok: true, isSuccess: status });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/btp/baocao/vi-tri", async (req, res) => {
  try {
    const userId = toIntOrNull(req.query.idTaiKhoan);
    const idKho = toIntOrNull(req.query.idKho);
    if (!userId)
      return res.status(400).json({ message: "Tài khoản không hợp lệ" });
    if (!idKho)
      return res.status(400).json({ message: "Kho BTP không hợp lệ" });

    const itemCode = String(req.query.itemCode || "").trim();
    const dauTuan = String(req.query.dauTuan || "").trim();
    if (itemCode.length > 255)
      return res.status(400).json({ message: "ItemCode tối đa 255 ký tự" });
    if (dauTuan.length > 50)
      return res.status(400).json({ message: "Dấu tuần tối đa 50 ký tự" });

    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("ID_Kho", sql.SmallInt, idKho)
      .input(
        "MaNha",
        sql.NVarChar(50),
        String(req.query.maNha || "").trim() || null,
      )
      .input(
        "MaDay",
        sql.NVarChar(20),
        String(req.query.maDay || "").trim() || null,
      )
      .input("ItemCode", sql.NVarChar(255), itemCode || null)
      .input("DauTuan", sql.NVarChar(50), dauTuan || null)
      .input("ID_TaiKhoanDangNhap", sql.Int, userId)
      .execute("KhoTM_BTP_BaoCao_ViTriTheoItemCodeDauTuan");
    res.json(result.recordset || []);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Không tải được báo cáo vị trí BTP",
        detail: error.message,
      });
  }
});

router.post("/btp/vitri/nha", async (req, res) => {
  try {
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input(
        "ID_TaiKhoanDangNhap",
        sql.Int,
        toIntOrNull(req.body?.idTaiKhoan) || 0,
      )
      .input("ID_Kho", sql.Int, toIntOrNull(req.body?.idKho) || 5)
      .execute("App_SearchNhaKho");
    res.json(result.recordset || []);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Không tải được danh sách nhà kho",
        detail: error.message,
      });
  }
});

router.post("/btp/vitri/day", async (req, res) => {
  try {
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("idKho", sql.Int, toIntOrNull(req.body?.idKho) || 5)
      .input("MaNha", sql.NVarChar(100), req.body?.maNha || "")
      .execute("App_GetThongTinDay_ByID_Kho");
    res.json(result.recordset || []);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Không tải được dãy kho", detail: error.message });
  }
});

router.get("/btp/vitri/danh-sach", async (req, res) => {
  try {
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("idKho", sql.Int, toIntOrNull(req.query.idKho) || 5)
      .input("MaNha", sql.NVarChar(100), req.query.maNha || "")
      .input("MaDay", sql.NVarChar(100), req.query.maDay || "")
      .input("ItemCode", sql.NVarChar(255), req.query.maVatTu || "none")
      .input(
        "ID_TaiKhoanDangNhap",
        sql.Int,
        toIntOrNull(req.query.idTaiKhoan) || 0,
      )
      .execute("App_GetThongTinViTriBTP_ByID_Kho_w_ID_Nha_w_ID_Day");
    res.json(result.recordset || []);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Không tải được vị trí BTP", detail: error.message });
  }
});

router.get("/btp/vitri/qr/:qrcode", async (req, res) => {
  try {
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("QrCode", sql.NVarChar(255), req.params.qrcode)
      .execute("App_GetThongTinViTriBTP_ByQrCode");
    if (!result.recordset?.length)
      return res.status(404).json({ message: "Không tìm thấy vị trí BTP" });
    res.json(result.recordset[0]);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Không tải được vị trí BTP", detail: error.message });
  }
});

router.get("/btp/vitri/:id/chitiet", async (req, res) => {
  try {
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("ID_ViTri", sql.Int, toIntOrNull(req.params.id))
      .execute("App_GetTheKhoKienBTPChiTiet_ByID_ViTri");
    res.json(result.recordsets?.[0] || []);
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Không tải được kiện theo vị trí",
        detail: error.message,
      });
  }
});

router.get("/btp/kien/:idKien/lich-su-vi-tri/:idLichSu", async (req, res) => {
  const idKien = Number(req.params.idKien);
  const idLichSu = String(req.params.idLichSu || "");
  if (
    !Number.isInteger(idKien) ||
    idKien <= 0 ||
    idKien > 2147483647 ||
    !/^[1-9][0-9]{0,18}$/.test(idLichSu) ||
    BigInt(idLichSu) > 9223372036854775807n
  ) {
    return res.status(400).json({ message: "Kiện hoặc lịch sử không hợp lệ" });
  }
  try {
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("ID_Kien", sql.Int, idKien)
      .input("ID_LichSu", sql.VarChar(19), idLichSu).query(`
                SELECT CONVERT(varchar(20), ID_LichSu) AS ID_LichSu,
                    ID_TheKhoKienBTP, QRCodeKien, ID_ViTriCu, MaViTriCu, QRCodeViTriCu,
                    ID_ViTriMoi, MaViTriMoi, QRCodeViTriMoi,
                    CONVERT(varchar(23), ThoiGianUTC, 126) + 'Z' AS ThoiGianUTC,
                    ID_TaiKhoan, LoaiThaoTac, ThongTinViTriCu, ThongTinViTriMoi,
                    SnapshotVersion, ThongTinKien, ChiTietKien
                FROM dbo.TheKhoKienBTP_LichSuViTri
                WHERE ID_TheKhoKienBTP = @ID_Kien AND ID_LichSu = CONVERT(bigint, @ID_LichSu);
            `);
    const row = result.recordset?.[0];
    if (!row)
      return res
        .status(404)
        .json({ message: "Không tìm thấy lịch sử của kiện này" });
    const hasPackageSnapshot =
      row.SnapshotVersion != null &&
      row.ThongTinKien != null &&
      row.ChiTietKien != null;
    const packageInfo = hasPackageSnapshot
      ? JSON.parse(row.ThongTinKien)
      : null;
    const details = hasPackageSnapshot ? JSON.parse(row.ChiTietKien) : null;
    if (
      hasPackageSnapshot &&
      (!packageInfo ||
        typeof packageInfo !== "object" ||
        Array.isArray(packageInfo) ||
        !Array.isArray(details))
    ) {
      throw new Error("Snapshot nội dung kiện không hợp lệ");
    }
    res.json({
      ...row,
      hasPackageSnapshot,
      ThongTinKien: packageInfo,
      ChiTietKien: details,
    });
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Không tải được nội dung kiện lúc điều chuyển",
        detail: error.message,
      });
  }
});

router.get("/btp/kien/:idKien/lich-su-vi-tri", async (req, res) => {
  const idKien = Number(req.params.idKien);
  const pageIndex = Number(req.query.pageIndex ?? 0);
  const requestedSize = Number(req.query.pageSize ?? 20);
  if (
    !Number.isInteger(idKien) ||
    idKien <= 0 ||
    idKien > 2147483647 ||
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    !Number.isInteger(requestedSize) ||
    requestedSize < 1
  ) {
    return res
      .status(400)
      .json({ message: "Kiện hoặc phân trang không hợp lệ" });
  }
  const pageSize = Math.min(requestedSize, 100);
  const offset = pageIndex * pageSize;
  if (!Number.isSafeInteger(offset) || offset > 2147483647) {
    return res.status(400).json({ message: "Trang vượt giới hạn" });
  }
  try {
    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("ID_Kien", sql.Int, idKien)
      .input("Offset", sql.Int, offset)
      .input("PageSize", sql.Int, pageSize).query(`
                SELECT COUNT(*) AS total FROM dbo.TheKhoKienBTP_LichSuViTri WHERE ID_TheKhoKienBTP = @ID_Kien;
                SELECT CONVERT(varchar(20), ID_LichSu) AS ID_LichSu,
                    ID_TheKhoKienBTP, QRCodeKien, ID_ViTriCu, MaViTriCu, QRCodeViTriCu,
                    ID_ViTriMoi, MaViTriMoi, QRCodeViTriMoi,
                    CONVERT(varchar(23), ThoiGianUTC, 126) + 'Z' AS ThoiGianUTC,
                    ID_TaiKhoan, LoaiThaoTac,
                    CAST(CASE WHEN SnapshotVersion IS NOT NULL AND ThongTinKien IS NOT NULL AND ChiTietKien IS NOT NULL THEN 1 ELSE 0 END AS bit) AS hasPackageSnapshot,
                    COALESCE(h.ThongTinViTriCu, (
                        SELECT TenViTriKho, TenNha, MaNha, TenKhuVuc, MaKhuVuc,
                               TenDay, MaDay, TenTang, MaTang, TenKe, MaKe
                        FROM dbo.DM_Kho_ViTri WHERE ID_ViTriKho = h.ID_ViTriCu
                        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
                    )) AS ThongTinViTriCu,
                    COALESCE(h.ThongTinViTriMoi, (
                        SELECT TenViTriKho, TenNha, MaNha, TenKhuVuc, MaKhuVuc,
                               TenDay, MaDay, TenTang, MaTang, TenKe, MaKe
                        FROM dbo.DM_Kho_ViTri WHERE ID_ViTriKho = h.ID_ViTriMoi
                        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
                    )) AS ThongTinViTriMoi,
                    CASE WHEN h.ThongTinViTriCu IS NULL AND h.ID_ViTriCu IS NOT NULL THEN 1 ELSE 0 END AS ViTriCuTuDanhMuc,
                    CASE WHEN h.ThongTinViTriMoi IS NULL THEN 1 ELSE 0 END AS ViTriMoiTuDanhMuc
                FROM dbo.TheKhoKienBTP_LichSuViTri h WHERE ID_TheKhoKienBTP = @ID_Kien
                ORDER BY ThoiGianUTC DESC, ID_LichSu DESC
                OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
            `);
    res.json({
      items: result.recordsets?.[1] || [],
      total: result.recordsets?.[0]?.[0]?.total || 0,
      pageIndex,
      pageSize,
    });
  } catch (error) {
    res
      .status(500)
      .json({
        message: "Không tải được lịch sử vị trí",
        detail: error.message,
      });
  }
});

router.post("/btp/vitri/cap-nhat-kien", async (req, res) => {
  try {
    const idKien = toIntOrNull(req.body?.ID_TheKhoKienBTP);
    const idViTri = toIntOrNull(req.body?.ID_ViTriKho);
    if (!idKien || !idViTri)
      return res.status(400).json({ message: "Kiện hoặc vị trí không hợp lệ" });
    const pool = await tagpoolPromise;
    await pool
      .request()
      .input("ID_TheKhoKienBTP", sql.Int, idKien)
      .input("ID_ViTriKho", sql.Int, idViTri)
      .input("ID_TaiKhoan", sql.Int, toIntOrNull(req.body?.IdTaiKhoanDangNhap))
      .input("LoaiThaoTac", sql.VarChar(20), "DIEU_CHUYEN")
      .execute("dbo.App_BTP_CapNhatViTriKien");
    res.json({ ok: true });
  } catch (error) {
    const number = error.number ?? error.originalError?.info?.number;
    const status =
      number === 51041 ? 404 : [51042, 51043].includes(number) ? 400 : 500;
    res
      .status(status)
      .json({ message: "Cập nhật vị trí thất bại", detail: error.message });
  }
});

//kho nguyên liệu

router.post("/khonl/getcuontheovitri", async (req, res) => {
  try {
    const { QRCode } = req.body || {};

    // Kiểm tra input
    if (!QRCode || typeof QRCode !== "string" || !QRCode.trim()) {
      return res
        .status(400)
        .json({ ok: false, message: "Thiếu hoặc sai QRCode/ID_ViTriKho" });
    }

    // Ở kho NL, QRCode chính là ID_ViTriKho
    const idViTri = parseInt(QRCode.trim(), 10);

    if (Number.isNaN(idViTri) || idViTri <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "ID_ViTriKho không hợp lệ" });
    }

    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("ID_ViTriKho", sql.Int, idViTri)
      .execute("sp_NL_GetCuonTheoViTri");

    const recordset = result.recordset || [];

    if (recordset.length === 0) {
      return res
        .status(404)
        .json({
          ok: false,
          message: "Không tìm thấy cuộn nào trong vị trí này",
        });
    }

    // Trả về danh sách cuộn
    return res.json({
      ok: true,
      data: recordset,
    });
  } catch (err) {
    console.error("khonl/getcuontheovitri SP error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Lỗi máy chủ", detail: err?.message });
  }
});

router.post("/khopl/getthongtinkien", async (req, res) => {
  try {
    const { QRCode } = req.body || {};

    // Kiểm tra input
    if (!QRCode || typeof QRCode !== "string" || !QRCode.trim()) {
      return res
        .status(400)
        .json({ ok: false, message: "Thiếu hoặc sai QRCode/ID_ViTriKho" });
    }

    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("QRCode", sql.NVarChar, QRCode.trim())
      .execute("App_Kho_PhuLieu_GetChiTietTheKhoKien");

    const recordset = result.recordsets || [];

    if (recordset.length === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Không tìm thấy thông tin" });
    }

    // Trả về danh sách cuộn
    return res.json({
      ok: true,
      data: recordset,
    });
  } catch (err) {
    console.error("khopl/getthongtinkien SP error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Lỗi máy chủ", detail: err?.message });
  }
});

router.post("/khopl/updateqrcodekien", async (req, res) => {
  try {
    const { ID_Kien, QRCode } = req.body || {};

    if (!ID_Kien || !QRCode) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu dữ liệu",
      });
    }

    const pool = await tagpoolPromise;

    const result = await pool
      .request()
      .input("ID_Kien", sql.Int, ID_Kien)
      .input("QRCode", sql.NVarChar(100), QRCode.trim())
      .execute("sp_UpdateQRCodeKienPL");

    const response = result.recordset?.[0];

    if (!response || response.StatusCode !== 1) {
      return res.status(400).json({
        ok: false,
        message: response?.Message || "Cập nhật thất bại",
      });
    }

    return res.json({
      ok: true,
      message: response.Message,
    });
  } catch (err) {
    console.error("updateqrcodekien PL error:", err);
    return res.status(500).json({
      ok: false,
      message: "Lỗi máy chủ",
      detail: err?.message,
    });
  }
});

router.post("/khopl/updatevitrikien", async (req, res) => {
  try {
    const { ID_Kien, ID_ViTriKho } = req.body || {};

    if (!ID_Kien || !ID_ViTriKho) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu dữ liệu",
      });
    }

    const pool = await tagpoolPromise;

    const result = await pool
      .request()
      .input("ID_Kien", sql.Int, ID_Kien)
      .input("ID_ViTriKho", sql.Int, ID_ViTriKho)
      .execute("sp_UpdateViTriKienPL");

    const response = result.recordset?.[0];

    if (!response || response.StatusCode !== 1) {
      return res.status(400).json({
        ok: false,
        message: response?.Message || "Cập nhật thất bại",
      });
    }

    return res.json({
      ok: true,
      message: response.Message,
    });
  } catch (err) {
    console.error("updatevitrikien PL error:", err);
    return res.status(500).json({
      ok: false,
      message: "Lỗi máy chủ",
      detail: err?.message,
    });
  }
});

function getQrCodesFromBody(req) {
  const { qrCodes, QRCodes, QRCode } = req.body || {};

  if (Array.isArray(qrCodes)) return qrCodes;
  if (Array.isArray(QRCodes)) return QRCodes;
  if (typeof QRCode === "string") return [QRCode];

  return [];
}

function normalizeQrCodes(qrCodes = []) {
  return [
    ...new Set(
      qrCodes.map((item) => String(item || "").trim()).filter(Boolean),
    ),
  ];
}

function buildQrCodeTable(qrCodes = []) {
  const table = new sql.Table("QrCodeListType");
  table.columns.add("QRCode", sql.NVarChar(100), { nullable: false });

  normalizeQrCodes(qrCodes).forEach((qrCode) => {
    table.rows.add(qrCode);
  });

  return table;
}

function validateQrCodes(req, res) {
  const qrCodes = normalizeQrCodes(getQrCodesFromBody(req));

  if (!qrCodes.length) {
    res.status(400).json({
      ok: false,
      message: "Thiếu danh sách qrCodes",
    });
    return null;
  }

  return qrCodes;
}

router.post("/phieuxuat/phu-lieu/kien/scan-batch", async (req, res) => {
  try {
    const qrCodes = validateQrCodes(req, res);
    if (!qrCodes) return;

    const pool = await tagpoolPromise;
    const qrTable = buildQrCodeTable(qrCodes);

    const result = await pool
      .request()
      .input("QrCodes", qrTable)
      .execute("App_PhieuXuatVT_ScanBatchKien");

    return res.json({
      ok: true,
      data: result.recordset || [],
    });
  } catch (err) {
    console.error("App_PhieuXuatVT_ScanBatchKien error:", err);
    return res.status(500).json({
      ok: false,
      message: "Lỗi máy chủ",
      detail: err?.message,
    });
  }
});

router.post("/phieuxuat/phu-lieu/tim-phieu-theo-kien", async (req, res) => {
  try {
    const qrCodes = validateQrCodes(req, res);
    if (!qrCodes) return;

    const pool = await tagpoolPromise;
    const qrTable = buildQrCodeTable(qrCodes);

    const result = await pool
      .request()
      .input("QrCodes", qrTable)
      .execute("App_TimKiem_PhieuXuatVT_ByBatchKien");

    return res.json({
      ok: true,
      data: result.recordset || [],
    });
  } catch (err) {
    console.error("App_TimKiem_PhieuXuatVT_ByBatchKien error:", err);
    return res.status(500).json({
      ok: false,
      message: "Lỗi máy chủ",
      detail: err?.message,
    });
  }
});

router.post(
  "/phieuxuat/phu-lieu/:idPhieuXuat/kien/batch-chitiet",
  async (req, res) => {
    try {
      const idPhieuXuat = Number(req.params.idPhieuXuat);
      const qrCodes = validateQrCodes(req, res);
      if (!qrCodes) return;
      if (!Number.isInteger(idPhieuXuat) || idPhieuXuat <= 0) {
        return res.status(400).json({
          ok: false,
          message: "Sai idPhieuXuat",
        });
      }

      const pool = await tagpoolPromise;
      const qrTable = buildQrCodeTable(qrCodes);

      const result = await pool
        .request()
        .input("ID_PhieuXuatVT", sql.Int, idPhieuXuat)
        .input("QrCodes", qrTable)
        .execute("App_ChiTiet_PhieuXuatVT_ByBatchKien");

      return res.json({
        ok: true,
        data: result.recordset || [],
      });
    } catch (err) {
      console.error("App_ChiTiet_PhieuXuatVT_ByBatchKien error:", err);
      return res.status(500).json({
        ok: false,
        message: "Lỗi máy chủ",
        detail: err?.message,
      });
    }
  },
);

router.post("/giamdinhvt-detail", async (req, res) => {
  try {
    const rawId =
      req.body?.id ??
      req.body?.ID_GiamDinhVT ??
      req.query?.id ??
      req.query?.ID_GiamDinhVT;
    const id = Number.parseInt(rawId, 10);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Thiếu hoặc sai ID_GiamDinhVT",
      });
    }

    const pool = await tagpoolPromise;
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("select * from fn_GetChiTietGiamDinhVT(@Id)");

    return res.json({
      ok: true,
      data: result.recordset || [],
    });
  } catch (err) {
    console.error("giamdinhvt-detail error:", err);
    return res.status(500).json({
      ok: false,
      message: "Lỗi máy chủ",
      detail: err?.message,
    });
  }
});

module.exports = router;
