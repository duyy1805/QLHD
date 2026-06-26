const express = require('express');
const router = express.Router();
const { poolPromise } = require('../db');
const sql = require('mssql');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const uploadDir = 'C:/DocumentsUpload/HoaDonDienTu/Upload';

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const originalName = path.basename(decodeMultipartFileName(file.originalname));
        cb(null, `${Date.now()}-${originalName}`);
    }
});

const upload = multer({ storage });

function decodeMultipartFileName(fileName) {
    return Buffer.from(fileName, 'latin1').toString('utf8');
}

function normalizeAttachmentName(fileName) {
    if (typeof fileName !== 'string' || !/(Ãƒ|Ã‚|Ã„|Ã¡Â»|Ã¡Âº|Ã°Å¸)/.test(fileName)) {
        return fileName;
    }

    const decodedName = decodeMultipartFileName(fileName);
    return decodedName.includes('\uFFFD') ? fileName : decodedName;
}

function resolveAttachmentPath(filePath) {
    if (!filePath) return null;
    if (fs.existsSync(filePath)) return filePath;

    const legacyPath = Buffer.from(filePath, 'utf8').toString('latin1');
    return fs.existsSync(legacyPath) ? legacyPath : null;
}

function httpError(res, err, fallback = 'Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.') {
    console.error(err);
    const code = err?.number || err?.code;
    const msg = err?.originalError?.info?.message || err.message || fallback;
    const http = String(code || '').startsWith('73') || String(code || '').startsWith('72') ? 400 : 500;
    return res.status(http).json({ message: msg, code });
}

function getRequester(req) {
    const fromToken = req.user || {};
    return {
        userId: Number(req.body?.requesterUserId || req.query?.userId || fromToken.userId || req.userId) || null,
        idDonVi: Number(req.body?.requesterIdDonVi || req.query?.idDonVi || fromToken.idDonVi) || null,
    };
}

function mapHoaDon(row) {
    if (!row) return null;
    return {
        id: row.HoaDonId,
        hoaDonId: row.HoaDonId,
        maDangKy: row.MaDangKy,
        maLoaiHoaDon: row.MaLoaiHoaDon,
        tenLoaiHoaDon: row.TenLoaiHoaDon,
        cheDoThue: row.CheDoThue,
        trangThaiId: row.TrangThaiId,
        maTrangThai: row.MaTrangThai,
        trangThai: row.MaTrangThai,
        tenTrangThai: row.TenTrangThai,
        nguoiMuaId: row.NguoiMuaId,
        tenNguoiMua: row.TenNguoiMua_Snapshot,
        maSoThue: row.MaSoThue_Snapshot,
        diaChi: row.DiaChi_Snapshot,
        nguoiLienHe: row.NguoiLienHe_Snapshot,
        email: row.Email_Snapshot,
        dienThoai: row.DienThoai_Snapshot,
        ngayHoaDon: row.NgayHoaDon,
        hinhThucThanhToan: row.HinhThucThanhToan,
        maLoaiTien: row.MaLoaiTien,
        tyGia: row.TyGia == null ? null : Number(row.TyGia),
        mauHoaDonDuKien: row.MauHoaDonDuKien,
        kyHieuDuKien: row.KyHieuDuKien,
        tongTienHang: row.TongTienHang == null ? null : Number(row.TongTienHang),
        tongTienThue: row.TongTienThue == null ? null : Number(row.TongTienThue),
        tongTienThanhToan: row.TongTienThanhToan == null ? null : Number(row.TongTienThanhToan),
        tongThanhToanQuyDoi: row.TongThanhToanQuyDoi == null ? null : Number(row.TongThanhToanQuyDoi),
        ghiChu: row.GhiChu,
        nguoiDangKyId: row.NguoiDangKyId,
        tenNguoiDangKy: row.TenNguoiDangKy,
        idDonVi: row.IdDonVi,
        tenDonVi: row.TenDonVi,
        ngayTao: row.NgayTao,
        ngayCapNhat: row.NgayCapNhat,
        ngayTrinh: row.NgayTrinh,
        soHoaDon: row.SoHoaDon,
        kyHieuHoaDon: row.KyHieuHoaDon,
        ngayPhatHanh: row.NgayPhatHanh,
        nguoiXacNhanId: row.NguoiXacNhanId,
        thoiDiemXacNhan: row.ThoiDiemXacNhan,
    };
}

