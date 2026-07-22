const express = require('express')
const router = express.Router()
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const { testpoolPromise } = require('../dbtest');
const sql = require('mssql');



router.post('/getthongtinkien', async (req, res) => {
    try {
        const { QRCode } = req.body || {};
        if (!QRCode || typeof QRCode !== 'string' || !QRCode.trim()) {
            return res.status(400).json({ ok: false, message: 'Thiếu hoặc sai QRCode' });
        }

        const pool = await testpoolPromise;
        const result = await pool
            .request()
            .input('QRCode', sql.NVarChar(100), QRCode.trim())
            .execute('sp_GetThongTinTheoQRCode');
        const recordset = result.recordset || [];
        if (recordset.length === 0) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy thông tin kiện' });
        }
        return res.json({ ok: true, data: recordset });
    } catch (err) {
        console.error('getthongtinkien SP error:', err);
        return res.status(500).json({ ok: false, message: 'Lỗi máy chủ', detail: err?.message });
    }
});

router.post('/find-by-qr', /* verifyToken, */ async (req, res) => {
    try {
        const { qrcode, startDate, endDate } = req.body || {};
        if (!qrcode || typeof qrcode !== 'string' || !qrcode.trim()) {
            return res.status(400).json({ ok: false, message: 'Thiếu hoặc sai QRCode' });
        }

        const pool = await testpoolPromise;

        // GỌI STORED PROCEDURE
        const result = await pool
            .request()
            .input('QRCode', sql.NVarChar(100), qrcode.trim())
            .input('StartDate', sql.Date, startDate || null)
            .input('EndDate', sql.Date, endDate || null)
            .execute('sp_KhoTM_PXK_FindByQRCode');

        // recordsets: [KQ1, KQ2, KQ3, KQ4]
        const headerKien = result.recordsets?.[0]?.[0] || null; // 1 kiện mới nhất
        const chiTietKien = result.recordsets?.[1] || [];
        const phieuPicked = result.recordsets?.[2] || []; // phiếu đã pick
        const phieuSuggest = result.recordsets?.[3] || []; // phiếu gợi ý thêm

        // ---- OPTIONAL: gộp phiếu → pick để UI dễ hiển thị ----
        const groupedPicked = phieuPicked.reduce((acc, p) => {
            let grp = acc.find(x => x.ID_PhieuXuatBTP === p.ID_PhieuXuatBTP);
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
            let grp = acc.find(x => x.ID_PhieuXuatBTP === p.ID_PhieuXuatBTP);
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
        console.error('find-by-qr SP error:', err);
        return res.status(500).json({ ok: false, message: 'Lỗi máy chủ', detail: err?.message });
    }
});

router.post('/phieu-detail', async (req, res) => {
    try {
        const { idPhieuXuat } = req.body || {};
        if (!idPhieuXuat) {
            return res.status(400).json({ ok: false, message: 'Thiếu ID_PhieuXuatBTP' });
        }

        const pool = await testpoolPromise;
        const result = await pool
            .request()
            .input('ID_PhieuXuatBTP', sql.Int, idPhieuXuat)
            .execute('sp_KhoTM_PXK_GetDetailByPhieu');

        const details = result.recordset || [];

        return res.json({
            ok: true,
            data: details,
        });
    } catch (err) {
        console.error('phieu-detail SP error:', err);
        return res.status(500).json({ ok: false, message: 'Lỗi máy chủ', detail: err?.message });
    }
});

router.post('/insert-pick', async (req, res) => {
    try {
        const { idPhieuXuat, qrcode } = req.body || {};
        if (!idPhieuXuat || !qrcode) {
            return res.status(400).json({ ok: false, message: 'Thiếu tham số idPhieuXuat hoặc qrcode' });
        }

        const pool = await testpoolPromise;

        const result = await pool
            .request()
            .input('ID_PhieuXuatBTP', sql.Int, idPhieuXuat)
            .input('QRCode', sql.NVarChar(100), qrcode)
            .execute('sp_KhoTM_InsertPick');

        const recordset = result.recordset || [];

        if (recordset.length > 0 && recordset[0].Inserted === 1) {
            return res.json({
                ok: true,
                message: recordset[0].Reason,
                data: recordset
            });
        } else {
            return res.json({
                ok: false,
                message: recordset[0]?.Reason || 'Không insert được',
                data: recordset
            });
        }
    } catch (err) {
        console.error('insert-pick SP error:', err);
        return res.status(500).json({ ok: false, message: 'Lỗi máy chủ', detail: err?.message });
    }
});

router.post('/phieu-line-remaining', async (req, res) => {
    try {
        const { idPhieuXuat } = req.body || {};
        if (!idPhieuXuat) {
            return res.status(400).json({ ok: false, message: 'Thiếu tham số' });
        }

        const pool = await testpoolPromise;
        const result = await pool.request()
            .input('ID_PhieuXuatBTP', sql.Int, idPhieuXuat)
            .query(`
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
        if (!row) return res.json({ ok: false, message: 'Không tìm thấy dòng phiếu' });

        return res.json({
            ok: true,
            soLuongYeuCau: Number(row.SoLuongYeuCau || 0),
            daPick: Number(row.DaPick || 0),
            conLaiPhieu: Math.max(0, Number(row.ConLaiPhieu || 0)),
        });
    } catch (err) {
        console.error('phieu-line-remaining error:', err);
        res.status(500).json({ ok: false, message: 'Lỗi máy chủ', detail: err?.message });
    }
});

router.post('/merge-kien', async (req, res) => {
    try {
        const { targetPackageId, detailIds } = req.body || {};

        // Validate input
        if (!targetPackageId || !Array.isArray(detailIds) || detailIds.length === 0) {
            return res.status(400).json({
                ok: false,
                message: 'Thiếu targetPackageId hoặc detailIds'
            });
        }

        // Chuẩn hoá mảng id (toàn số nguyên dương)
        const ids = detailIds
            .map(x => parseInt(x, 10))
            .filter(x => Number.isInteger(x) && x > 0);

        if (ids.length === 0) {
            return res.status(400).json({ ok: false, message: 'detailIds không hợp lệ' });
        }

        const idsIn = ids.join(','); // ví dụ: "1,2,3"
        const pool = await testpoolPromise;

        const result = await pool.request()
            .input('TargetId', sql.Int, parseInt(targetPackageId, 10))
            .query(`
        SET NOCOUNT ON;
        SET XACT_ABORT ON;

        BEGIN TRY
            BEGIN TRAN;

            DECLARE @updated INT = 0;
            DECLARE @deactivated INT = 0;

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
        console.error('merge-kien error:', err);
        return res.status(500).json({
            ok: false,
            message: 'Lỗi máy chủ',
            detail: err?.message
        });
    }
});



router.post('/split-kien', async (req, res) => {
    try {
        const { sourcePackageId, phieuNhapId, qrCode, viTriKhoId, tonTai, chiTiet } = req.body || {};

        if (!sourcePackageId || !qrCode || !viTriKhoId || !Array.isArray(chiTiet) || chiTiet.length === 0) {
            return res.status(400).json({ ok: false, message: 'Thiếu dữ liệu tạo kiện' });
        }

        const pool = await testpoolPromise;
        const tx = new sql.Transaction(pool);
        await tx.begin();

        try {
            const src = await new sql.Request(tx)
                .input('SourceId', sql.Int, sourcePackageId)
                .query(`
                    SELECT DauTuan
                    FROM TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK)
                    WHERE ID_TheKhoKienBTP = @SourceId
                `);

            if (src.recordset.length === 0) {
                throw new Error('Không tìm thấy kiện gốc');
            }

            const dauTuanFromSource = src.recordset[0].DauTuan;   // 0 / 1 / NULL
            // A) CHECK QR CODE TỒN TẠI (chỉ tính bản ghi còn hiệu lực)
            const dup = await new sql.Request(tx)
                .input('QRCode', sql.NVarChar(100), qrCode)
                .query(`
          SELECT TOP 1 ID_TheKhoKienBTP
          FROM TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK)
          WHERE QRCode = @QRCode
        `);

            if (dup.recordset.length > 0) {
                await tx.rollback();
                return res.status(409).json({ ok: false, message: 'QRCode đã tồn tại, không thể tạo mới' });
            }

            // 1) Tạo kiện mới
            const rNew = await new sql.Request(tx)
                .input('PhieuNhapId', sql.Int, phieuNhapId || null)
                .input('QRCode', sql.NVarChar(100), qrCode)
                .input('ViTriKhoId', sql.Int, viTriKhoId)
                .input('DauTuan', sql.Int, dauTuanFromSource)
                .input('TonTai', sql.Bit, tonTai ?? 1)
                .query(`
          INSERT INTO TheKhoKienBTP (ID_PhieuNhapBTP, QRCode, ID_ViTriKho, TonTai, ID_TheKhoKienBTP_Xuat, ID_PhieuXuatBTP, SoKien, DauTuan)
          VALUES (@PhieuNhapId, @QRCode, @ViTriKhoId, @TonTai, NULL, NULL, NULL, @DauTuan);
          SELECT CAST(SCOPE_IDENTITY() AS INT) AS NewKienId;
        `);

            const newKienId = rNew.recordset?.[0]?.NewKienId;

            // 2) Với từng chi tiết: insert vào kiện mới + giảm đúng dòng ở kiện gốc
            for (const ct of chiTiet) {
                const soLuongTach = Number(ct.SoLuong || 0);
                if (!soLuongTach || soLuongTach <= 0) continue;

                // 2a) Insert chi tiết kiện mới
                await new sql.Request(tx)
                    .input('NewKienId', sql.Int, newKienId)
                    .input('DonHangSanPhamId', sql.Int, ct.ID_DonHang_SanPham || null)
                    .input('SoLuong', sql.Int, soLuongTach)
                    .input('ItemCode', sql.NVarChar(50), ct.ItemCode || null)
                    .input('TenSanPham', sql.NVarChar(200), ct.Ten_SanPham || null)
                    .input('TonTai', sql.Bit, 1)
                    .input('ID_DonHang', sql.Int, ct.ID_DonHang || null)
                    .input('ID_QuyTrinhSanXuat', sql.Int, ct.ID_QuyTrinhSanXuat || null)
                    .input('Ten_QuyTrinhSanXuat', sql.NVarChar(200), ct.Ten_QuyTrinhSanXuat || null)
                    .input('ID_DonHang_LoSanXuat', sql.Int, ct.ID_DonHang_LoSanXuat || 0)
                    .input('ID_KeHoachSanXuat', sql.Int, ct.ID_KeHoachSanXuat || 0)
                    .input('ID_PhieuNhapBTP', sql.Int, phieuNhapId || null)
                    .query(`
            INSERT INTO TheKhoKienBTP_ChiTiet
              (ID_TheKhoKienBTP, ID_DonHang_SanPham, SoLuong, ItemCode, Ten_SanPham, TonTai, ID_DonHang, ID_QuyTrinhSanXuat, Ten_QuyTrinhSanXuat, ID_KeHoachSanXuat, ID_PhieuNhapBTP, ID_DonHang_LoSanXuat)
            VALUES
              (@NewKienId, @DonHangSanPhamId, @SoLuong, @ItemCode, @TenSanPham, @TonTai, @ID_DonHang, @ID_QuyTrinhSanXuat, @Ten_QuyTrinhSanXuat, @ID_KeHoachSanXuat, @ID_PhieuNhapBTP, @ID_DonHang_LoSanXuat);
          `);

                // 2b) Trừ đúng dòng chi tiết ở kiện gốc
                const reqUpdate = new sql.Request(tx)
                    .input('SourceId', sql.Int, sourcePackageId)
                    .input('SoLuong', sql.Int, soLuongTach);

                let updateSql, rUpd;
                if (ct.ID_TheKhoKienBTP_ChiTiet) {
                    // ưu tiên theo ID chi tiết
                    rUpd = await reqUpdate
                        .input('DetailId', sql.Int, ct.ID_TheKhoKienBTP_ChiTiet)
                        .query(`
              UPDATE TheKhoKienBTP_ChiTiet WITH (ROWLOCK, UPDLOCK)
              SET SoLuong = SoLuong - @SoLuong
              WHERE ID_TheKhoKienBTP = @SourceId
                AND ID_TheKhoKienBTP_ChiTiet = @DetailId
                AND SoLuong >= @SoLuong;
              SELECT @@ROWCOUNT AS affected;
            `);
                } else {
                    // fallback (kém an toàn): theo ID_DonHang_SanPham, trừ 1 dòng gần nhất
                    rUpd = await reqUpdate
                        .input('DonHangSanPhamId', sql.Int, ct.ID_DonHang_SanPham)
                        .query(`
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
                    throw new Error(`Không thể trừ số lượng (thiếu dòng/không đủ tồn) cho ID_DonHang_SanPham=${ct.ID_DonHang_SanPham}`);
                }
            }

            await tx.commit();
            return res.json({ ok: true, newKienId, inserted: chiTiet.length });
        } catch (e) {
            await tx.rollback();
            console.error('split-kien error:', e);
            return res.status(500).json({ ok: false, message: 'Lỗi máy chủ', detail: e.message });
        }
    } catch (err) {
        console.error('split-kien error OUTER:', err);
        return res.status(500).json({ ok: false, message: 'Lỗi máy chủ', detail: err?.message });
    }
});


function getQrCodesFromBody(req) {
    const { qrCodes, QRCodes, QRCode } = req.body || {};

    if (Array.isArray(qrCodes)) return qrCodes;
    if (Array.isArray(QRCodes)) return QRCodes;
    if (typeof QRCode === 'string') return [QRCode];

    return [];
}

function normalizeQrCodes(qrCodes = []) {
    return [...new Set(
        qrCodes
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    )];
}

function buildQrCodeTable(qrCodes = []) {
    const table = new sql.Table('QrCodeListType');
    table.columns.add('QRCode', sql.NVarChar(100), { nullable: false });

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
            message: 'Thiếu danh sách qrCodes',
        });
        return null;
    }

    return qrCodes;
}

router.post('/phieuxuat/phu-lieu/kien/scan-batch', async (req, res) => {
    try {
        const qrCodes = validateQrCodes(req, res);
        if (!qrCodes) return;

        const pool = await testpoolPromise;
        const qrTable = buildQrCodeTable(qrCodes);

        const result = await pool
            .request()
            .input('QrCodes', qrTable)
            .execute('App_PhieuXuatVT_ScanBatchKien');

        return res.json({
            ok: true,
            data: result.recordset || [],
        });
    } catch (err) {
        console.error('App_PhieuXuatVT_ScanBatchKien error:', err);
        return res.status(500).json({
            ok: false,
            message: 'Lỗi máy chủ',
            detail: err?.message,
        });
    }
});

router.post('/phieuxuat/phu-lieu/tim-phieu-theo-kien', async (req, res) => {
    try {
        const qrCodes = validateQrCodes(req, res);
        if (!qrCodes) return;

        const pool = await testpoolPromise;
        const qrTable = buildQrCodeTable(qrCodes);

        const result = await pool
            .request()
            .input('QrCodes', qrTable)
            .execute('App_TimKiem_PhieuXuatVT_ByBatchKien');

        return res.json({
            ok: true,
            data: result.recordset || [],
        });
    } catch (err) {
        console.error('App_TimKiem_PhieuXuatVT_ByBatchKien error:', err);
        return res.status(500).json({
            ok: false,
            message: 'Lỗi máy chủ',
            detail: err?.message,
        });
    }
});

router.post('/phieuxuat/phu-lieu/:idPhieuXuat/kien/batch-chitiet', async (req, res) => {
    try {
        const idPhieuXuat = Number(req.params.idPhieuXuat);
        const qrCodes = validateQrCodes(req, res);
        if (!qrCodes) return;
        if (!Number.isInteger(idPhieuXuat) || idPhieuXuat <= 0) {
            return res.status(400).json({
                ok: false,
                message: 'Sai idPhieuXuat',
            });
        }

        const pool = await testpoolPromise;
        const qrTable = buildQrCodeTable(qrCodes);

        const result = await pool
            .request()
            .input('ID_PhieuXuatVT', sql.Int, idPhieuXuat)
            .input('QrCodes', qrTable)
            .execute('App_ChiTiet_PhieuXuatVT_ByBatchKien');

        return res.json({
            ok: true,
            data: result.recordset || [],
        });
    } catch (err) {
        console.error('App_ChiTiet_PhieuXuatVT_ByBatchKien error:', err);
        return res.status(500).json({
            ok: false,
            message: 'Lỗi máy chủ',
            detail: err?.message,
        });
    }
});

function isValidDateString(value) {
    if (typeof value !== 'string') return false;

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

/**
 * GET /kehoachsanxuat
 *
 * Lấy danh sách kế hoạch sản xuất từ ERP.
 * Stored procedure không có tham số đầu vào.
 */
router.get('/kehoachsanxuat', async (req, res) => {
    try {
        const pool = await testpoolPromise;

        const result = await pool.request()
            .execute('TAG_QLSX.dbo.NangSuat_Get_KeHoachSanXuat_Ngay');

        const keHoachSanXuat = result.recordset || [];

        return res.status(200).json({
            ok: true,
            count: keHoachSanXuat.length,
            keHoachSanXuat
        });
    } catch (error) {
        console.error('[GET /kehoachsanxuat] error:', error);

        return res.status(500).json({
            ok: false,
            message: error.message || 'Không thể lấy kế hoạch sản xuất.'
        });
    }
});

/**
 * POST /tiendosanxuat-mocgio
 *
 * Cập nhật tổng sản lượng của một mốc giờ.
 *
 * Lưu ý:
 * SoLuong_SanPham là tổng sản lượng hiện tại của mốc giờ,
 * không phải số lượng tăng thêm.
 */
router.post('/tiendosanxuat-mocgio', async (req, res) => {
    try {
        let {
            ID_KeHoachSanXuat,
            ID_DonHang_SanPham,
            ID_DonHang_LoSanXuat,
            NgayNhap,
            ID_MocGio,
            SoLuong_SanPham
        } = req.body || {};

        // Chuẩn hóa các trường số
        ID_KeHoachSanXuat = Number(ID_KeHoachSanXuat);
        ID_DonHang_SanPham = Number(ID_DonHang_SanPham);
        ID_DonHang_LoSanXuat = Number(ID_DonHang_LoSanXuat);
        ID_MocGio = Number(ID_MocGio);
        SoLuong_SanPham = Number(SoLuong_SanPham);

        if (
            !Number.isInteger(ID_KeHoachSanXuat) ||
            ID_KeHoachSanXuat <= 0
        ) {
            return res.status(400).json({
                ok: false,
                message: 'ID_KeHoachSanXuat không hợp lệ.'
            });
        }

        if (
            !Number.isInteger(ID_DonHang_SanPham) ||
            ID_DonHang_SanPham <= 0
        ) {
            return res.status(400).json({
                ok: false,
                message: 'ID_DonHang_SanPham không hợp lệ.'
            });
        }

        if (
            !Number.isInteger(ID_DonHang_LoSanXuat) ||
            ID_DonHang_LoSanXuat <= 0
        ) {
            return res.status(400).json({
                ok: false,
                message: 'ID_DonHang_LoSanXuat không hợp lệ.'
            });
        }

        if (
            !Number.isInteger(ID_MocGio) ||
            ID_MocGio < 0 ||
            ID_MocGio > 255
        ) {
            return res.status(400).json({
                ok: false,
                message: 'ID_MocGio không hợp lệ, giá trị phải từ 0 đến 255.'
            });
        }

        if (
            !Number.isFinite(SoLuong_SanPham) ||
            SoLuong_SanPham < 0
        ) {
            return res.status(400).json({
                ok: false,
                message: 'SoLuong_SanPham không hợp lệ hoặc nhỏ hơn 0.'
            });
        }

        // DECIMAL(18,2) chỉ cho phép tối đa 2 chữ số thập phân
        if (!Number.isInteger(SoLuong_SanPham * 100)) {
            return res.status(400).json({
                ok: false,
                message: 'SoLuong_SanPham chỉ được có tối đa 2 chữ số thập phân.'
            });
        }

        if (!isValidDateString(NgayNhap)) {
            return res.status(400).json({
                ok: false,
                message: 'NgayNhap không hợp lệ, định dạng yêu cầu là yyyy-MM-dd.'
            });
        }

        const pool = await testpoolPromise;

        const result = await pool.request()
            .input('ID_KeHoachSanXuat', sql.Int, ID_KeHoachSanXuat)
            .input('ID_DonHang_SanPham', sql.Int, ID_DonHang_SanPham)
            .input('ID_DonHang_LoSanXuat', sql.Int, ID_DonHang_LoSanXuat)
            .input('NgayNhap', sql.Date, NgayNhap)
            .input('ID_MocGio', sql.TinyInt, ID_MocGio)
            .input('SoLuong_SanPham', sql.Decimal(18, 2), SoLuong_SanPham)
            .execute('TAG_QLSX.dbo.NangSuat_TienDoSanSuat_MocGio_CNPN');

        return res.status(200).json({
            ok: true,
            message: 'Cập nhật tiến độ sản xuất theo mốc giờ thành công.',
            data: {
                ID_KeHoachSanXuat,
                ID_DonHang_SanPham,
                ID_DonHang_LoSanXuat,
                NgayNhap,
                ID_MocGio,
                SoLuong_SanPham
            },
            rowsAffected: result.rowsAffected || []
        });
    } catch (error) {
        console.error('[POST /tiendosanxuat-mocgio] error:', error);

        return res.status(500).json({
            ok: false,
            message:
                error.message ||
                'Không thể cập nhật tiến độ sản xuất theo mốc giờ.'
        });
    }
});

router.post(
    '/thongtin-tiendosanxuat-mocgio',
    async (req, res) => {
        try {
            let {
                ID_KeHoachSanXuat,
                ID_DonHang_SanPham,
                ID_DonHang_LoSanXuat,
                NgayNhap
            } = req.body || {};

            ID_KeHoachSanXuat = Number(
                ID_KeHoachSanXuat
            );

            ID_DonHang_SanPham = Number(
                ID_DonHang_SanPham
            );

            ID_DonHang_LoSanXuat = Number(
                ID_DonHang_LoSanXuat
            );

            if (
                !Number.isInteger(ID_KeHoachSanXuat) ||
                ID_KeHoachSanXuat <= 0
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        'ID_KeHoachSanXuat không hợp lệ.'
                });
            }

            if (
                !Number.isInteger(ID_DonHang_SanPham) ||
                ID_DonHang_SanPham <= 0
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        'ID_DonHang_SanPham không hợp lệ.'
                });
            }

            if (
                !Number.isInteger(ID_DonHang_LoSanXuat) ||
                ID_DonHang_LoSanXuat <= 0
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        'ID_DonHang_LoSanXuat không hợp lệ.'
                });
            }

            if (
                typeof NgayNhap !== 'string' ||
                !/^\d{4}-\d{2}-\d{2}$/.test(NgayNhap)
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        'NgayNhap phải có định dạng yyyy-MM-dd.'
                });
            }

            const pool = await testpoolPromise;

            const result = await pool.request()
                .input(
                    'ID_KeHoachSanXuat',
                    sql.Int,
                    ID_KeHoachSanXuat
                )
                .input(
                    'ID_DonHang_SanPham',
                    sql.Int,
                    ID_DonHang_SanPham
                )
                .input(
                    'ID_DonHang_LoSanXuat',
                    sql.Int,
                    ID_DonHang_LoSanXuat
                )
                .input(
                    'NgayNhap',
                    sql.Date,
                    NgayNhap
                )
                .execute(
                    'TAG_QLSX.dbo.NangSuat_Get_TienDoSanXuat_MocGio'
                );

            const danhSachMocGio =
                result.recordsets?.[0] || [];

            const thongTinTong =
                result.recordsets?.[1]?.[0] || {
                    TongSoLuong_SanPham: 0
                };

            return res.status(200).json({
                ok: true,
                data: {
                    ID_KeHoachSanXuat,
                    ID_DonHang_SanPham,
                    ID_DonHang_LoSanXuat,
                    NgayNhap,

                    TongSoLuong_SanPham:
                        thongTinTong.TongSoLuong_SanPham,

                    danhSachMocGio
                }
            });
        } catch (error) {
            console.error(
                '[POST /thongtin-tiendosanxuat-mocgio] error:',
                error
            );

            return res.status(500).json({
                ok: false,
                message:
                    error.message ||
                    'Không thể lấy tiến độ sản xuất.'
            });
        }
    }
);

router.post('/chatluong-mocgio', async (req, res) => {
    try {
        let {
            ID_KeHoachSanXuat,
            ID_DonHang_SanPham,
            ID_DonHang_LoSanXuat,
            NgayNhap,
            ID_MocGio,
            SoLuong_Dat,
            SoLuong_KhongDat,
            DanhSachLoi
        } = req.body || {};

        DanhSachLoi = Array.isArray(DanhSachLoi)
            ? DanhSachLoi
            : [];

        ID_KeHoachSanXuat =
            Number(ID_KeHoachSanXuat);

        ID_DonHang_SanPham =
            Number(ID_DonHang_SanPham);

        ID_DonHang_LoSanXuat =
            Number(ID_DonHang_LoSanXuat);

        ID_MocGio = Number(ID_MocGio);
        SoLuong_Dat = Number(SoLuong_Dat);
        SoLuong_KhongDat = Number(SoLuong_KhongDat);

        if (
            !Number.isInteger(ID_KeHoachSanXuat) ||
            ID_KeHoachSanXuat <= 0
        ) {
            return res.status(400).json({
                ok: false,
                message:
                    'ID_KeHoachSanXuat không hợp lệ.'
            });
        }

        if (
            !Number.isInteger(ID_DonHang_SanPham) ||
            ID_DonHang_SanPham <= 0
        ) {
            return res.status(400).json({
                ok: false,
                message:
                    'ID_DonHang_SanPham không hợp lệ.'
            });
        }

        if (
            !Number.isInteger(ID_DonHang_LoSanXuat) ||
            ID_DonHang_LoSanXuat <= 0
        ) {
            return res.status(400).json({
                ok: false,
                message:
                    'ID_DonHang_LoSanXuat không hợp lệ.'
            });
        }

        if (
            !Number.isInteger(ID_MocGio) ||
            ID_MocGio <= 0 ||
            ID_MocGio > 255
        ) {
            return res.status(400).json({
                ok: false,
                message: 'ID_MocGio không hợp lệ.'
            });
        }

        if (
            typeof NgayNhap !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(NgayNhap)
        ) {
            return res.status(400).json({
                ok: false,
                message:
                    'NgayNhap phải có định dạng yyyy-MM-dd.'
            });
        }

        if (
            !Number.isFinite(SoLuong_Dat) ||
            SoLuong_Dat < 0
        ) {
            return res.status(400).json({
                ok: false,
                message: 'SoLuong_Dat không hợp lệ.'
            });
        }

        if (
            !Number.isFinite(SoLuong_KhongDat) ||
            SoLuong_KhongDat < 0
        ) {
            return res.status(400).json({
                ok: false,
                message:
                    'SoLuong_KhongDat không hợp lệ.'
            });
        }

        const maLoiDaCo = new Set();

        for (
            let index = 0;
            index < DanhSachLoi.length;
            index++
        ) {
            const loi = DanhSachLoi[index];

            if (
                typeof loi.MaLoi !== 'string' ||
                loi.MaLoi.trim() === ''
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        `DanhSachLoi[${index}].MaLoi không hợp lệ.`
                });
            }

            if (
                typeof loi.TenLoi !== 'string' ||
                loi.TenLoi.trim() === ''
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        `DanhSachLoi[${index}].TenLoi không hợp lệ.`
                });
            }

            const maLoi = loi.MaLoi.trim();

            if (maLoiDaCo.has(maLoi)) {
                return res.status(400).json({
                    ok: false,
                    message:
                        `Mã lỗi ${maLoi} bị trùng trong DanhSachLoi.`
                });
            }

            maLoiDaCo.add(maLoi);

            loi.MaLoi = maLoi;
            loi.TenLoi = loi.TenLoi.trim();
            loi.SoLuong_Loi =
                Number(loi.SoLuong_Loi);

            if (
                !Number.isFinite(loi.SoLuong_Loi) ||
                loi.SoLuong_Loi < 0
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        `DanhSachLoi[${index}].SoLuong_Loi không hợp lệ.`
                });
            }

            if (
                loi.ThoiGian_CapNhat &&
                Number.isNaN(
                    Date.parse(loi.ThoiGian_CapNhat)
                )
            ) {
                return res.status(400).json({
                    ok: false,
                    message:
                        `DanhSachLoi[${index}].ThoiGian_CapNhat không hợp lệ.`
                });
            }
        }

        const pool = await testpoolPromise;

        const result = await pool.request()
            .input(
                'ID_KeHoachSanXuat',
                sql.Int,
                ID_KeHoachSanXuat
            )
            .input(
                'ID_DonHang_SanPham',
                sql.Int,
                ID_DonHang_SanPham
            )
            .input(
                'ID_DonHang_LoSanXuat',
                sql.Int,
                ID_DonHang_LoSanXuat
            )
            .input(
                'NgayNhap',
                sql.Date,
                NgayNhap
            )
            .input(
                'ID_MocGio',
                sql.TinyInt,
                ID_MocGio
            )
            .input(
                'SoLuong_Dat',
                sql.Decimal(18, 2),
                SoLuong_Dat
            )
            .input(
                'SoLuong_KhongDat',
                sql.Decimal(18, 2),
                SoLuong_KhongDat
            )
            .input(
                'DanhSachLoi',
                sql.NVarChar(sql.MAX),
                JSON.stringify(DanhSachLoi)
            )
            .execute(
                'TAG_QLSX.dbo.NangSuat_Update_ChatLuong_MocGio'
            );

        const ketQua = result.recordsets?.[0]?.[0];
        const danhSachLoiDaLuu =
            result.recordsets?.[1] || [];

        if (!ketQua) {
            return res.status(500).json({
                ok: false,
                message:
                    'Stored procedure không trả kết quả.'
            });
        }

        if (!ketQua.Success) {
            return res.status(400).json({
                ok: false,
                message: ketQua.Message
            });
        }

        return res.status(200).json({
            ok: true,
            message: ketQua.Message,
            data: {
                ID_KeHoachSanXuat:
                    ketQua.ID_KeHoachSanXuat,
                ID_DonHang_SanPham:
                    ketQua.ID_DonHang_SanPham,
                ID_DonHang_LoSanXuat:
                    ketQua.ID_DonHang_LoSanXuat,
                Ngay: ketQua.Ngay,
                ID_MocGio: ketQua.ID_MocGio,
                SoLuong_Dat: ketQua.SoLuong_Dat,
                SoLuong_KhongDat:
                    ketQua.SoLuong_KhongDat,
                DanhSachLoi: danhSachLoiDaLuu
            }
        });
    } catch (error) {
        console.error(
            '[POST /chatluong-mocgio] error:',
            error
        );

        return res.status(500).json({
            ok: false,
            message:
                error.message ||
                'Không thể cập nhật chất lượng và lỗi.'
        });
    }
});
module.exports = router