const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const sql = require('mssql');
const { poolPromise } = require('../db');
const checkApiKey = require('../middleware/apiKey');

const router = express.Router();

// The ERP stores legacy passwords as an MD5 hash of the .NET ASCII bytes.
function legacyMd5Password(value) {
    const text = String(value || '');
    const asciiBytes = Buffer.alloc(text.length);
    for (let index = 0; index < text.length; index += 1) {
        const codeUnit = text.charCodeAt(index);
        asciiBytes[index] = codeUnit <= 0x7f ? codeUnit : 0x3f;
    }
    return crypto.createHash('md5').update(asciiBytes).digest('hex');
}

function toBoolean(value) {
    return value === true || value === 1;
}

/**
 * A standalone ERP login endpoint for consumers which need function-level
 * permissions. It deliberately does not alter the legacy /auth/login flow.
 */
router.post('/loginERP', checkApiKey, async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
        return res.status(400).json({ message: 'Thiếu tên đăng nhập hoặc mật khẩu.' });
    }

    try {
        const pool = await poolPromise;
        const accountResult = await pool.request()
            .input('Username', sql.NVarChar(50), username)
            .input('PasswordMd5', sql.NVarChar(32), legacyMd5Password(password))
            .query(`
                SELECT TOP (1)
                    id = tk.ID_TaiKhoanDangNhap,
                    userId = tk.ID_TaiKhoanDangNhap,
                    username = tk.TenDangNhap,
                    fullName = COALESCE(NULLIF(tk.TenDayDu, N''), tk.TenDangNhap),
                    idDonVi = tk.ID_DonVi,
                    idBoPhan = tk.ID_BoPhan,
                    idChucVu = tk.ID_ChucVu,
                    idNhanSu = tk.ID_NhanSu,
                    email = tk.Email
                FROM TAG_System.dbo.TaiKhoanDangNhap AS tk
                WHERE tk.TenDangNhap = @Username
                  AND LOWER(tk.MatKhau) = @PasswordMd5
                  AND tk.SuDung = 1
                  AND tk.TonTai = 1;
            `);
        const userInfo = accountResult.recordset[0];

        if (!userInfo) {
            return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không hợp lệ.' });
        }

        const permissionResult = await pool.request()
            .input('UserId', sql.SmallInt, userInfo.id)
            .query(`
                SELECT
                    idChucNang = cn.ID_ChucNang,
                    idNhomChucNang = cn.ID_NhomChucNang,
                    maChucNang = cn.Ma_ChucNang,
                    tenChucNang = cn.Ten_ChucNang,
                    sttChucNang = cn.STT_ChucNang,
                    xem = CAST(tkcn.Xem AS bit),
                    capNhat = CAST(tkcn.CapNhat AS bit)
                FROM TAG_System.dbo.PQ_TaiKhoan_ChucNang AS tkcn
                INNER JOIN TAG_System.dbo.PQ_DM_ChucNang AS cn
                    ON cn.ID_ChucNang = tkcn.ID_ChucNang
                WHERE tkcn.ID_TaiKhoanDangNhap = @UserId
                  AND cn.TonTai = 1
                ORDER BY cn.ID_NhomChucNang, cn.STT_ChucNang, cn.ID_ChucNang;

                SELECT
                    idPhanMem = pm.ID_PhanMem,
                    tenPhanMem = pm.Ten_PhanMem,
                    idDonVi = tkpm.ID_DonVi,
                    phanQuyen = CAST(tkpm.PhanQuyen AS bit)
                FROM TAG_System.dbo.PQ_TaiKhoan_PhanMem_DonVi AS tkpm
                INNER JOIN TAG_System.dbo.DM_PhanMem AS pm
                    ON pm.ID_PhanMem = tkpm.ID_PhanMem
                WHERE tkpm.ID_TaiKhoanDangNhap = @UserId
                  AND pm.SuDung = 1
                  AND pm.TonTai = 1
                ORDER BY pm.ID_PhanMem, tkpm.ID_DonVi;
            `);

        const permissions = (permissionResult.recordsets?.[0] || []).map((row) => ({
            ...row,
            xem: toBoolean(row.xem),
            capNhat: toBoolean(row.capNhat),
        }));
        const applicationsById = new Map();
        for (const row of permissionResult.recordsets?.[1] || []) {
            const existing = applicationsById.get(row.idPhanMem) || {
                idPhanMem: row.idPhanMem,
                tenPhanMem: row.tenPhanMem,
                donVi: [],
            };
            if (row.idDonVi !== null && row.idDonVi !== undefined && !existing.donVi.some((donVi) => donVi.idDonVi === row.idDonVi)) {
                existing.donVi.push({
                    idDonVi: row.idDonVi,
                    phanQuyen: toBoolean(row.phanQuyen),
                });
            }
            applicationsById.set(row.idPhanMem, existing);
        }

        const accessToken = jwt.sign(
            { userId: userInfo.id, username: userInfo.username },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: process.env.AUTH_TOKEN_TTL || '8h' }
        );

        return res.json({
            accessToken,
            userInfo,
            permissionCodes: permissions.map((permission) => permission.maChucNang).filter(Boolean),
            permissions,
            applications: [...applicationsById.values()],
        });
    } catch (error) {
        console.error('[AUTH] ERP permission login failed:', error.code || error.message);
        return res.status(500).json({ message: 'Không thể xử lý đăng nhập và lấy quyền.' });
    }
});

module.exports = router;