function firstRecordset(result, index = 0) {
    return result.recordsets?.[index] || (index === 0 ? result.recordset || [] : []);
}

function addCommonInvoiceInputs(request, requester) {
    return request
        .input('RequesterUserId', sql.Int, requester.userId)
        .input('RequesterIdDonVi', sql.Int, requester.idDonVi);
}

/* ========================= ROLE / LOOKUP ========================= */

router.get('/role/:userId', async (req, res) => {
    try {
        const userId = Number(req.params.userId);
        if (!userId) return res.status(400).json({ message: 'userId không hợp lệ' });

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('UserId', sql.Int, userId)
            .query(`
                SELECT MaQuyen = cn.Ma_ChucNang
                FROM Tag_System.dbo.PQ_TaiKhoan_ChucNang pq
                JOIN Tag_System.dbo.PQ_DM_ChucNang cn ON cn.ID_ChucNang = pq.ID_ChucNang
                WHERE pq.ID_TaiKhoanDangNhap = @UserId
                  AND pq.CapNhat = 1
                  AND cn.TonTai = 1
                  AND cn.Ma_ChucNang IN (N'HD_TBP', N'HD_XuatHoaDon', N'HD_Admin', N'TBP', N'Admin');

                SELECT MaLoaiHoaDon
                FROM dbo.HD_NguoiPhuTrach
                WHERE UserId = @UserId AND TonTai = 1
                ORDER BY MaLoaiHoaDon;
            `);

        const permissions = (rs.recordsets?.[0] || []).map((row) => row.MaQuyen);
        const invoiceTypeCodes = (rs.recordsets?.[1] || []).map((row) => row.MaLoaiHoaDon);
        const role =
            permissions.includes('HD_Admin') || permissions.includes('Admin') ? 'HD_Admin' :
            permissions.includes('HD_XuatHoaDon') || invoiceTypeCodes.length ? 'HD_XuatHoaDon' :
            permissions.includes('HD_TBP') || permissions.includes('TBP') ? 'HD_TBP' :
            'NhanVien';

        res.json({ role, permissions, invoiceTypeCodes });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi lấy quyền hóa đơn điện tử.');
    }
});

router.get('/lookup', async (req, res) => {
    try {
        const pool = await poolPromise;
        const rs = await pool.request().query(`
            SELECT MaLoaiHoaDon, TenLoaiHoaDon, ThuTu
            FROM dbo.HD_LoaiHoaDon
            WHERE TonTai = 1
            ORDER BY ThuTu;

            SELECT TrangThaiId, MaTrangThai, TenTrangThai, ThuTu
            FROM dbo.HD_TrangThai
            ORDER BY ThuTu;
        `);

        res.json({
            loaiHoaDon: rs.recordsets?.[0] || [],
            trangThai: rs.recordsets?.[1] || [],
            cheDoThue: [
                { ma: 'MotThueSuat', ten: 'Một thuế suất' },
                { ma: 'NhieuThueSuat', ten: 'Nhiều thuế suất' },
            ],
            loaiTienPhoBien: ['VND', 'USD', 'EUR', 'JPY', 'CNY'],
        });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi lấy dữ liệu danh mục.');
    }
});

/* ========================= NGUOI MUA ========================= */

router.get('/nguoi-mua', async (req, res) => {
    try {
        const pool = await poolPromise;
        const rs = await pool.request()
            .input('TuKhoa', sql.NVarChar(300), req.query.tukhoa || req.query.tuKhoa || null)
            .input('Take', sql.Int, Number(req.query.take) || 100)
            .execute('HD_sp_NguoiMua_DanhSach');

        res.json(rs.recordset || []);
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi lấy danh sách người mua.');
    }
});

router.get('/nguoi-mua/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return res.status(400).json({ message: 'id không hợp lệ' });

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('NguoiMuaId', sql.Int, id)
            .execute('HD_sp_NguoiMua_GetById');

        const nguoiMua = firstRecordset(rs, 0)[0];
        if (!nguoiMua) return res.status(404).json({ message: 'Không tìm thấy người mua.' });

        res.json({
            ...nguoiMua,
            diaChi: firstRecordset(rs, 1),
            lienHe: firstRecordset(rs, 2),
            nganHang: firstRecordset(rs, 3),
        });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi lấy chi tiết người mua.');
    }
});

