const express = require('express')
const router = express.Router()
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const { testpoolPromise } = require('../dbtest');
const sql = require('mssql');


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

        const pool = await tagpoolPromise;
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

        const pool = await tagpoolPromise;

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

        const pool = await tagpoolPromise;
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
module.exports = router