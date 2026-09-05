/* global require, Buffer, process, module */
const express = require('express');
const router = express.Router();
const { poolPromise } = require('../db');
const sql = require('mssql');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const axios = require('axios');
const crypto = require('crypto');
const {
    deleteDriveFileByPath,
    getDriveFileStream,
    parseDriveFileId,
    uploadBufferToInvoiceDrive,
} = require('../utils/googleDriveStorage');

const uploadDir = 'C:/DocumentsUpload/HoaDonDienTu/Upload';
const importDir = 'C:/DocumentsUpload/HoaDonDienTu/Import';

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(importDir)) {
    fs.mkdirSync(importDir, { recursive: true });
}

const ATTACHMENT_MAX_FILE_SIZE = 30 * 1024 * 1024;
const ATTACHMENT_ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg']);
const invoiceAttachmentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ATTACHMENT_MAX_FILE_SIZE, files: 10 },
    fileFilter(req, file, callback) {
        const fileName = path.basename(decodeMultipartFileName(file.originalname || ''));
        const extension = path.extname(fileName).toLowerCase();
        if (!ATTACHMENT_ALLOWED_EXTENSIONS.has(extension)) {
            const error = new Error('Định dạng file không được hỗ trợ.');
            error.statusCode = 400;
            return callback(error);
        }
        return callback(null, true);
    },
});
const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const IMPORT_TEMPLATE_VERSION = 'MISA-21COL-V2';
const UNCLASSIFIED_INVOICE_TYPE = 'ChuaPhanLoai';
const IMPORT_HEADERS = [
    'Số thứ tự hóa đơn (*)',
    'Ngày hóa đơn',
    'Tên đơn vị mua hàng',
    'Địa chỉ',
    'Mã số thuế',
    'MĐVCQHNS',
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

function uploadInvoiceAttachments(req, res, next) {
    invoiceAttachmentUpload.array('files', 10)(req, res, (error) => {
        if (!error) return next();
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ message: 'Mỗi file đính kèm không được vượt quá 30 MB.' });
        }
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ message: 'Chỉ được tải tối đa 10 file trong mỗi lần.' });
        }
        return res.status(error.statusCode || 400).json({ message: error.message || 'File đính kèm không hợp lệ.' });
    });
}

function safeDriveStoredName(prefix, originalName) {
    const safeName = path.basename(originalName).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(-180) || 'file';
    return `${prefix}-${Date.now()}-${crypto.randomUUID()}-${safeName}`;
}

function isPathInside(root, candidate) {
    const resolvedRoot = path.resolve(root).toLowerCase();
    const resolvedCandidate = path.resolve(candidate).toLowerCase();
    return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep.toLowerCase()}`);
}

async function deleteStoredFile(filePath) {
    if (!filePath) return;
    if (parseDriveFileId(filePath)) {
        await deleteDriveFileByPath(filePath);
        return;
    }

    const resolved = resolveAttachmentPath(filePath);
    if (!resolved) return;
    if (!isPathInside(uploadDir, resolved) && !isPathInside(importDir, resolved)) {
        throw new Error('Đường dẫn file local nằm ngoài thư mục lưu trữ hóa đơn.');
    }
    try {
        await fs.promises.unlink(resolved);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

async function deleteStoredFiles(filePaths) {
    const uniquePaths = [...new Set((filePaths || []).filter(Boolean))];
    for (const filePath of uniquePaths) await deleteStoredFile(filePath);
}

function normalizeExcelHeader(value) {
    return String(value ?? '')
        .replace(/^\uFEFF/, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function isBlankCell(value) {
    return value === null || value === undefined || String(value).trim() === '';
}

function parseExcelNumber(value) {
    if (isBlankCell(value)) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;

    let text = String(value).trim().replace(/\s/g, '');
    if (text.includes(',') && text.includes('.')) {
        text = text.lastIndexOf(',') > text.lastIndexOf('.')
            ? text.replace(/\./g, '').replace(',', '.')
            : text.replace(/,/g, '');
    } else if (text.includes(',')) {
        const parts = text.split(',');
        text = parts.length === 2 && parts[1].length <= 6
            ? `${parts[0]}.${parts[1]}`
            : parts.join('');
    }
    return Number(text);
}

function parseExcelDate(value) {
    if (isBlankCell(value)) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    if (typeof value === 'number') {
        const parts = XLSX.SSF.parse_date_code(value);
        if (!parts) return undefined;
        return `${String(parts.y).padStart(4, '0')}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
    }

    const text = String(value).trim();
    const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
    const vietnamese = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
    const parts = iso
        ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
        : vietnamese
            ? { year: Number(vietnamese[3]), month: Number(vietnamese[2]), day: Number(vietnamese[1]) }
            : null;
    if (!parts) return undefined;
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    if (date.getUTCFullYear() !== parts.year || date.getUTCMonth() !== parts.month - 1 || date.getUTCDate() !== parts.day) {
        return undefined;
    }
    return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function invoiceImportWarning(invoice, message) {
    invoice.warnings.push({ invoiceOrder: invoice.invoiceOrder, message });
}

function parseInvoiceImportWorkbook(buffer) {
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        return { checksum, sheetName: null, invoices: [], errors: [{ message: 'File Excel không có worksheet.' }], warnings: [] };
    }

    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
    const errors = [];
    const warnings = [];
    if (matrix.length - 1 > 5000) {
        return {
            checksum,
            sheetName,
            invoices: [],
            errors: [{ message: 'File import vượt quá giới hạn 5.000 dòng dữ liệu.' }],
            warnings,
            rowCount: matrix.length - 1,
        };
    }
    const actualHeaders = matrix[0] || [];
    const expectedHeaders = IMPORT_HEADERS.map(normalizeExcelHeader);
    const normalizedActual = actualHeaders.map(normalizeExcelHeader);

    if (normalizedActual.length !== IMPORT_HEADERS.length || expectedHeaders.some((header, index) => normalizedActual[index] !== header)) {
        expectedHeaders.forEach((header, index) => {
            if (normalizedActual[index] !== header) {
                errors.push({ row: 1, column: index + 1, message: `Cột ${index + 1} phải là “${IMPORT_HEADERS[index]}”.` });
            }
        });
        if (normalizedActual.length > IMPORT_HEADERS.length) {
            errors.push({ row: 1, column: IMPORT_HEADERS.length + 1, message: 'Mẫu import không được có cột ngoài 21 cột chuẩn.' });
        }
        return { checksum, sheetName, invoices: [], errors, warnings, rowCount: Math.max(matrix.length - 1, 0) };
    }

    const invoiceMap = new Map();
    let lastInvoiceOrder = null;
    const numericColumns = [10, 11, 12, 13, 17, 18, 19, 20];

    matrix.slice(1).forEach((row, rowOffset) => {
        const excelRow = rowOffset + 2;
        if (row.every(isBlankCell)) return;

        let invoiceOrder = parseExcelNumber(row[0]);
        if (invoiceOrder === null) invoiceOrder = lastInvoiceOrder;
        if (!Number.isInteger(invoiceOrder) || invoiceOrder <= 0) {
            errors.push({ row: excelRow, column: 1, message: 'Số thứ tự hóa đơn phải là số nguyên dương.' });
            return;
        }
        lastInvoiceOrder = invoiceOrder;

        const parsedNumbers = {};
        numericColumns.forEach((columnIndex) => {
            const parsed = parseExcelNumber(row[columnIndex]);
            parsedNumbers[columnIndex] = parsed;
            if (Number.isNaN(parsed)) {
                errors.push({ row: excelRow, column: columnIndex + 1, message: `Giá trị tại cột “${IMPORT_HEADERS[columnIndex]}” không phải là số hợp lệ.` });
            }
        });

        const invoiceDate = parseExcelDate(row[1]);
        if (invoiceDate === undefined) {
            errors.push({ row: excelRow, column: 2, message: 'Ngày hóa đơn không hợp lệ.' });
        }
        if (isBlankCell(row[15])) {
            errors.push({ row: excelRow, column: 16, message: 'Tên hàng hóa/dịch vụ không được để trống.' });
        }
        if (numericColumns.some((columnIndex) => Number.isNaN(parsedNumbers[columnIndex]))) return;

        let invoice = invoiceMap.get(invoiceOrder);
        if (!invoice) {
            invoice = {
                invoiceOrder,
                startRow: excelRow,
                endRow: excelRow,
                maLoaiHoaDon: UNCLASSIFIED_INVOICE_TYPE,
                loaiHinhDoanhThu: null,
                tenNguoiMuaSnapshot: String(row[2] || '').trim(),
                diaChiSnapshot: String(row[3] || '').trim(),
                maSoThueSnapshot: String(row[4] || '').trim(),
                maDvcqhnsSnapshot: String(row[5] || '').trim(),
                nguoiLienHeSnapshot: String(row[6] || '').trim(),
                emailSnapshot: String(row[7] || '').trim(),
                ngayHoaDon: invoiceDate || null,
                hinhThucThanhToan: String(row[8] || '').trim(),
                maLoaiTien: String(row[9] || 'VND').trim().toUpperCase() || 'VND',
                tyGia: parsedNumbers[10] && parsedNumbers[10] > 0 ? parsedNumbers[10] : 1,
                chiTiet: [],
                warnings: [],
                sourceTax: parsedNumbers[12],
            };
            invoiceMap.set(invoiceOrder, invoice);
        } else {
            invoice.endRow = excelRow;
        }

        const lineNumber = invoice.chiTiet.length + 1;
        const taxRate = parsedNumbers[11] ?? 0;
        const quantity = parsedNumbers[17];
        const unitPrice = parsedNumbers[18];
        const calculatedAmount = (quantity ?? 1) * (unitPrice ?? 0);
        const sourceAmount = parsedNumbers[19];
        if (sourceAmount !== null && Math.abs(sourceAmount - calculatedAmount) > 0.01) {
            invoiceImportWarning(invoice, `Dòng ${excelRow}: thành tiền trong file khác giá trị số lượng × đơn giá; hệ thống sẽ tính lại.`);
        }
        invoice.chiTiet.push({
            soDong: lineNumber,
            maHang: String(row[14] || '').trim(),
            tenHangHoaDichVu: String(row[15] || '').trim(),
            donViTinh: String(row[16] || '').trim(),
            soLuong: quantity,
            donGia: unitPrice,
            tyLeChietKhau: 0,
            thueSuatGTGT: taxRate,
            maThueSuatGTGT: String(taxRate),
        });
    });

    const invoices = [...invoiceMap.values()].sort((left, right) => left.invoiceOrder - right.invoiceOrder);
    for (const invoice of invoices) {
        const taxRates = new Set(invoice.chiTiet.map((line) => Number(line.thueSuatGTGT || 0)));
        invoice.cheDoThue = taxRates.size > 1 ? 'NhieuThueSuat' : 'MotThueSuat';
        invoice.loaiNguoiMua = 'DoanhNghiep';
        invoice.khongCoMaSoThue = !invoice.maSoThueSnapshot && Boolean(invoice.maDvcqhnsSnapshot);
        invoiceImportWarning(invoice, 'Cần bổ sung loại hóa đơn và loại hình doanh thu trước khi trình duyệt.');
        if (!invoice.tenNguoiMuaSnapshot) invoiceImportWarning(invoice, 'Thiếu tên đơn vị mua hàng.');
        if (!invoice.diaChiSnapshot) invoiceImportWarning(invoice, 'Thiếu địa chỉ người mua.');
        if (!invoice.maSoThueSnapshot && !invoice.maDvcqhnsSnapshot) invoiceImportWarning(invoice, 'Thiếu mã số thuế hoặc MĐVCQHNS.');
        if (!invoice.ngayHoaDon) invoiceImportWarning(invoice, 'Thiếu ngày hóa đơn.');
        if (!invoice.hinhThucThanhToan) invoiceImportWarning(invoice, 'Thiếu hình thức thanh toán.');
        if (invoice.chiTiet.some((line) => line.soLuong === null || line.donGia === null)) {
            invoiceImportWarning(invoice, 'Có dòng hàng thiếu số lượng hoặc đơn giá.');
        }
        const calculatedTax = invoice.chiTiet.reduce((total, line) => total + (line.soLuong ?? 1) * (line.donGia ?? 0) * Number(line.thueSuatGTGT || 0) / 100, 0);
        if (invoice.sourceTax !== null && Math.abs(invoice.sourceTax - calculatedTax) > 0.01) {
            invoiceImportWarning(invoice, 'Tổng tiền thuế trong file khác số liệu tính lại từ các dòng hàng.');
        }
        warnings.push(...invoice.warnings);
    }

    if (!invoices.length && !errors.length) errors.push({ message: 'File Excel không có dữ liệu hóa đơn.' });
    return { checksum, sheetName, invoices, errors, warnings, rowCount: Math.max(matrix.length - 1, 0) };
}