router.post('/nguoi-mua', async (req, res) => {
    try {
        const requester = getRequester(req);
        if (!requester.userId) return res.status(400).json({ message: 'Thiếu requesterUserId.' });

        const {
            maNguoiMua, tenPhapLy, maSoThue, soGiayTo, maDonVi,
            quocGia, laKhachHangNuocNgoai, ghiChu,
        } = req.body;

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('NguoiMuaId', sql.Int, null)
            .input('MaNguoiMua', sql.NVarChar(50), maNguoiMua || null)
            .input('TenPhapLy', sql.NVarChar(500), tenPhapLy)
            .input('MaSoThue', sql.NVarChar(50), maSoThue || null)
            .input('SoGiayTo', sql.NVarChar(50), soGiayTo || null)
            .input('MaDonVi', sql.NVarChar(100), maDonVi || null)
            .input('QuocGia', sql.NVarChar(100), quocGia || null)
            .input('LaKhachHangNuocNgoai', sql.Bit, laKhachHangNuocNgoai ? 1 : 0)
            .input('GhiChu', sql.NVarChar(1000), ghiChu || null)
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_NguoiMua_Luu');

        res.status(201).json(rs.recordset?.[0] || null);
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi tạo người mua.');
    }
});

router.put('/nguoi-mua/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const requester = getRequester(req);
        if (!id || !requester.userId) return res.status(400).json({ message: 'Thiếu id hoặc requesterUserId.' });

        const {
            maNguoiMua, tenPhapLy, maSoThue, soGiayTo, maDonVi,
            quocGia, laKhachHangNuocNgoai, ghiChu,
        } = req.body;

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('NguoiMuaId', sql.Int, id)
            .input('MaNguoiMua', sql.NVarChar(50), maNguoiMua || null)
            .input('TenPhapLy', sql.NVarChar(500), tenPhapLy)
            .input('MaSoThue', sql.NVarChar(50), maSoThue || null)
            .input('SoGiayTo', sql.NVarChar(50), soGiayTo || null)
            .input('MaDonVi', sql.NVarChar(100), maDonVi || null)
            .input('QuocGia', sql.NVarChar(100), quocGia || null)
            .input('LaKhachHangNuocNgoai', sql.Bit, laKhachHangNuocNgoai ? 1 : 0)
            .input('GhiChu', sql.NVarChar(1000), ghiChu || null)
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_NguoiMua_Luu');

        res.json(rs.recordset?.[0] || null);
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi cập nhật người mua.');
    }
});

router.delete('/nguoi-mua/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const requester = getRequester(req);
        if (!id || !requester.userId) return res.status(400).json({ message: 'Thiếu id hoặc requesterUserId.' });

        const pool = await poolPromise;
        await pool.request()
            .input('NguoiMuaId', sql.Int, id)
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_NguoiMua_Xoa');

        res.json({ success: true, id });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi xóa người mua.');
    }
});

router.post('/nguoi-mua/:id/dia-chi', async (req, res) => saveBuyerSubInfo(req, res, 'DiaChi'));
router.put('/nguoi-mua/:id/dia-chi/:subId', async (req, res) => saveBuyerSubInfo(req, res, 'DiaChi'));
router.post('/nguoi-mua/:id/lien-he', async (req, res) => saveBuyerSubInfo(req, res, 'LienHe'));
router.put('/nguoi-mua/:id/lien-he/:subId', async (req, res) => saveBuyerSubInfo(req, res, 'LienHe'));
router.post('/nguoi-mua/:id/ngan-hang', async (req, res) => saveBuyerSubInfo(req, res, 'NganHang'));
router.put('/nguoi-mua/:id/ngan-hang/:subId', async (req, res) => saveBuyerSubInfo(req, res, 'NganHang'));

router.delete('/nguoi-mua/thong-tin-phu/:loai/:id', async (req, res) => {
    try {
        const requester = getRequester(req);
        const id = Number(req.params.id);
        if (!id || !requester.userId) return res.status(400).json({ message: 'Thiếu id hoặc requesterUserId.' });

        const loaiMap = {
            'dia-chi': 'DiaChi',
            diachi: 'DiaChi',
            'lien-he': 'LienHe',
            lienhe: 'LienHe',
            'ngan-hang': 'NganHang',
            nganhang: 'NganHang',
        };
        const loai = loaiMap[String(req.params.loai || '').toLowerCase()];
        if (!loai) return res.status(400).json({ message: 'Loại thông tin phụ không hợp lệ.' });

        const pool = await poolPromise;
        await pool.request()
            .input('Loai', sql.NVarChar(20), loai)
            .input('Id', sql.Int, id)
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_NguoiMua_ThongTinPhu_Xoa');

        res.json({ success: true, id });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi xóa thông tin phụ người mua.');
    }
});

async function saveBuyerSubInfo(req, res, loai) {
    try {
        const nguoiMuaId = Number(req.params.id);
        const subId = Number(req.params.subId) || null;
        const requester = getRequester(req);
        if (!nguoiMuaId || !requester.userId) {
            return res.status(400).json({ message: 'Thiếu người mua hoặc requesterUserId.' });
        }

        const pool = await poolPromise;
        let request = pool.request()
            .input('NguoiMuaId', sql.Int, nguoiMuaId)
            .input('RequesterUserId', sql.Int, requester.userId);

        if (loai === 'DiaChi') {
            request = request
                .input('DiaChiId', sql.Int, subId)
                .input('LoaiDiaChi', sql.NVarChar(30), req.body.loaiDiaChi || 'GiaoDich')
                .input('TenDiaChi', sql.NVarChar(200), req.body.tenDiaChi || null)
                .input('DiaChi', sql.NVarChar(1000), req.body.diaChi)
                .input('QuocGia', sql.NVarChar(100), req.body.quocGia || null)
                .input('IsDefault', sql.Bit, req.body.isDefault ? 1 : 0);
            const rs = await request.execute('HD_sp_NguoiMua_DiaChi_Luu');
            return res.status(subId ? 200 : 201).json(rs.recordset?.[0] || null);
        }

        if (loai === 'LienHe') {
            request = request
                .input('LienHeId', sql.Int, subId)
                .input('HoTen', sql.NVarChar(300), req.body.hoTen)
                .input('ChucVu', sql.NVarChar(200), req.body.chucVu || null)
                .input('Email', sql.NVarChar(320), req.body.email || null)
                .input('DienThoai', sql.NVarChar(50), req.body.dienThoai || null)
                .input('IsDefault', sql.Bit, req.body.isDefault ? 1 : 0);
            const rs = await request.execute('HD_sp_NguoiMua_LienHe_Luu');
            return res.status(subId ? 200 : 201).json(rs.recordset?.[0] || null);
        }

        request = request
            .input('NganHangId', sql.Int, subId)
            .input('SoTaiKhoan', sql.NVarChar(100), req.body.soTaiKhoan)
            .input('TenTaiKhoan', sql.NVarChar(300), req.body.tenTaiKhoan || null)
            .input('TenNganHang', sql.NVarChar(300), req.body.tenNganHang)
            .input('ChiNhanh', sql.NVarChar(300), req.body.chiNhanh || null)
            .input('SwiftCode', sql.NVarChar(50), req.body.swiftCode || null)
            .input('IsDefault', sql.Bit, req.body.isDefault ? 1 : 0);
        const rs = await request.execute('HD_sp_NguoiMua_NganHang_Luu');
        return res.status(subId ? 200 : 201).json(rs.recordset?.[0] || null);
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi lưu thông tin phụ người mua.');
    }
}

/* ========================= HOA DON ========================= */

router.get('/hoa-don', async (req, res) => {
    try {
        const requester = getRequester(req);
        if (!requester.userId || !requester.idDonVi) {
            return res.status(400).json({ message: 'Thiếu userId hoặc idDonVi.' });
        }

        const pool = await poolPromise;
        const rs = await addCommonInvoiceInputs(pool.request(), requester)
            .input('TuKhoa', sql.NVarChar(300), req.query.tukhoa || req.query.tuKhoa || null)
            .input('MaTrangThai', sql.NVarChar(50), req.query.trangthai || req.query.maTrangThai || null)
            .input('MaLoaiHoaDon', sql.NVarChar(30), req.query.maLoaiHoaDon || null)
            .input('DateFrom', sql.Date, req.query.dateFrom || null)
            .input('DateTo', sql.Date, req.query.dateTo || null)
            .execute('HD_sp_HoaDon_DanhSach');

        res.json((rs.recordset || []).map(mapHoaDon));
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi lấy danh sách hóa đơn.');
    }
});