function safeImportFileName(fileName) {
    const decoded = path.basename(decodeMultipartFileName(fileName || 'import.xlsx'));
    const stem = path.basename(decoded, path.extname(decoded)).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'import';
    return `${stem}.xlsx`;
}

function httpError(res, err, fallback = 'Có lỗi xảy ra khi truy vấn cơ sở dữ liệu.') {
    console.error(err);
    const code = err?.number || err?.code;
    const msg = err?.originalError?.info?.message || err.message || fallback;
    const http = err?.statusCode || (String(code || '').startsWith('73') || String(code || '').startsWith('72') ? 400 : 500);
    return res.status(http).json({ message: msg, code });
}

function getRequester(req) {
    const fromToken = req.user || {};
    return {
        userId: Number(req.body?.requesterUserId || req.query?.userId || fromToken.userId || req.userId) || null,
        idDonVi: Number(req.body?.requesterIdDonVi || req.query?.idDonVi || fromToken.idDonVi) || null,
    };
}

async function getInvoicePermissionContext(pool, hoaDonId, requesterUserId) {
    const result = await pool.request()
        .input('HoaDonId', sql.Int, hoaDonId)
        .input('RequesterUserId', sql.Int, requesterUserId)
        .query(`
            SELECT TOP 1
                h.HoaDonId,
                h.NguoiDangKyId,
                tt.MaTrangThai,
                IsAdmin = CONVERT(BIT, CASE WHEN EXISTS (
                    SELECT 1
                    FROM Tag_System.dbo.PQ_TaiKhoan_ChucNang pq
                    JOIN Tag_System.dbo.PQ_DM_ChucNang cn ON cn.ID_ChucNang = pq.ID_ChucNang
                    WHERE pq.ID_TaiKhoanDangNhap = @RequesterUserId
                      AND pq.CapNhat = 1
                      AND cn.TonTai = 1
                      AND cn.Ma_ChucNang IN (N'HD_Admin', N'Admin')
                ) THEN 1 ELSE 0 END)
            FROM dbo.HD_HoaDon h
            JOIN dbo.HD_TrangThai tt ON tt.TrangThaiId = h.TrangThaiId
            WHERE h.HoaDonId = @HoaDonId AND h.IsDeleted = 0;
        `);
    const context = result.recordset?.[0];
    if (!context) {
        const error = new Error('Hóa đơn không tồn tại hoặc đã bị xóa.');
        error.statusCode = 404;
        throw error;
    }
    return context;
}

async function assertCanManageInvoiceAttachments(pool, hoaDonId, requesterUserId) {
    const context = await getInvoicePermissionContext(pool, hoaDonId, requesterUserId);
    const canManage = context.MaTrangThai === 'KhoiTao' &&
        (Boolean(context.IsAdmin) || Number(context.NguoiDangKyId) === Number(requesterUserId));
    if (!canManage) {
        const error = new Error('Bạn chỉ được quản lý file của hóa đơn nháp do mình tạo hoặc có quyền HD_Admin.');
        error.statusCode = 403;
        throw error;
    }
    return context;
}

async function getInvoiceAttachmentPaths(pool, hoaDonId) {
    const result = await pool.request()
        .input('HoaDonId', sql.Int, hoaDonId)
        .query(`
            SELECT TaiLieuId, FilePath
            FROM dbo.HD_HoaDon_TaiLieu
            WHERE HoaDonId = @HoaDonId AND IsDeleted = 0;
        `);
    return result.recordset || [];
}

async function getAttachmentForDelete(pool, taiLieuId, requesterUserId) {
    const result = await pool.request()
        .input('TaiLieuId', sql.BigInt, taiLieuId)
        .query(`
            SELECT TOP 1 TaiLieuId, HoaDonId, FilePath
            FROM dbo.HD_HoaDon_TaiLieu
            WHERE TaiLieuId = @TaiLieuId AND IsDeleted = 0;
        `);
    const attachment = result.recordset?.[0];
    if (!attachment) {
        const error = new Error('Tài liệu không tồn tại hoặc đã bị xóa.');
        error.statusCode = 404;
        throw error;
    }
    await assertCanManageInvoiceAttachments(pool, attachment.HoaDonId, requesterUserId);
    return attachment;
}