router.get('/hoa-don/:id', async (req, res) => {
    try {
        const hoaDonId = Number(req.params.id);
        const requester = getRequester(req);
        if (!hoaDonId || !requester.userId || !requester.idDonVi) {
            return res.status(400).json({ message: 'Thiếu id, userId hoặc idDonVi.' });
        }

        const pool = await poolPromise;
        const rs = await addCommonInvoiceInputs(pool.request(), requester)
            .input('HoaDonId', sql.Int, hoaDonId)
            .execute('HD_sp_HoaDon_GetById');

        const header = mapHoaDon(firstRecordset(rs, 0)[0]);
        if (!header) return res.status(404).json({ message: 'Không tìm thấy hóa đơn.' });

        const lichSuDuyet = firstRecordset(rs, 4);
        const userIds = [...new Set(lichSuDuyet.map((row) => Number(row.NguoiThucHienId)).filter(Boolean))];
        let userNameMap = new Map();
        if (userIds.length) {
            const userRs = await pool.request()
                .input('UserIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(userIds))
                .query(`
                    SELECT
                        u.ID_TaiKhoanDangNhap,
                        TenNguoiDung = COALESCE(NULLIF(u.TenDayDu, N''), NULLIF(u.TenDangNhap, N''), CONVERT(NVARCHAR(20), u.ID_TaiKhoanDangNhap))
                    FROM Tag_System.dbo.TaiKhoanDangNhap u
                    JOIN OPENJSON(@UserIdsJson) ids
                      ON u.ID_TaiKhoanDangNhap = TRY_CONVERT(INT, ids.[value])
                `);
            userNameMap = new Map((userRs.recordset || []).map((row) => [Number(row.ID_TaiKhoanDangNhap), row.TenNguoiDung]));
        }

        res.json({
            ...header,
            chiTiet: firstRecordset(rs, 1),
            quocPhong: firstRecordset(rs, 2)[0] || null,
            quocPhongChiTiet: firstRecordset(rs, 3),
            lichSuDuyet: lichSuDuyet.map((row) => ({
                ...row,
                TenNguoiThucHien: row.TenNguoiThucHien || userNameMap.get(Number(row.NguoiThucHienId)) || row.NguoiThucHienId,
            })),
            taiLieu: firstRecordset(rs, 5).map((row) => ({
                ...row,
                FileName: normalizeAttachmentName(row.FileName),
            })),
        });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi lấy chi tiết hóa đơn.');
    }
});

router.post('/hoa-don', async (req, res) => {
    try {
        const requester = getRequester(req);
        if (!requester.userId || !requester.idDonVi) {
            return res.status(400).json({ message: 'Thiếu requesterUserId hoặc requesterIdDonVi.' });
        }

        const payload = buildPayload(req.body);
        const pool = await poolPromise;
        const rs = await addCommonInvoiceInputs(pool.request(), requester)
            .input('Payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
            .execute('HD_sp_HoaDon_Tao');

        res.status(201).json({
            hoaDon: mapHoaDon(firstRecordset(rs, 0)[0]),
            chiTiet: firstRecordset(rs, 1),
        });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi tạo hóa đơn.');
    }
});

router.put('/hoa-don/:id', async (req, res) => {
    try {
        const hoaDonId = Number(req.params.id);
        const requester = getRequester(req);
        if (!hoaDonId || !requester.userId || !requester.idDonVi) {
            return res.status(400).json({ message: 'Thiếu id, requesterUserId hoặc requesterIdDonVi.' });
        }

        const payload = buildPayload(req.body);
        const pool = await poolPromise;
        const rs = await addCommonInvoiceInputs(pool.request(), requester)
            .input('HoaDonId', sql.Int, hoaDonId)
            .input('Payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
            .execute('HD_sp_HoaDon_CapNhat');

        res.json({
            hoaDon: mapHoaDon(firstRecordset(rs, 0)[0]),
            chiTiet: firstRecordset(rs, 1),
        });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi cập nhật hóa đơn.');
    }
});

router.delete('/hoa-don/:id', async (req, res) => {
    try {
        const hoaDonId = Number(req.params.id);
        const requester = getRequester(req);
        if (!hoaDonId || !requester.userId) return res.status(400).json({ message: 'Thiếu id hoặc requesterUserId.' });

        const pool = await poolPromise;
        await pool.request()
            .input('HoaDonId', sql.Int, hoaDonId)
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_HoaDon_Xoa');

        res.json({ success: true, id: hoaDonId });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi xóa hóa đơn.');
    }
});

router.post('/hoa-don/:id/submit', async (req, res) => {
    try {
        const hoaDonId = Number(req.params.id);
        const requester = getRequester(req);
        if (!hoaDonId || !requester.userId) return res.status(400).json({ message: 'Thiếu id hoặc requesterUserId.' });

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('HoaDonId', sql.Int, hoaDonId)
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_HoaDon_Trinh');

        res.json(mapHoaDon(rs.recordset?.[0]));
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi trình hóa đơn.');
    }
});

router.post('/hoa-don/:id/approve', async (req, res) => {
    try {
        const hoaDonId = Number(req.params.id);
        const requester = getRequester(req);
        const hanhDong = req.body.hanhDong || (req.body.chapThuan === false ? 'TraLai' : 'Duyet');

        if (!hoaDonId || !requester.userId || !requester.idDonVi) {
            return res.status(400).json({ message: 'Thiếu id, requesterUserId hoặc requesterIdDonVi.' });
        }

        const pool = await poolPromise;
        const rs = await addCommonInvoiceInputs(pool.request(), requester)
            .input('HoaDonId', sql.Int, hoaDonId)
            .input('HanhDong', sql.NVarChar(20), hanhDong)
            .input('TenNguoiThucHien', sql.NVarChar(300), req.body.tenNguoiThucHien || req.body.tenNguoiDuyet || null)
            .input('GhiChu', sql.NVarChar(1000), req.body.ghiChu || req.body.lyDo || null)
            .execute('HD_sp_HoaDon_Duyet');

        res.json(mapHoaDon(rs.recordset?.[0]));
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi duyệt hóa đơn.');
    }
});

router.put('/hoa-don/:id/thong-tin-xuat', async (req, res) => {
    try {
        const hoaDonId = Number(req.params.id);
        const requester = getRequester(req);
        if (!hoaDonId || !requester.userId) {
            return res.status(400).json({ message: 'Thiếu id hoặc requesterUserId.' });
        }

        const payload = buildPayload(req.body);
        const pool = await poolPromise;
        const rs = await pool.request()
            .input('HoaDonId', sql.Int, hoaDonId)
            .input('Payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_HoaDon_CapNhatThongTinXuat');

        res.json({
            hoaDon: mapHoaDon(firstRecordset(rs, 0)[0]),
            chiTiet: firstRecordset(rs, 1),
        });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi cập nhật thông tin xuất hóa đơn.');
    }
});

function buildPayload(body) {
    const clone = { ...body };
    delete clone.requesterUserId;
    delete clone.requesterIdDonVi;
    delete clone.userId;
    delete clone.idDonVi;

    clone.chiTiet = Array.isArray(clone.chiTiet) ? clone.chiTiet : [];
    return clone;
}

/* ========================= TAI LIEU ========================= */

router.post('/hoa-don/:hoaDonId/tai-lieu', upload.array('files', 10), async (req, res) => {
    try {
        const hoaDonId = Number(req.params.hoaDonId);
        const requester = getRequester(req);
        const files = req.files || [];

        if (!hoaDonId || !requester.userId) return res.status(400).json({ message: 'Thiếu hóa đơn hoặc requesterUserId.' });
        if (!files.length) return res.status(400).json({ message: 'Không có file nào được upload.' });

        const pool = await poolPromise;
        const inserted = [];

        for (const file of files) {
            const fileName = path.basename(decodeMultipartFileName(file.originalname));
            const filePath = file.path.replace(/\\/g, '/');

            const rs = await pool.request()
                .input('HoaDonId', sql.Int, hoaDonId)
                .input('LoaiTaiLieu', sql.NVarChar(50), req.body.loaiTaiLieu || null)
                .input('FileName', sql.NVarChar(255), fileName)
                .input('FilePath', sql.NVarChar(1000), filePath)
                .input('MimeType', sql.NVarChar(150), file.mimetype || null)
                .input('FileSize', sql.BigInt, file.size || null)
                .input('RequesterUserId', sql.Int, requester.userId)
                .execute('HD_sp_HoaDon_TaiLieu_Them');

            inserted.push(rs.recordset?.[0]);
        }

        res.status(201).json(inserted);
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi upload tài liệu hóa đơn.');
    }
});

router.get('/hoa-don/tai-lieu/:taiLieuId', async (req, res) => {
    try {
        const taiLieuId = Number(req.params.taiLieuId);
        if (!taiLieuId) return res.status(400).send('taiLieuId không hợp lệ.');

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('TaiLieuId', sql.BigInt, taiLieuId)
            .query(`
                SELECT FilePath, FileName
                FROM dbo.HD_HoaDon_TaiLieu
                WHERE TaiLieuId = @TaiLieuId AND IsDeleted = 0
            `);

        const row = rs.recordset?.[0];
        if (!row) return res.status(404).send('Không tìm thấy tài liệu.');

        const filePath = resolveAttachmentPath(row.FilePath);
        if (!filePath) return res.status(404).send('File không tồn tại trên server.');

        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(normalizeAttachmentName(row.FileName))}"`);
        res.sendFile(path.resolve(filePath));
    } catch (err) {
        console.error(err);
        res.status(500).send('Có lỗi khi xem tài liệu hóa đơn.');
    }
});

router.delete('/hoa-don/tai-lieu/:taiLieuId', async (req, res) => {
    try {
        const taiLieuId = Number(req.params.taiLieuId);
        const requester = getRequester(req);
        if (!taiLieuId || !requester.userId) return res.status(400).json({ message: 'Thiếu tài liệu hoặc requesterUserId.' });

        const pool = await poolPromise;
        await pool.request()
            .input('TaiLieuId', sql.BigInt, taiLieuId)
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_HoaDon_TaiLieu_Xoa');

        res.json({ success: true, id: taiLieuId });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi xóa tài liệu hóa đơn.');
    }
});

/* ========================= XUAT FILE / PHAT HANH ========================= */

router.post('/dot-xuat-file', async (req, res) => {
    try {
        const requester = getRequester(req);
        const hoaDonIds = req.body.hoaDonIds || req.body.ids;
        if (!requester.userId) return res.status(400).json({ message: 'Thiếu requesterUserId.' });
        if (!Array.isArray(hoaDonIds) || !hoaDonIds.length) return res.status(400).json({ message: 'Danh sách hóa đơn rỗng.' });

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('HoaDonIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(hoaDonIds))
            .input('RequesterUserId', sql.Int, requester.userId)
            .input('PhienBanMau', sql.NVarChar(50), req.body.phienBanMau || 'MISA-20COL-V1')
            .input('GhiChu', sql.NVarChar(1000), req.body.ghiChu || null)
            .execute('HD_sp_DotXuatFile_Tao');

        res.status(201).json({
            dotXuatFile: firstRecordset(rs, 0)[0],
            rows: firstRecordset(rs, 1),
        });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi tạo đợt xuất file.');
    }
});

router.get('/dot-xuat-file/:id/data', async (req, res) => {
    try {
        const dotXuatFileId = Number(req.params.id);
        const requester = getRequester(req);
        if (!dotXuatFileId || !requester.userId) return res.status(400).json({ message: 'Thiếu đợt xuất hoặc requesterUserId.' });

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('DotXuatFileId', sql.BigInt, dotXuatFileId)
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_DotXuatFile_LayDuLieu');

        res.json(rs.recordset || []);
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi lấy dữ liệu đợt xuất file.');
    }
});

router.get('/dot-xuat-file/:id/export.xlsx', async (req, res) => {
    try {
        const dotXuatFileId = Number(req.params.id);
        const requester = getRequester(req);
        if (!dotXuatFileId || !requester.userId) return res.status(400).json({ message: 'Thiếu đợt xuất hoặc requesterUserId.' });

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('DotXuatFileId', sql.BigInt, dotXuatFileId)
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_DotXuatFile_LayDuLieu');

        const rows = rs.recordset || [];
        const headers = [
            'Số thứ tự hóa đơn (*)',
            'Ngày hóa đơn',
            'Tên đơn vị mua hàng',
            'Địa chỉ',
            'Mã số thuế',
            'Người mua hàng',
            'Email',
            'Hình thức thanh toán',
            'Loại tiền',
            'Tỷ giá',
            'Thuế suất GTGT (%)',
            'Tiền thuế GTGT',
            'Tiền thuế GTGT quy đổi',
            'Mã hàng',
            'Tên hàng hóa/dịch vụ (*)',
            'ĐVT',
            'Số lượng',
            'Đơn giá',
            'Thành tiền',
            'Thành tiền quy đổi',
        ];
        const exportRows = rows.map((row) => Object.fromEntries(headers.map((header) => [header, row[header] ?? null])));
        const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: headers });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Hóa đơn GTGT');
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="hoa-don-import-${dotXuatFileId}.xlsx"`);
        res.send(buffer);
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi xuất file Excel.');
    }
});

router.put('/dot-xuat-file/:id/file', async (req, res) => {
    try {
        const dotXuatFileId = Number(req.params.id);
        const requester = getRequester(req);
        if (!dotXuatFileId || !requester.userId) return res.status(400).json({ message: 'Thiếu đợt xuất hoặc requesterUserId.' });

        const pool = await poolPromise;
        await pool.request()
            .input('DotXuatFileId', sql.BigInt, dotXuatFileId)
            .input('FileName', sql.NVarChar(255), req.body.fileName)
            .input('FilePath', sql.NVarChar(1000), req.body.filePath)
            .input('FileChecksum', sql.NVarChar(128), req.body.fileChecksum || null)
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_DotXuatFile_CapNhatFile');

        res.json({ success: true, id: dotXuatFileId });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi cập nhật thông tin file.');
    }
});

router.post('/hoa-don/:id/xac-nhan-da-xuat', async (req, res) => {
    try {
        const hoaDonId = Number(req.params.id);
        const requester = getRequester(req);
        if (!hoaDonId || !requester.userId) return res.status(400).json({ message: 'Thiếu hóa đơn hoặc requesterUserId.' });

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('HoaDonId', sql.Int, hoaDonId)
            .input('DotXuatFileId', sql.BigInt, req.body.dotXuatFileId || null)
            .input('SoHoaDon', sql.NVarChar(50), req.body.soHoaDon)
            .input('KyHieuHoaDon', sql.NVarChar(50), req.body.kyHieuHoaDon)
            .input('NgayPhatHanh', sql.Date, req.body.ngayPhatHanh)
            .input('RequesterUserId', sql.Int, requester.userId)
            .input('GhiChu', sql.NVarChar(1000), req.body.ghiChu || null)
            .execute('HD_sp_HoaDon_XacNhanDaXuat');

        res.json(mapHoaDon(rs.recordset?.[0]));
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi xác nhận đã xuất hóa đơn.');
    }
});

/* ========================= DASHBOARD / PHU TRACH ========================= */

router.get('/dashboard', async (req, res) => {
    try {
        const requester = getRequester(req);
        if (!requester.userId || !requester.idDonVi) return res.status(400).json({ message: 'Thiếu userId hoặc idDonVi.' });

        const pool = await poolPromise;
        const rs = await addCommonInvoiceInputs(pool.request(), requester)
            .input('DateFrom', sql.Date, req.query.dateFrom || null)
            .input('DateTo', sql.Date, req.query.dateTo || null)
            .execute('HD_sp_HoaDon_Dashboard');

        res.json({
            byStatus: firstRecordset(rs, 0),
            byTypeAndCurrency: firstRecordset(rs, 1),
        });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi lấy dashboard hóa đơn.');
    }
});

router.get('/nguoi-phu-trach', async (req, res) => {
    try {
        const pool = await poolPromise;
        const rs = await pool.request()
            .input('MaLoaiHoaDon', sql.NVarChar(30), req.query.maLoaiHoaDon || null)
            .execute('HD_sp_NguoiPhuTrach_DanhSach');

        res.json(rs.recordset || []);
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi lấy danh sách người phụ trách.');
    }
});

router.put('/nguoi-phu-trach/:maLoaiHoaDon', async (req, res) => {
    try {
        const requester = getRequester(req);
        if (!requester.userId) return res.status(400).json({ message: 'Thiếu requesterUserId.' });

        const userIds = req.body.userIds || [];
        if (!Array.isArray(userIds)) return res.status(400).json({ message: 'userIds phải là mảng.' });

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('MaLoaiHoaDon', sql.NVarChar(30), req.params.maLoaiHoaDon)
            .input('UserIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(userIds))
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_NguoiPhuTrach_ThayThe');

        res.json(rs.recordset || []);
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi cấu hình người phụ trách.');
    }
});

module.exports = router;