function mapHoaDon(row) {
    if (!row) return null;
    const invoiceType = row.MaLoaiHoaDon === UNCLASSIFIED_INVOICE_TYPE ? null : row.MaLoaiHoaDon;
    return {
        id: row.HoaDonId,
        hoaDonId: row.HoaDonId,
        maDangKy: row.MaDangKy,
        maLoaiHoaDon: invoiceType,
        tenLoaiHoaDon: invoiceType ? row.TenLoaiHoaDon : null,
        loaiHinhDoanhThu: row.LoaiHinhDoanhThu,
        cheDoThue: row.CheDoThue,
        trangThaiId: row.TrangThaiId,
        maTrangThai: row.MaTrangThai,
        trangThai: row.MaTrangThai,
        tenTrangThai: row.TenTrangThai,
        nguoiMuaId: row.NguoiMuaId,
        loaiNguoiMua: row.LoaiNguoiMua_Snapshot,
        tenNguoiMua: row.TenNguoiMua_Snapshot,
        maSoThue: row.MaSoThue_Snapshot,
        soGiayTo: row.SoGiayTo_Snapshot,
        maDvcqhns: row.MaDVCQHNS_Snapshot,
        maDonVi: row.MaDonVi_Snapshot,
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
        tenBoPhanNguoiTao: row.TenDonVi,
        ngayTao: row.NgayTao,
        ngayCapNhat: row.NgayCapNhat,
        ngayTrinh: row.NgayTrinh,
        soHoaDon: row.SoHoaDon,
        kyHieuHoaDon: row.KyHieuHoaDon,
        ngayPhatHanh: row.NgayPhatHanh,
        nguoiXacNhanId: row.NguoiXacNhanId,
        thoiDiemXacNhan: row.ThoiDiemXacNhan,
        nhomImportId: row.NhomImportId || null,
        maNhomImport: row.MaNhomImport || null,
        soThuTuTrongNhom: row.SoThuTuTrongNhom || null,
        isImportIncomplete: row.MaLoaiHoaDon === UNCLASSIFIED_INVOICE_TYPE || !row.LoaiHinhDoanhThu,
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

async function findDuplicateImportGroup(pool, checksum, idDonVi) {
    const result = await pool.request()
        .input('FileChecksum', sql.Char(64), checksum)
        .input('IdDonVi', sql.Int, idDonVi)
        .query(`
            SELECT TOP 1
                nhomImportId = NhomImportId,
                maNhom = MaNhom,
                fileName = FileName,
                ngayTao = NgayTao,
                soHoaDon = SoHoaDon
            FROM dbo.HD_NhomImport
            WHERE FileChecksum = @FileChecksum AND IdDonVi = @IdDonVi AND IsDeleted = 0;
        `);
    return result.recordset?.[0] || null;
}

async function validateInvoiceReadyToSubmit(pool, hoaDonId) {
    const result = await pool.request()
        .input('HoaDonId', sql.Int, hoaDonId)
        .query(`
            SELECT TOP 1
                h.MaLoaiHoaDon, h.LoaiHinhDoanhThu, h.NguoiMuaId,
                h.TenNguoiMua_Snapshot, h.DiaChi_Snapshot, h.NgayHoaDon,
                tt.MaTrangThai,
                HasLine = CASE WHEN EXISTS (
                    SELECT 1 FROM dbo.HD_HoaDon_ChiTiet c
                    WHERE c.HoaDonId = h.HoaDonId
                      AND NULLIF(LTRIM(RTRIM(c.TenHangHoaDichVu)), N'') IS NOT NULL
                ) THEN 1 ELSE 0 END,
                HasInvalidLine = CASE WHEN EXISTS (
                    SELECT 1 FROM dbo.HD_HoaDon_ChiTiet c
                    WHERE c.HoaDonId = h.HoaDonId
                      AND (c.SoLuong IS NULL OR c.SoLuong <= 0 OR c.DonGia IS NULL OR c.DonGia < 0)
                ) THEN 1 ELSE 0 END
            FROM dbo.HD_HoaDon h
            JOIN dbo.HD_TrangThai tt ON tt.TrangThaiId = h.TrangThaiId
            WHERE h.HoaDonId = @HoaDonId AND h.IsDeleted = 0;
        `);
    const invoice = result.recordset?.[0];
    if (!invoice) return 'Hóa đơn không tồn tại.';
    if (invoice.MaTrangThai !== 'KhoiTao') return 'Hóa đơn không còn ở trạng thái nháp.';
    if (!invoice.MaLoaiHoaDon || invoice.MaLoaiHoaDon === UNCLASSIFIED_INVOICE_TYPE) return 'Chưa chọn loại hóa đơn.';
    if (!invoice.LoaiHinhDoanhThu) return 'Chưa chọn loại hình doanh thu.';
    if (!invoice.NguoiMuaId || !String(invoice.TenNguoiMua_Snapshot || '').trim()) return 'Chưa hoàn thiện người mua.';
    if (!String(invoice.DiaChi_Snapshot || '').trim()) return 'Chưa nhập địa chỉ người mua.';
    if (!invoice.NgayHoaDon) return 'Chưa nhập ngày hóa đơn.';
    if (!invoice.HasLine) return 'Hóa đơn chưa có dòng hàng hóa/dịch vụ.';
    if (invoice.HasInvalidLine) return 'Có dòng hàng thiếu số lượng hoặc đơn giá hợp lệ.';
    return null;
}

async function getImportGroupForUser(pool, nhomImportId, requester) {
    const result = await pool.request()
        .input('NhomImportId', sql.BigInt, nhomImportId)
        .input('RequesterUserId', sql.Int, requester.userId)
        .input('RequesterIdDonVi', sql.Int, requester.idDonVi)
        .query(`
            DECLARE @IsAdmin BIT = dbo.HD_fn_UserCoQuyen(@RequesterUserId, N'HD_Admin');
            DECLARE @IsTBP BIT = CASE WHEN dbo.HD_fn_UserCoQuyen(@RequesterUserId, N'HD_TBP') = 1
                OR dbo.SS_fn_UserCoQuyen(@RequesterUserId, N'TBP') = 1 THEN 1 ELSE 0 END;
            DECLARE @CanExport BIT = dbo.HD_fn_UserCoQuyen(@RequesterUserId, N'HD_XuatHoaDon');

            SELECT TOP 1 n.*
            FROM dbo.HD_NhomImport n
            WHERE n.NhomImportId = @NhomImportId
              AND n.IsDeleted = 0
              AND (
                n.NguoiTaoId = @RequesterUserId OR @IsAdmin = 1
                OR EXISTS (
                    SELECT 1
                    FROM dbo.HD_NhomImport_HoaDon m
                    JOIN dbo.HD_HoaDon h ON h.HoaDonId = m.HoaDonId AND h.IsDeleted = 0
                    JOIN dbo.HD_TrangThai tt ON tt.TrangThaiId = h.TrangThaiId
                    WHERE m.NhomImportId = n.NhomImportId
                      AND tt.MaTrangThai <> N'KhoiTao'
                      AND (
                        (@IsTBP = 1 AND EXISTS (
                            SELECT 1 FROM dbo.SS_fn_DonViCungGroup(@RequesterIdDonVi) scope
                            WHERE scope.IdDonVi = h.IdDonVi
                        ))
                        OR @CanExport = 1
                        OR EXISTS (
                            SELECT 1 FROM dbo.HD_NguoiPhuTrach p
                            WHERE p.UserId = @RequesterUserId
                              AND p.MaLoaiHoaDon = h.MaLoaiHoaDon AND p.TonTai = 1
                        )
                      )
                )
              );
        `);
    return result.recordset?.[0] || null;
}

async function listGroupInvoiceIdsForUser(pool, nhomImportId, requester, creatorOnly = false) {
    const result = await pool.request()
        .input('NhomImportId', sql.BigInt, nhomImportId)
        .input('RequesterUserId', sql.Int, requester.userId)
        .input('RequesterIdDonVi', sql.Int, requester.idDonVi)
        .query(`
            DECLARE @IsAdmin BIT = dbo.HD_fn_UserCoQuyen(@RequesterUserId, N'HD_Admin');
            DECLARE @IsTBP BIT = CASE WHEN dbo.HD_fn_UserCoQuyen(@RequesterUserId, N'HD_TBP') = 1
                OR dbo.SS_fn_UserCoQuyen(@RequesterUserId, N'TBP') = 1 THEN 1 ELSE 0 END;
            DECLARE @CanExport BIT = dbo.HD_fn_UserCoQuyen(@RequesterUserId, N'HD_XuatHoaDon');

            SELECT m.HoaDonId
            FROM dbo.HD_NhomImport_HoaDon m
            JOIN dbo.HD_NhomImport n ON n.NhomImportId = m.NhomImportId AND n.IsDeleted = 0
            JOIN dbo.HD_HoaDon h ON h.HoaDonId = m.HoaDonId AND h.IsDeleted = 0
            JOIN dbo.HD_TrangThai tt ON tt.TrangThaiId = h.TrangThaiId
            WHERE m.NhomImportId = @NhomImportId
              AND (
                n.NguoiTaoId = @RequesterUserId OR @IsAdmin = 1
                ${creatorOnly ? '' : `OR (
                    tt.MaTrangThai <> N'KhoiTao' AND (
                        (@IsTBP = 1 AND EXISTS (
                            SELECT 1 FROM dbo.SS_fn_DonViCungGroup(@RequesterIdDonVi) scope
                            WHERE scope.IdDonVi = h.IdDonVi
                        ))
                        OR @CanExport = 1
                        OR EXISTS (
                            SELECT 1 FROM dbo.HD_NguoiPhuTrach p
                            WHERE p.UserId = @RequesterUserId
                              AND p.MaLoaiHoaDon = h.MaLoaiHoaDon AND p.TonTai = 1
                        )
                    )
                )`}
              )
            ORDER BY m.SoThuTuHoaDon;
        `);
    return (result.recordset || []).map((row) => Number(row.HoaDonId));
}

async function syncInvoiceBuyer(pool, payload, requesterUserId) {
    const loaiNguoiMua = payload.loaiNguoiMua === 'CaNhan' ? 'CaNhan' : 'DoanhNghiep';
    const maSoThue = loaiNguoiMua === 'DoanhNghiep'
        ? String(payload.maSoThueSnapshot || '').replace(/[\s.-]/g, '') || null
        : null;
    const maDvcqhns = loaiNguoiMua === 'DoanhNghiep'
        ? String(payload.maDvcqhnsSnapshot || '').trim() || null
        : null;
    const soGiayTo = loaiNguoiMua === 'CaNhan'
        ? String(payload.soGiayToSnapshot || '').replace(/\s/g, '') || null
        : null;
    const tenPhapLy = String(payload.tenNguoiMuaSnapshot || '').trim();
    const diaChi = String(payload.diaChiSnapshot || '').trim();

    const validationError = !tenPhapLy
        ? 'Tên người mua hoặc tên đơn vị là bắt buộc.'
        : !diaChi
            ? 'Địa chỉ người mua là bắt buộc.'
            : loaiNguoiMua === 'DoanhNghiep' && Boolean(maSoThue) === Boolean(maDvcqhns)
                ? 'Tổ chức/doanh nghiệp phải có đúng một trong hai mã: MST hoặc MĐVCQHNS.'
                : maSoThue && !/^\d{10}(?:\d{3})?$/.test(maSoThue)
                    ? 'Mã số thuế phải gồm 10 hoặc 13 chữ số.'
                    : soGiayTo && !/^(?:\d{9}|\d{12})$/.test(soGiayTo)
                        ? 'CCCD/CMND phải gồm 9 hoặc 12 chữ số.'
                        : null;
    if (validationError) {
        const error = new Error(validationError);
        error.number = 73004;
        throw error;
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
        const result = await new sql.Request(transaction)
            .input('NguoiMuaId', sql.Int, Number(payload.nguoiMuaId) || null)
            .input('LoaiNguoiMua', sql.NVarChar(20), loaiNguoiMua)
            .input('TenPhapLy', sql.NVarChar(500), tenPhapLy)
            .input('MaSoThue', sql.NVarChar(50), maSoThue)
            .input('SoGiayTo', sql.NVarChar(50), soGiayTo)
            .input('MaDVCQHNS', sql.NVarChar(100), maDvcqhns)
            .input('MaDonVi', sql.NVarChar(100), payload.maDonViSnapshot || null)
            .input('DiaChi', sql.NVarChar(1000), diaChi)
            .input('NguoiLienHe', sql.NVarChar(300), loaiNguoiMua !== 'CaNhan' ? payload.nguoiLienHeSnapshot || null : tenPhapLy)
            .input('Email', sql.NVarChar(320), payload.emailSnapshot || null)
            .input('DienThoai', sql.NVarChar(50), payload.dienThoaiSnapshot || null)
            .input('RequesterUserId', sql.Int, requesterUserId)
            .query(`
                IF @NguoiMuaId IS NULL AND @LoaiNguoiMua = N'DoanhNghiep' AND @MaSoThue IS NOT NULL
                    SELECT @NguoiMuaId = NguoiMuaId
                    FROM dbo.HD_NguoiMua WITH (UPDLOCK, HOLDLOCK)
                    WHERE MaSoThue = @MaSoThue AND IsDeleted = 0;

                IF @NguoiMuaId IS NULL AND @LoaiNguoiMua = N'DoanhNghiep' AND @MaDVCQHNS IS NOT NULL
                    SELECT @NguoiMuaId = NguoiMuaId
                    FROM dbo.HD_NguoiMua WITH (UPDLOCK, HOLDLOCK)
                    WHERE MaDVCQHNS = @MaDVCQHNS AND IsDeleted = 0;

                IF @NguoiMuaId IS NULL
                BEGIN
                    INSERT dbo.HD_NguoiMua
                        (TenPhapLy, MaSoThue, SoGiayTo, MaDVCQHNS, MaDonVi, LoaiNguoiMua, LaKhachHangNuocNgoai, NguoiTaoId)
                    VALUES
                        (@TenPhapLy, @MaSoThue, @SoGiayTo, @MaDVCQHNS, NULLIF(@MaDonVi, N''), @LoaiNguoiMua, 0, @RequesterUserId);
                    SET @NguoiMuaId = SCOPE_IDENTITY();
                    UPDATE dbo.HD_NguoiMua
                    SET MaNguoiMua = N'KH-' + RIGHT(N'000000' + CONVERT(NVARCHAR(20), @NguoiMuaId), 6)
                    WHERE NguoiMuaId = @NguoiMuaId;
                END
                ELSE
                BEGIN
                    UPDATE dbo.HD_NguoiMua
                    SET LoaiNguoiMua = @LoaiNguoiMua,
                        TenPhapLy = @TenPhapLy,
                        MaSoThue = @MaSoThue,
                        SoGiayTo = @SoGiayTo,
                        MaDVCQHNS = @MaDVCQHNS,
                        MaDonVi = NULLIF(@MaDonVi, N''),
                        NguoiCapNhatId = @RequesterUserId,
                        NgayCapNhat = SYSDATETIME()
                    WHERE NguoiMuaId = @NguoiMuaId AND IsDeleted = 0;
                END;

                DECLARE @DiaChiId INT, @LienHeId INT;
                SELECT TOP 1 @DiaChiId = DiaChiId
                FROM dbo.HD_NguoiMua_DiaChi
                WHERE NguoiMuaId = @NguoiMuaId AND IsDeleted = 0
                ORDER BY IsDefault DESC, DiaChiId;

                IF @DiaChiId IS NULL
                BEGIN
                    INSERT dbo.HD_NguoiMua_DiaChi(NguoiMuaId, LoaiDiaChi, DiaChi, IsDefault, NguoiTaoId)
                    VALUES(@NguoiMuaId, N'GiaoDich', @DiaChi, 1, @RequesterUserId);
                    SET @DiaChiId = SCOPE_IDENTITY();
                END
                ELSE
                    UPDATE dbo.HD_NguoiMua_DiaChi
                    SET DiaChi = @DiaChi, NguoiCapNhatId = @RequesterUserId, NgayCapNhat = SYSDATETIME()
                    WHERE DiaChiId = @DiaChiId;

                SELECT TOP 1 @LienHeId = LienHeId
                FROM dbo.HD_NguoiMua_LienHe
                WHERE NguoiMuaId = @NguoiMuaId AND IsDeleted = 0
                ORDER BY IsDefault DESC, LienHeId;

                IF @LienHeId IS NULL AND (@NguoiLienHe IS NOT NULL OR @Email IS NOT NULL OR @DienThoai IS NOT NULL)
                BEGIN
                    INSERT dbo.HD_NguoiMua_LienHe(NguoiMuaId, HoTen, Email, DienThoai, IsDefault, NguoiTaoId)
                    VALUES(@NguoiMuaId, COALESCE(@NguoiLienHe, @TenPhapLy), NULLIF(@Email, N''), NULLIF(@DienThoai, N''), 1, @RequesterUserId);
                    SET @LienHeId = SCOPE_IDENTITY();
                END
                ELSE IF @LienHeId IS NOT NULL
                    UPDATE dbo.HD_NguoiMua_LienHe
                    SET HoTen = COALESCE(@NguoiLienHe, @TenPhapLy),
                        Email = NULLIF(@Email, N''), DienThoai = NULLIF(@DienThoai, N''),
                        NguoiCapNhatId = @RequesterUserId, NgayCapNhat = SYSDATETIME()
                    WHERE LienHeId = @LienHeId;

                SELECT NguoiMuaId = @NguoiMuaId, DiaChiId = @DiaChiId, LienHeId = @LienHeId;
            `);
        await transaction.commit();
        const ids = result.recordset?.[0] || {};
        return {
            ...payload,
            ...ids,
            loaiNguoiMua,
            maSoThueSnapshot: maSoThue || '',
            maDvcqhnsSnapshot: maDvcqhns || '',
            soGiayToSnapshot: soGiayTo || '',
            nguoiMuaId: ids.NguoiMuaId,
            diaChiId: ids.DiaChiId,
            lienHeId: ids.LienHeId,
        };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

async function syncInvoiceTaxCodes(pool, hoaDonId, payload) {
    await pool.request()
        .input('HoaDonId', sql.Int, hoaDonId)
        .input('ChiTietJson', sql.NVarChar(sql.MAX), JSON.stringify(payload.chiTiet || []))
        .query(`
            UPDATE detail
            SET MaThueSuatGTGT = source.MaThueSuatGTGT
            FROM dbo.HD_HoaDon_ChiTiet detail
            JOIN OPENJSON(@ChiTietJson)
            WITH (
                SoDong INT '$.soDong',
                MaThueSuatGTGT NVARCHAR(10) '$.maThueSuatGTGT'
            ) source
                ON source.SoDong = detail.SoDong
            WHERE detail.HoaDonId = @HoaDonId;
        `);
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
            WHERE TonTai = 1 AND MaLoaiHoaDon <> N'ChuaPhanLoai'
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

router.get('/tra-cuu-mst/:taxCode', async (req, res) => {
    const taxCode = String(req.params.taxCode || '').replace(/[\s.-]/g, '');
    if (!/^\d{10}(?:\d{3})?$/.test(taxCode)) {
        return res.status(400).json({ message: 'Mã số thuế phải gồm 10 hoặc 13 chữ số.' });
    }

    const baseUrl = String(process.env.VIETQR_BUSINESS_API_URL || 'https://api.vietqr.io/v2/business').replace(/\/+$/, '');
    try {
        const response = await axios.get(`${baseUrl}/${encodeURIComponent(taxCode)}`, {
            timeout: Number(process.env.VIETQR_TIMEOUT_MS) || 8000,
            headers: { Accept: 'application/json' },
        });
        const payload = response.data;
        if (String(payload?.code) !== '00' || !payload?.data) {
            return res.json({
                found: false,
                data: null,
                message: payload?.desc || 'Không tìm thấy doanh nghiệp theo mã số thuế.',
            });
        }

        return res.json({
            found: true,
            data: {
                maSoThue: payload.data.id || taxCode,
                tenPhapLy: payload.data.name || '',
                diaChi: payload.data.address || '',
                tenQuocTe: payload.data.internationalName || '',
                tenVietTat: payload.data.shortName || '',
            },
        });
    } catch (error) {
        if (error?.response?.status === 429) {
            return res.status(429).json({ message: 'Vượt giới hạn tra cứu, vui lòng thử lại hoặc nhập thủ công.' });
        }
        if (error?.response?.status === 404) {
            return res.json({ found: false, data: null, message: 'Không tìm thấy doanh nghiệp theo mã số thuế.' });
        }
        console.error('VietQR business lookup failed:', error.message);
        return res.status(502).json({ message: 'Không kết nối được dịch vụ tra cứu MST. Vui lòng nhập thông tin thủ công.' });
    }
});

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
            maNguoiMua, tenPhapLy, maSoThue, soGiayTo, maDvcqhns, maDonVi, loaiNguoiMua,
            quocGia, laKhachHangNuocNgoai, ghiChu,
        } = req.body;

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('NguoiMuaId', sql.Int, null)
            .input('MaNguoiMua', sql.NVarChar(50), maNguoiMua || null)
            .input('TenPhapLy', sql.NVarChar(500), tenPhapLy)
            .input('MaSoThue', sql.NVarChar(50), maSoThue || null)
            .input('SoGiayTo', sql.NVarChar(50), soGiayTo || null)
            .input('MaDVCQHNS', sql.NVarChar(100), maDvcqhns || null)
            .input('MaDonVi', sql.NVarChar(100), maDonVi || null)
            .input('LoaiNguoiMua', sql.NVarChar(20), loaiNguoiMua === 'CaNhan' ? 'CaNhan' : (maSoThue || maDvcqhns ? 'DoanhNghiep' : 'CaNhan'))
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
            maNguoiMua, tenPhapLy, maSoThue, soGiayTo, maDvcqhns, maDonVi, loaiNguoiMua,
            quocGia, laKhachHangNuocNgoai, ghiChu,
        } = req.body;

        const pool = await poolPromise;
        const rs = await pool.request()
            .input('NguoiMuaId', sql.Int, id)
            .input('MaNguoiMua', sql.NVarChar(50), maNguoiMua || null)
            .input('TenPhapLy', sql.NVarChar(500), tenPhapLy)
            .input('MaSoThue', sql.NVarChar(50), maSoThue || null)
            .input('SoGiayTo', sql.NVarChar(50), soGiayTo || null)
            .input('MaDVCQHNS', sql.NVarChar(100), maDvcqhns || null)
            .input('MaDonVi', sql.NVarChar(100), maDonVi || null)
            .input('LoaiNguoiMua', sql.NVarChar(20), loaiNguoiMua === 'CaNhan' ? 'CaNhan' : (maSoThue || maDvcqhns ? 'DoanhNghiep' : 'CaNhan'))
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

        const invoiceRows = rs.recordset || [];
        if (invoiceRows.length) {
            const groupRs = await pool.request()
                .input('HoaDonIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(invoiceRows.map((row) => row.HoaDonId)))
                .query(`
                    SELECT m.HoaDonId, n.NhomImportId, n.MaNhom,
                           SoThuTuTrongNhom = m.SoThuTuHoaDon
                    FROM dbo.HD_NhomImport_HoaDon m
                    JOIN dbo.HD_NhomImport n ON n.NhomImportId = m.NhomImportId AND n.IsDeleted = 0
                    JOIN OPENJSON(@HoaDonIdsJson) ids
                      ON m.HoaDonId = TRY_CONVERT(INT, ids.[value]);
                `);
            const groupByInvoice = new Map((groupRs.recordset || []).map((row) => [Number(row.HoaDonId), row]));
            invoiceRows.forEach((row) => {
                const group = groupByInvoice.get(Number(row.HoaDonId));
                if (!group) return;
                row.NhomImportId = group.NhomImportId;
                row.MaNhomImport = group.MaNhom;
                row.SoThuTuTrongNhom = group.SoThuTuTrongNhom;
            });
        }
        res.json(invoiceRows.map(mapHoaDon));
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

        const headerRow = firstRecordset(rs, 0)[0];
        const groupRs = await pool.request()
            .input('HoaDonId', sql.Int, hoaDonId)
            .query(`
                SELECT m.NhomImportId, n.MaNhom AS MaNhomImport,
                       m.SoThuTuHoaDon AS SoThuTuTrongNhom
                FROM dbo.HD_NhomImport_HoaDon m
                JOIN dbo.HD_NhomImport n ON n.NhomImportId = m.NhomImportId AND n.IsDeleted = 0
                WHERE m.HoaDonId = @HoaDonId;
            `);
        const groupInfo = groupRs.recordset?.[0];
        if (groupInfo && headerRow) Object.assign(headerRow, groupInfo);
        const header = mapHoaDon(headerRow);
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

        let payload = buildPayload(req.body);
        const revenueTypes = ['KinhDoanhThuongMai', 'KinhTeNoiDia', 'QuocPhongNhomI', 'QuocPhongNhomII', 'XuatKhau'];
        if (!revenueTypes.includes(payload.loaiHinhDoanhThu)) {
            return res.status(400).json({ message: 'Loại hình doanh thu không hợp lệ.' });
        }
        const nationalDefenseError = validateNationalDefenseRevenue(payload);
        if (nationalDefenseError) {
            return res.status(400).json({ message: nationalDefenseError });
        }
        const pool = await poolPromise;
        payload = await syncInvoiceBuyer(pool, payload, requester.userId);
        const rs = await addCommonInvoiceInputs(pool.request(), requester)
            .input('Payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
            .execute('HD_sp_HoaDon_Tao');
        const createdId = firstRecordset(rs, 0)[0]?.HoaDonId;
        if (createdId) {
            await pool.request()
                .input('HoaDonId', sql.Int, createdId)
                .input('LoaiNguoiMua', sql.NVarChar(20), payload.loaiNguoiMua)
                .input('LoaiHinhDoanhThu', sql.NVarChar(30), payload.loaiHinhDoanhThu)
                .input('MaDVCQHNS', sql.NVarChar(100), payload.maDvcqhnsSnapshot || null)
                .query('UPDATE dbo.HD_HoaDon SET LoaiNguoiMua_Snapshot = @LoaiNguoiMua, MaDVCQHNS_Snapshot = @MaDVCQHNS, LoaiHinhDoanhThu = @LoaiHinhDoanhThu WHERE HoaDonId = @HoaDonId');
            await syncInvoiceTaxCodes(pool, createdId, payload);
        }

        res.status(201).json({
            hoaDon: { ...mapHoaDon(firstRecordset(rs, 0)[0]), loaiNguoiMua: payload.loaiNguoiMua, maDvcqhns: payload.maDvcqhnsSnapshot || null, loaiHinhDoanhThu: payload.loaiHinhDoanhThu },
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

        let payload = buildPayload(req.body);
        const revenueTypes = ['KinhDoanhThuongMai', 'KinhTeNoiDia', 'QuocPhongNhomI', 'QuocPhongNhomII', 'XuatKhau'];
        if (!revenueTypes.includes(payload.loaiHinhDoanhThu)) {
            return res.status(400).json({ message: 'Loại hình doanh thu không hợp lệ.' });
        }
        const nationalDefenseError = validateNationalDefenseRevenue(payload);
        if (nationalDefenseError) {
            return res.status(400).json({ message: nationalDefenseError });
        }
        const pool = await poolPromise;
        payload = await syncInvoiceBuyer(pool, payload, requester.userId);
        const rs = await addCommonInvoiceInputs(pool.request(), requester)
            .input('HoaDonId', sql.Int, hoaDonId)
            .input('Payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
            .execute('HD_sp_HoaDon_CapNhat');
        await pool.request()
            .input('HoaDonId', sql.Int, hoaDonId)
            .input('LoaiNguoiMua', sql.NVarChar(20), payload.loaiNguoiMua)
            .input('LoaiHinhDoanhThu', sql.NVarChar(30), payload.loaiHinhDoanhThu)
            .input('MaDVCQHNS', sql.NVarChar(100), payload.maDvcqhnsSnapshot || null)
            .query('UPDATE dbo.HD_HoaDon SET LoaiNguoiMua_Snapshot = @LoaiNguoiMua, MaDVCQHNS_Snapshot = @MaDVCQHNS, LoaiHinhDoanhThu = @LoaiHinhDoanhThu WHERE HoaDonId = @HoaDonId');
        await syncInvoiceTaxCodes(pool, hoaDonId, payload);

        res.json({
            hoaDon: { ...mapHoaDon(firstRecordset(rs, 0)[0]), loaiNguoiMua: payload.loaiNguoiMua, maDvcqhns: payload.maDvcqhnsSnapshot || null, loaiHinhDoanhThu: payload.loaiHinhDoanhThu },
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
        const context = await getInvoicePermissionContext(pool, hoaDonId, requester.userId);
        const isAdmin = Boolean(context.IsAdmin);
        const isCreatorDeletable = Number(context.NguoiDangKyId) === Number(requester.userId) &&
            ['KhoiTao', 'TuChoi'].includes(context.MaTrangThai);
        if (!isAdmin && !isCreatorDeletable) {
            const error = new Error('Bạn không có quyền xóa hóa đơn này.');
            error.statusCode = 403;
            throw error;
        }

        const attachments = await getInvoiceAttachmentPaths(pool, hoaDonId);
        await deleteStoredFiles(attachments.map((attachment) => attachment.FilePath));

        if (isAdmin) {
            const deleteResult = await pool.request()
                .input('HoaDonId', sql.Int, hoaDonId)
                .input('RequesterUserId', sql.Int, requester.userId)
                .query(`
                    SET XACT_ABORT ON;
                    BEGIN TRANSACTION;

                    UPDATE dbo.HD_HoaDon
                    SET IsDeleted = 1,
                        NgayCapNhat = SYSDATETIME()
                    WHERE HoaDonId = @HoaDonId AND IsDeleted = 0;

                    IF @@ROWCOUNT = 0
                    BEGIN
                        ROLLBACK TRANSACTION;
                        THROW 73001, N'Hóa đơn không tồn tại hoặc đã bị xóa.', 1;
                    END;

                    UPDATE dbo.HD_HoaDon_TaiLieu
                    SET IsDeleted = 1
                    WHERE HoaDonId = @HoaDonId AND IsDeleted = 0;

                    INSERT dbo.HD_HoaDon_LichSu(HoaDonId, HanhDong, NguoiThucHienId, NoiDung, DuLieuJson)
                    VALUES(@HoaDonId, N'Xoa', @RequesterUserId, N'Admin xóa hồ sơ hóa đơn', N'{"isAdmin":true}');

                    COMMIT TRANSACTION;
                `);
            return res.json({ success: true, id: hoaDonId, deletedByAdmin: true, rowsAffected: deleteResult.rowsAffected });
        }

        await pool.request()
            .input('HoaDonId', sql.Int, hoaDonId)
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_HoaDon_Xoa');

        await pool.request()
            .input('HoaDonId', sql.Int, hoaDonId)
            .query(`
                UPDATE dbo.HD_HoaDon_TaiLieu
                SET IsDeleted = 1
                WHERE HoaDonId = @HoaDonId AND IsDeleted = 0;
            `);

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
        const validationError = await validateInvoiceReadyToSubmit(pool, hoaDonId);
        if (validationError) return res.status(400).json({ message: validationError, code: 'INVOICE_INCOMPLETE' });
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

function validateNationalDefenseRevenue(payload) {
    if (payload.maLoaiHoaDon !== 'QuocPhong') return null;
    if (!String(payload.quocPhong?.quyetDinhGiaoNhiemVu || '').trim()) {
        return 'Nhập quyết định giao nhiệm vụ.';
    }
    if (!String(payload.quocPhong?.soHopDong || '').trim()) {
        return 'Nhập số hợp đồng.';
    }
    if (!String(payload.quocPhong?.soPhieuXuat || '').trim()) {
        return 'Nhập số phiếu xuất.';
    }
    if (!String(payload.quocPhong?.pheDuyetGia || '').trim()) {
        return 'Nhập thông tin phê duyệt giá.';
    }
    return null;
}

/* ========================= TAI LIEU ========================= */

router.post('/hoa-don/:hoaDonId/tai-lieu', uploadInvoiceAttachments, async (req, res) => {
    let transaction = null;
    let persisted = false;
    const uploadedPaths = [];
    try {
        const hoaDonId = Number(req.params.hoaDonId);
        const requester = getRequester(req);
        const files = req.files || [];

        if (!hoaDonId || !requester.userId) return res.status(400).json({ message: 'Thiếu hóa đơn hoặc requesterUserId.' });
        if (!files.length) return res.status(400).json({ message: 'Không có file nào được upload.' });

        const pool = await poolPromise;
        await assertCanManageInvoiceAttachments(pool, hoaDonId, requester.userId);
        const inserted = [];
        const savedFiles = [];

        for (const file of files) {
            const fileName = path.basename(decodeMultipartFileName(file.originalname));
            const uploaded = await uploadBufferToInvoiceDrive({
                buffer: file.buffer,
                storedName: safeDriveStoredName(`hoa-don-${hoaDonId}`, fileName),
                mimeType: file.mimetype,
            });
            uploadedPaths.push(uploaded.filePath);
            savedFiles.push({ file, fileName, filePath: uploaded.filePath });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();

        for (const saved of savedFiles) {
            const rs = await new sql.Request(transaction)
                .input('HoaDonId', sql.Int, hoaDonId)
                .input('LoaiTaiLieu', sql.NVarChar(50), req.body.loaiTaiLieu || null)
                .input('FileName', sql.NVarChar(255), saved.fileName)
                .input('FilePath', sql.NVarChar(1000), saved.filePath)
                .input('MimeType', sql.NVarChar(150), saved.file.mimetype || null)
                .input('FileSize', sql.BigInt, saved.file.size || null)
                .input('RequesterUserId', sql.Int, requester.userId)
                .execute('HD_sp_HoaDon_TaiLieu_Them');

            inserted.push(rs.recordset?.[0]);
        }

        await transaction.commit();
        transaction = null;
        persisted = true;

        res.status(201).json(inserted);
    } catch (err) {
        if (transaction) {
            try { await transaction.rollback(); } catch (rollbackError) { console.error(rollbackError); }
        }
        if (!persisted) {
            for (const filePath of uploadedPaths) {
                try { await deleteDriveFileByPath(filePath); } catch (cleanupError) { console.error(cleanupError); }
            }
        }
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
                SELECT FilePath, FileName, MimeType, FileSize
                FROM dbo.HD_HoaDon_TaiLieu
                WHERE TaiLieuId = @TaiLieuId AND IsDeleted = 0
            `);

        const row = rs.recordset?.[0];
        if (!row) return res.status(404).send('Không tìm thấy tài liệu.');

        const fileName = normalizeAttachmentName(row.FileName) || 'tai-lieu';
        if (parseDriveFileId(row.FilePath)) {
            const driveFile = await getDriveFileStream(row.FilePath);
            res.setHeader('Content-Type', driveFile.metadata.mimeType || row.MimeType || 'application/octet-stream');
            res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
            res.setHeader('Cache-Control', 'private, max-age=60');
            if (driveFile.metadata.size || row.FileSize) {
                res.setHeader('Content-Length', String(driveFile.metadata.size || row.FileSize));
            }
            driveFile.stream.on('error', (streamError) => {
                console.error(streamError);
                if (!res.headersSent) res.status(502).end('Không thể tải file từ Google Drive.');
                else res.destroy(streamError);
            });
            return driveFile.stream.pipe(res);
        }

        const localFilePath = resolveAttachmentPath(row.FilePath);
        if (!localFilePath) return res.status(404).send('File không tồn tại trên server.');
        res.setHeader('Content-Type', row.MimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        return res.sendFile(path.resolve(localFilePath));
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
        const attachment = await getAttachmentForDelete(pool, taiLieuId, requester.userId);
        await deleteStoredFile(attachment.FilePath);
        await pool.request()
            .input('TaiLieuId', sql.BigInt, taiLieuId)
            .input('RequesterUserId', sql.Int, requester.userId)
            .execute('HD_sp_HoaDon_TaiLieu_Xoa');

        res.json({ success: true, id: taiLieuId });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi xóa tài liệu hóa đơn.');
    }
});

/* ========================= NHOM IMPORT EXCEL ========================= */

router.post('/nhom-import/preview', importUpload.single('file'), async (req, res) => {
    try {
        const requester = getRequester(req);
        if (!requester.userId || !requester.idDonVi) {
            return res.status(400).json({ message: 'Thiếu requesterUserId hoặc requesterIdDonVi.' });
        }
        if (!req.file?.buffer) return res.status(400).json({ message: 'Chưa chọn file Excel.' });
        if (path.extname(req.file.originalname || '').toLowerCase() !== '.xlsx') {
            return res.status(400).json({ message: 'Chỉ hỗ trợ file Excel .xlsx.' });
        }

        const preview = parseInvoiceImportWorkbook(req.file.buffer);
        const pool = await poolPromise;
        const duplicateGroup = await findDuplicateImportGroup(pool, preview.checksum, requester.idDonVi);
        return res.json({
            ...preview,
            fileName: path.basename(decodeMultipartFileName(req.file.originalname)),
            templateVersion: IMPORT_TEMPLATE_VERSION,
            duplicateGroup,
        });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi đọc file Excel.');
    }
});

router.post('/nhom-import', importUpload.single('file'), async (req, res) => {
    let storedFilePath = null;
    let transaction = null;
    let persisted = false;
    try {
        const requester = getRequester(req);
        if (!requester.userId || !requester.idDonVi) {
            return res.status(400).json({ message: 'Thiếu requesterUserId hoặc requesterIdDonVi.' });
        }
        if (!req.file?.buffer) return res.status(400).json({ message: 'Chưa chọn file Excel.' });
        if (path.extname(req.file.originalname || '').toLowerCase() !== '.xlsx') {
            return res.status(400).json({ message: 'Chỉ hỗ trợ file Excel .xlsx.' });
        }

        const parsed = parseInvoiceImportWorkbook(req.file.buffer);
        if (parsed.errors.length) {
            return res.status(400).json({ message: 'File Excel chưa hợp lệ.', errors: parsed.errors, warnings: parsed.warnings });
        }

        const pool = await poolPromise;
        const duplicateGroup = await findDuplicateImportGroup(pool, parsed.checksum, requester.idDonVi);
        if (duplicateGroup) {
            return res.status(409).json({ message: 'File này đã được import trước đó.', duplicateGroup });
        }

        const originalFileName = path.basename(decodeMultipartFileName(req.file.originalname));
        const uploadedImport = await uploadBufferToInvoiceDrive({
            buffer: req.file.buffer,
            storedName: safeDriveStoredName(`nhom-import-${requester.idDonVi}`, safeImportFileName(originalFileName)),
            mimeType: req.file.mimetype || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        storedFilePath = uploadedImport.filePath;

        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const duplicateInTransaction = await new sql.Request(transaction)
            .input('FileChecksum', sql.Char(64), parsed.checksum)
            .input('IdDonVi', sql.Int, requester.idDonVi)
            .query(`
                SELECT TOP 1 NhomImportId, MaNhom
                FROM dbo.HD_NhomImport WITH (UPDLOCK, HOLDLOCK)
                WHERE FileChecksum = @FileChecksum AND IdDonVi = @IdDonVi AND IsDeleted = 0;
            `);
        if (duplicateInTransaction.recordset?.[0]) {
            const error = new Error('File này đã được import trước đó.');
            error.statusCode = 409;
            error.duplicateGroup = {
                nhomImportId: duplicateInTransaction.recordset[0].NhomImportId,
                maNhom: duplicateInTransaction.recordset[0].MaNhom,
            };
            throw error;
        }

        const groupResult = await new sql.Request(transaction)
            .input('FileName', sql.NVarChar(255), originalFileName)
            .input('FilePath', sql.NVarChar(1000), storedFilePath)
            .input('FileChecksum', sql.Char(64), parsed.checksum)
            .input('PhienBanMau', sql.NVarChar(50), IMPORT_TEMPLATE_VERSION)
            .input('SoHoaDon', sql.Int, parsed.invoices.length)
            .input('NguoiTaoId', sql.Int, requester.userId)
            .input('IdDonVi', sql.Int, requester.idDonVi)
            .input('GhiChu', sql.NVarChar(1000), req.body.ghiChu || null)
            .query(`
                INSERT dbo.HD_NhomImport
                    (FileName, FilePath, FileChecksum, PhienBanMau, SoHoaDon, NguoiTaoId, IdDonVi, GhiChu)
                OUTPUT inserted.NhomImportId
                VALUES
                    (@FileName, @FilePath, @FileChecksum, @PhienBanMau, @SoHoaDon, @NguoiTaoId, @IdDonVi, NULLIF(@GhiChu, N''));
            `);
        const nhomImportId = Number(groupResult.recordset?.[0]?.NhomImportId);
        const maNhom = `NI-${new Date().getFullYear()}-${String(nhomImportId).padStart(6, '0')}`;
        await new sql.Request(transaction)
            .input('NhomImportId', sql.BigInt, nhomImportId)
            .input('MaNhom', sql.NVarChar(50), maNhom)
            .query('UPDATE dbo.HD_NhomImport SET MaNhom = @MaNhom WHERE NhomImportId = @NhomImportId;');

        const createdInvoices = [];
        for (const invoice of parsed.invoices) {
            const payload = {
                ...invoice,
                ghiChu: `Import từ nhóm ${maNhom}`,
                maLoaiHoaDon: UNCLASSIFIED_INVOICE_TYPE,
                loaiHinhDoanhThu: null,
            };
            delete payload.warnings;
            delete payload.sourceTax;
            delete payload.invoiceOrder;
            delete payload.startRow;
            delete payload.endRow;

            const createResult = await new sql.Request(transaction)
                .input('Payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
                .input('RequesterUserId', sql.Int, requester.userId)
                .input('RequesterIdDonVi', sql.Int, requester.idDonVi)
                .execute('HD_sp_HoaDon_Tao');
            const hoaDonId = Number(firstRecordset(createResult, 0)[0]?.HoaDonId);
            if (!hoaDonId) throw new Error(`Không tạo được hóa đơn thứ tự ${invoice.invoiceOrder}.`);

            await new sql.Request(transaction)
                .input('HoaDonId', sql.Int, hoaDonId)
                .input('LoaiNguoiMua', sql.NVarChar(20), invoice.loaiNguoiMua)
                .input('MaDVCQHNS', sql.NVarChar(100), invoice.maDvcqhnsSnapshot || null)
                .input('ChiTietJson', sql.NVarChar(sql.MAX), JSON.stringify(invoice.chiTiet))
                .query(`
                    UPDATE dbo.HD_HoaDon
                    SET LoaiHinhDoanhThu = NULL,
                        LoaiNguoiMua_Snapshot = @LoaiNguoiMua,
                        MaDVCQHNS_Snapshot = @MaDVCQHNS
                    WHERE HoaDonId = @HoaDonId;

                    UPDATE detail
                    SET MaThueSuatGTGT = source.MaThueSuatGTGT
                    FROM dbo.HD_HoaDon_ChiTiet detail
                    JOIN OPENJSON(@ChiTietJson)
                    WITH (
                        SoDong INT '$.soDong',
                        MaThueSuatGTGT NVARCHAR(10) '$.maThueSuatGTGT'
                    ) source ON source.SoDong = detail.SoDong
                    WHERE detail.HoaDonId = @HoaDonId;
                `);

            await new sql.Request(transaction)
                .input('NhomImportId', sql.BigInt, nhomImportId)
                .input('HoaDonId', sql.Int, hoaDonId)
                .input('SoThuTuHoaDon', sql.Int, invoice.invoiceOrder)
                .input('DongBatDau', sql.Int, invoice.startRow)
                .input('DongKetThuc', sql.Int, invoice.endRow)
                .input('RequesterUserId', sql.Int, requester.userId)
                .input('MaNhom', sql.NVarChar(50), maNhom)
                .query(`
                    INSERT dbo.HD_NhomImport_HoaDon
                        (NhomImportId, HoaDonId, SoThuTuHoaDon, DongBatDau, DongKetThuc)
                    VALUES
                        (@NhomImportId, @HoaDonId, @SoThuTuHoaDon, @DongBatDau, @DongKetThuc);

                    INSERT dbo.HD_HoaDon_LichSu(HoaDonId, HanhDong, NguoiThucHienId, NoiDung, DuLieuJson)
                    VALUES(
                        @HoaDonId, N'ImportExcel', @RequesterUserId,
                        N'Tạo hóa đơn từ nhóm import ' + @MaNhom,
                        N'{"nhomImportId":' + CONVERT(NVARCHAR(30), @NhomImportId) + N'}'
                    );
                `);
            createdInvoices.push({ hoaDonId, invoiceOrder: invoice.invoiceOrder });
        }

        await transaction.commit();
        transaction = null;
        persisted = true;
        return res.status(201).json({
            group: { nhomImportId, maNhom, fileName: originalFileName, soHoaDon: parsed.invoices.length },
            invoices: createdInvoices,
            warnings: parsed.warnings,
        });
    } catch (err) {
        if (transaction) {
            try { await transaction.rollback(); } catch (rollbackError) { console.error(rollbackError); }
        }
        if (storedFilePath && !persisted) {
            try { await deleteStoredFile(storedFilePath); } catch (cleanupError) { console.error(cleanupError); }
        }
        if (err.statusCode === 409) {
            return res.status(409).json({ message: err.message, duplicateGroup: err.duplicateGroup });
        }
        return httpError(res, err, 'Có lỗi khi tạo nhóm import.');
    }
});

router.get('/nhom-import', async (req, res) => {
    try {
        const requester = getRequester(req);
        if (!requester.userId || !requester.idDonVi) return res.status(400).json({ message: 'Thiếu userId hoặc idDonVi.' });
        const pool = await poolPromise;
        const result = await pool.request()
            .input('RequesterUserId', sql.Int, requester.userId)
            .input('RequesterIdDonVi', sql.Int, requester.idDonVi)
            .query(`
                DECLARE @IsAdmin BIT = dbo.HD_fn_UserCoQuyen(@RequesterUserId, N'HD_Admin');
                DECLARE @IsTBP BIT = CASE WHEN dbo.HD_fn_UserCoQuyen(@RequesterUserId, N'HD_TBP') = 1
                    OR dbo.SS_fn_UserCoQuyen(@RequesterUserId, N'TBP') = 1 THEN 1 ELSE 0 END;
                DECLARE @CanExport BIT = dbo.HD_fn_UserCoQuyen(@RequesterUserId, N'HD_XuatHoaDon');

                SELECT
                    nhomImportId = n.NhomImportId,
                    maNhom = n.MaNhom,
                    fileName = n.FileName,
                    fileChecksum = n.FileChecksum,
                    soHoaDon = n.SoHoaDon,
                    nguoiTaoId = n.NguoiTaoId,
                    tenNguoiTao = COALESCE(NULLIF(u.TenDayDu, N''), NULLIF(u.TenDangNhap, N''), CONVERT(NVARCHAR(20), n.NguoiTaoId)),
                    idDonVi = n.IdDonVi,
                    tenDonVi = dv.Ten_DonVi_ThanhToan,
                    ngayTao = n.NgayTao,
                    ghiChu = n.GhiChu,
                    soNhap = SUM(CASE WHEN tt.MaTrangThai = N'KhoiTao' AND h.IsDeleted = 0 THEN 1 ELSE 0 END),
                    soChoDuyetTBP = SUM(CASE WHEN tt.MaTrangThai = N'ChoDuyet_TBP' AND h.IsDeleted = 0 THEN 1 ELSE 0 END),
                    soChoXuLy = SUM(CASE WHEN tt.MaTrangThai = N'ChoXuLy_HoaDon' AND h.IsDeleted = 0 THEN 1 ELSE 0 END),
                    soSanSangXuat = SUM(CASE WHEN tt.MaTrangThai = N'SanSangXuat' AND h.IsDeleted = 0 THEN 1 ELSE 0 END),
                    soHoanTat = SUM(CASE WHEN tt.MaTrangThai IN (N'DaXuat', N'HoanThanh') AND h.IsDeleted = 0 THEN 1 ELSE 0 END),
                    soTuChoi = SUM(CASE WHEN tt.MaTrangThai = N'TuChoi' AND h.IsDeleted = 0 THEN 1 ELSE 0 END),
                    soDaXoa = SUM(CASE WHEN h.IsDeleted = 1 THEN 1 ELSE 0 END)
                FROM dbo.HD_NhomImport n
                JOIN dbo.HD_NhomImport_HoaDon m ON m.NhomImportId = n.NhomImportId
                JOIN dbo.HD_HoaDon h ON h.HoaDonId = m.HoaDonId
                JOIN dbo.HD_TrangThai tt ON tt.TrangThaiId = h.TrangThaiId
                LEFT JOIN Tag_System.dbo.TaiKhoanDangNhap u ON u.ID_TaiKhoanDangNhap = n.NguoiTaoId
                LEFT JOIN Tag_System.dbo.DM_DonVi dv ON dv.Id_DonVi = n.IdDonVi
                WHERE n.IsDeleted = 0
                  AND (n.NguoiTaoId = @RequesterUserId OR @IsAdmin = 1
                   OR (
                        h.IsDeleted = 0 AND tt.MaTrangThai <> N'KhoiTao'
                        AND (
                            (@IsTBP = 1 AND EXISTS (
                                SELECT 1 FROM dbo.SS_fn_DonViCungGroup(@RequesterIdDonVi) scope
                                WHERE scope.IdDonVi = h.IdDonVi
                            ))
                            OR @CanExport = 1
                            OR EXISTS (
                                SELECT 1 FROM dbo.HD_NguoiPhuTrach p
                                WHERE p.UserId = @RequesterUserId
                                  AND p.MaLoaiHoaDon = h.MaLoaiHoaDon AND p.TonTai = 1
                            )
                        )
                   ))
                GROUP BY n.NhomImportId, n.MaNhom, n.FileName, n.FileChecksum, n.SoHoaDon,
                         n.NguoiTaoId, u.TenDayDu, u.TenDangNhap, n.IdDonVi,
                         dv.Ten_DonVi_ThanhToan, n.NgayTao, n.GhiChu
                ORDER BY n.NgayTao DESC, n.NhomImportId DESC;
            `);
        return res.json(result.recordset || []);
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi lấy danh sách nhóm import.');
    }
});

router.delete('/nhom-import/:id', async (req, res) => {
    try {
        const nhomImportId = Number(req.params.id);
        const requester = getRequester(req);
        if (!nhomImportId || !requester.userId) {
            return res.status(400).json({ message: 'Thiếu nhóm import hoặc requesterUserId.' });
        }

        const pool = await poolPromise;
        const preflight = await pool.request()
            .input('NhomImportId', sql.BigInt, nhomImportId)
            .input('RequesterUserId', sql.Int, requester.userId)
            .query(`
                IF NOT EXISTS (
                    SELECT 1
                    FROM Tag_System.dbo.PQ_TaiKhoan_ChucNang pq
                    JOIN Tag_System.dbo.PQ_DM_ChucNang cn ON cn.ID_ChucNang = pq.ID_ChucNang
                    WHERE pq.ID_TaiKhoanDangNhap = @RequesterUserId
                      AND pq.CapNhat = 1
                      AND cn.TonTai = 1
                      AND cn.Ma_ChucNang IN (N'HD_Admin', N'Admin')
                )
                    THROW 73003, N'Chỉ tài khoản Admin mới được xóa nhóm import.', 1;

                SELECT TOP 1 NhomImportId, MaNhom, FilePath
                FROM dbo.HD_NhomImport
                WHERE NhomImportId = @NhomImportId AND IsDeleted = 0;
            `);
        const group = preflight.recordset?.[0];
        if (!group) {
            const error = new Error('Nhóm import không tồn tại hoặc đã bị xóa.');
            error.statusCode = 404;
            throw error;
        }

        await deleteStoredFile(group.FilePath);

        const result = await pool.request()
            .input('NhomImportId', sql.BigInt, nhomImportId)
            .input('RequesterUserId', sql.Int, requester.userId)
            .query(`
                UPDATE dbo.HD_NhomImport
                SET IsDeleted = 1,
                    NguoiXoaId = @RequesterUserId,
                    NgayXoa = SYSDATETIME()
                OUTPUT inserted.NhomImportId, inserted.MaNhom
                WHERE NhomImportId = @NhomImportId AND IsDeleted = 0;

                IF @@ROWCOUNT = 0
                    THROW 73001, N'Nhóm import không tồn tại hoặc đã bị xóa.', 1;
            `);

        return res.json({
            success: true,
            id: Number(result.recordset?.[0]?.NhomImportId || nhomImportId),
            maNhom: result.recordset?.[0]?.MaNhom,
        });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi xóa nhóm import.');
    }
});

router.get('/nhom-import/:id', async (req, res) => {
    try {
        const nhomImportId = Number(req.params.id);
        const requester = getRequester(req);
        if (!nhomImportId || !requester.userId || !requester.idDonVi) {
            return res.status(400).json({ message: 'Thiếu nhóm import, userId hoặc idDonVi.' });
        }
        const pool = await poolPromise;
        const group = await getImportGroupForUser(pool, nhomImportId, requester);
        if (!group) return res.status(404).json({ message: 'Không tìm thấy nhóm import hoặc bạn không có quyền xem.' });

        const visibleIds = await listGroupInvoiceIdsForUser(pool, nhomImportId, requester);
        let invoices = [];
        if (visibleIds.length) {
            const result = await pool.request()
                .input('HoaDonIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(visibleIds))
                .input('NhomImportId', sql.BigInt, nhomImportId)
                .query(`
                    SELECT v.*, m.NhomImportId, n.MaNhom AS MaNhomImport,
                           m.SoThuTuHoaDon AS SoThuTuTrongNhom
                    FROM dbo.HD_NhomImport_HoaDon m
                    JOIN dbo.HD_NhomImport n ON n.NhomImportId = m.NhomImportId AND n.IsDeleted = 0
                    JOIN dbo.HD_vw_HoaDon_Client v ON v.HoaDonId = m.HoaDonId
                    JOIN OPENJSON(@HoaDonIdsJson) ids ON v.HoaDonId = TRY_CONVERT(INT, ids.[value])
                    WHERE m.NhomImportId = @NhomImportId
                    ORDER BY m.SoThuTuHoaDon;
                `);
            invoices = (result.recordset || []).map(mapHoaDon);
        }
        return res.json({
            group: {
                nhomImportId: group.NhomImportId,
                maNhom: group.MaNhom,
                fileName: group.FileName,
                fileChecksum: group.FileChecksum,
                templateVersion: group.PhienBanMau,
                soHoaDon: group.SoHoaDon,
                nguoiTaoId: group.NguoiTaoId,
                idDonVi: group.IdDonVi,
                ngayTao: group.NgayTao,
                ghiChu: group.GhiChu,
            },
            invoices,
        });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi lấy chi tiết nhóm import.');
    }
});

router.get('/nhom-import/:id/file', async (req, res) => {
    try {
        const nhomImportId = Number(req.params.id);
        const requester = getRequester(req);
        if (!nhomImportId || !requester.userId || !requester.idDonVi) {
            return res.status(400).json({ message: 'Thiếu nhóm import, userId hoặc idDonVi.' });
        }
        const pool = await poolPromise;
        const group = await getImportGroupForUser(pool, nhomImportId, requester);
        if (!group) return res.status(404).json({ message: 'Không tìm thấy nhóm import hoặc bạn không có quyền xem.' });
        if (parseDriveFileId(group.FilePath)) {
            const driveFile = await getDriveFileStream(group.FilePath);
            res.setHeader('Content-Type', driveFile.metadata.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(group.FileName || 'nhom-import.xlsx')}`);
            res.setHeader('Cache-Control', 'private, max-age=60');
            if (driveFile.metadata.size) res.setHeader('Content-Length', String(driveFile.metadata.size));
            driveFile.stream.on('error', (streamError) => {
                console.error(streamError);
                if (!res.headersSent) res.status(502).end('Không thể tải file từ Google Drive.');
                else res.destroy(streamError);
            });
            return driveFile.stream.pipe(res);
        }

        const localFilePath = resolveAttachmentPath(group.FilePath);
        if (!localFilePath) return res.status(404).json({ message: 'Không tìm thấy file Excel gốc.' });
        return res.download(localFilePath, group.FileName);
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi tải file Excel gốc.');
    }
});

router.post('/nhom-import/:id/submit', async (req, res) => {
    try {
        const nhomImportId = Number(req.params.id);
        const requester = getRequester(req);
        if (!nhomImportId || !requester.userId || !requester.idDonVi) {
            return res.status(400).json({ message: 'Thiếu nhóm import hoặc thông tin người thực hiện.' });
        }
        const pool = await poolPromise;
        const group = await getImportGroupForUser(pool, nhomImportId, requester);
        if (!group) return res.status(404).json({ message: 'Không tìm thấy nhóm import hoặc bạn không có quyền xem.' });
        const invoiceIds = await listGroupInvoiceIdsForUser(pool, nhomImportId, requester, true);
        const processed = [];
        const skipped = [];
        for (const hoaDonId of invoiceIds) {
            const validationError = await validateInvoiceReadyToSubmit(pool, hoaDonId);
            if (validationError) {
                skipped.push({ hoaDonId, reason: validationError });
                continue;
            }
            try {
                const result = await pool.request()
                    .input('HoaDonId', sql.Int, hoaDonId)
                    .input('RequesterUserId', sql.Int, requester.userId)
                    .execute('HD_sp_HoaDon_Trinh');
                processed.push(mapHoaDon(result.recordset?.[0]) || { hoaDonId });
            } catch (error) {
                skipped.push({ hoaDonId, reason: error?.originalError?.info?.message || error.message });
            }
        }
        return res.json({ processed, skipped });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi trình nhóm hóa đơn.');
    }
});

router.post('/nhom-import/:id/approve', async (req, res) => {
    try {
        const nhomImportId = Number(req.params.id);
        const requester = getRequester(req);
        if (!nhomImportId || !requester.userId || !requester.idDonVi) {
            return res.status(400).json({ message: 'Thiếu nhóm import hoặc thông tin người thực hiện.' });
        }
        const pool = await poolPromise;
        const group = await getImportGroupForUser(pool, nhomImportId, requester);
        if (!group) return res.status(404).json({ message: 'Không tìm thấy nhóm import hoặc bạn không có quyền xem.' });
        const invoiceIds = await listGroupInvoiceIdsForUser(pool, nhomImportId, requester);
        const processed = [];
        const skipped = [];
        for (const hoaDonId of invoiceIds) {
            try {
                const result = await addCommonInvoiceInputs(pool.request(), requester)
                    .input('HoaDonId', sql.Int, hoaDonId)
                    .input('HanhDong', sql.NVarChar(20), 'Duyet')
                    .input('TenNguoiThucHien', sql.NVarChar(300), req.body.tenNguoiThucHien || null)
                    .input('GhiChu', sql.NVarChar(1000), req.body.ghiChu || null)
                    .execute('HD_sp_HoaDon_Duyet');
                processed.push(mapHoaDon(result.recordset?.[0]) || { hoaDonId });
            } catch (error) {
                skipped.push({ hoaDonId, reason: error?.originalError?.info?.message || error.message });
            }
        }
        return res.json({ processed, skipped });
    } catch (err) {
        return httpError(res, err, 'Có lỗi khi duyệt nhóm hóa đơn.');
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
            .input('PhienBanMau', sql.NVarChar(50), req.body.phienBanMau || 'MISA-21COL-V2')
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
            'MĐVCQHNS',
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
