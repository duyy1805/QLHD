const express = require('express');
const sql = require('mssql');
const transfer = require('../utils/btpWarehouseTransfer');

function fail(res, status, message, detail) {
  return res.status(status).json({ ok: false, message, ...(detail ? { detail } : {}) });
}

function optionalDate(value) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function mapPackageRows(rows) {
  const packages = new Map();
  for (const row of rows || []) {
    const id = Number(row.idTheKhoKienBTP);
    let item = packages.get(id);
    if (!item) {
      item = {
        idTheKhoKienBTP: id,
        qrCode: row.qrCode,
        idViTriKho: row.idViTriKho,
        maViTriKho: row.maViTriKho,
        idKho: row.idKho,
        tenKho: row.tenKho,
        totalQuantity: 0,
        details: [],
      };
      packages.set(id, item);
    }
    const quantity = Number(row.quantity || 0);
    item.totalQuantity += quantity;
    item.details.push({
      idTheKhoKienBTPChiTiet: Number(row.idTheKhoKienBTPChiTiet),
      itemCode: row.itemCode,
      productName: row.productName,
      quantity,
      idDonHang: row.idDonHang,
      maDonHang: row.maDonHang,
      idKhachHang: row.idKhachHang,
      idDonHangLoSanXuat: row.idDonHangLoSanXuat,
      soLoSanXuat: row.soLoSanXuat,
      idDonHangSanPham: row.idDonHangSanPham,
      idQuyTrinhSanXuat: row.idQuyTrinhSanXuat,
      weekMark: row.weekMark,
    });
  }
  return [...packages.values()];
}

async function readPackages(pool, { qrCode, packageIds, warehouseId }) {
  const request = pool.request().input('WarehouseID', sql.Int, warehouseId);
  let filter;
  if (qrCode !== undefined) {
    request.input('QRCode', sql.NVarChar(255), String(qrCode || '').trim());
    filter = 'k.QRCode=@QRCode';
  } else {
    request.input('PackageJson', sql.NVarChar(sql.MAX), JSON.stringify(packageIds));
    filter = 'k.ID_TheKhoKienBTP IN (SELECT TRY_CONVERT(int,[value]) FROM OPENJSON(@PackageJson))';
  }
  const result = await request.query(`
    ;WITH PriorExport AS (
      SELECT x.ID_TheKhoKienBTP_ChiTiet,SUM(x.SoLuong_XuatKho) quantity
      FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien x
      JOIN dbo.PhieuXuatBTP p ON p.ID_PhieuXuatBTP=x.ID_PhieuXuatBTP AND p.TonTai=1
      GROUP BY x.ID_TheKhoKienBTP_ChiTiet
    )
    SELECT k.ID_TheKhoKienBTP idTheKhoKienBTP,k.QRCode qrCode,k.ID_ViTriKho idViTriKho,
      v.MaViTriKho maViTriKho,v.ID_Kho idKho,wh.Ten_Kho tenKho,
      d.ID_TheKhoKienBTP_ChiTiet idTheKhoKienBTPChiTiet,d.ItemCode itemCode,d.Ten_SanPham productName,
      CONVERT(decimal(18,2),d.SoLuong-ISNULL(pe.quantity,0)) quantity,
      d.ID_DonHang idDonHang,dh.Ma_DonHang maDonHang,dh.ID_KhachHang idKhachHang,
      d.ID_DonHang_LoSanXuat idDonHangLoSanXuat,
      lot.So_LoSanXuat soLoSanXuat,d.ID_DonHang_SanPham idDonHangSanPham,
      d.ID_QuyTrinhSanXuat idQuyTrinhSanXuat,d.DauTuan weekMark
    FROM dbo.TheKhoKienBTP k
    JOIN dbo.DM_Kho_ViTri v ON v.ID_ViTriKho=k.ID_ViTriKho
    JOIN dbo.DM_Kho wh ON wh.ID_Kho=v.ID_Kho
    JOIN dbo.TheKhoKienBTP_ChiTiet d ON d.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP AND ISNULL(d.TonTai,1)=1
    LEFT JOIN PriorExport pe ON pe.ID_TheKhoKienBTP_ChiTiet=d.ID_TheKhoKienBTP_ChiTiet
    LEFT JOIN dbo.DonHang dh ON dh.ID_DonHang=d.ID_DonHang
    LEFT JOIN dbo.DonHang_LoSanXuat lot ON lot.ID_DonHang_LoSanXuat=d.ID_DonHang_LoSanXuat
    WHERE ${filter} AND ISNULL(k.TonTai,1)=1 AND (@WarehouseID IS NULL OR v.ID_Kho=@WarehouseID)
      AND ISNULL(v.TonTai,1)=1 AND ISNULL(v.SuDung,1)=1
      AND NULLIF(LTRIM(RTRIM(k.QRCode)),N'') IS NOT NULL
      AND d.SoLuong-ISNULL(pe.quantity,0)>0
    ORDER BY k.ID_TheKhoKienBTP,d.ID_TheKhoKienBTP_ChiTiet;
  `);
  return mapPackageRows(result.recordset);
}

module.exports = function createBtpWarehouseTransferRouter(poolPromise) {
  const router = express.Router();

  router.get('/btp/xuat-chuyen-kho/khos', async (_req, res) => {
    try {
      const result = await (await poolPromise).request().query(`SELECT ID_Kho idKhoBTP,Ten_Kho khoNhap
        FROM dbo.DM_Kho WHERE LoaiKho=N'BTP' AND ISNULL(TonTai,1)=1 ORDER BY Ten_Kho`);
      return res.json({ ok: true, items: result.recordset || [] });
    } catch (error) { return fail(res, 500, 'Không tải được danh sách kho BTP', error.message); }
  });

  router.get('/btp/xuat-chuyen-kho/kien/:qr', async (req, res) => {
    const warehouseId = transfer.positiveId(req.query.idKhoXuat);
    const qr = String(req.params.qr || '').trim();
    if (!warehouseId || !qr) return fail(res, 400, 'Kho xuất hoặc QR kiện không hợp lệ');
    try {
      const items = await readPackages(await poolPromise, { qrCode: qr, warehouseId });
      if (!items.length) {
        const elsewhere = await readPackages(await poolPromise, { qrCode: qr, warehouseId: null });
        if (elsewhere.length) return fail(res, 409,
          `Kiện hiện thuộc ${elsewhere[0].tenKho || `kho ID ${elsewhere[0].idKho}`}, không thuộc kho xuất đã chọn`);
        return fail(res, 404, 'Kiện không tồn tại hoặc đã hết tồn');
      }
      return res.json({ ok: true, item: items[0] });
    } catch (error) { return fail(res, 500, 'Không kiểm tra được kiện', error.message); }
  });

  router.post('/btp/xuat-chuyen-kho/kiem-tra', async (req, res) => {
    const warehouseId = transfer.positiveId(req.body?.idKhoXuat);
    const packageIds = transfer.normalizePackageIds(req.body?.idTheKhoKienBTPs);
    if (!warehouseId || !packageIds.length) return fail(res, 400, 'Kho xuất hoặc danh sách kiện không hợp lệ');
    try {
      const items = await readPackages(await poolPromise, { packageIds, warehouseId });
      const found = new Set(items.map(item => item.idTheKhoKienBTP));
      return res.json({ ok: true, items, invalidPackageIds: packageIds.filter(id => !found.has(id)) });
    } catch (error) { return fail(res, 500, 'Không kiểm tra được danh sách kiện', error.message); }
  });

  router.post('/btp/xuat-chuyen-kho/tao-phieu', async (req, res) => {
    const draftUuid = transfer.normalizeDraftUuid(req.body?.draftUuid);
    const sourceId = transfer.positiveId(req.body?.idKhoXuat);
    const destinationId = transfer.positiveId(req.body?.idKhoNhap);
    const packageIds = transfer.normalizePackageIds(req.body?.idTheKhoKienBTPs);
    if (!draftUuid || !sourceId || !destinationId || sourceId === destinationId || !packageIds.length)
      return fail(res, 400, 'Thông tin tạo phiếu xuất chuyển kho không hợp lệ');
    try {
      const result = await (await poolPromise).request()
        .input('DraftUuid', sql.VarChar(36), draftUuid)
        .input('ID_KhoXuat', sql.Int, sourceId)
        .input('ID_KhoNhap', sql.Int, destinationId)
        .input('GhiChuNguoiDung', sql.NVarChar(300), transfer.normalizeNote(req.body?.ghiChu) || null)
        .input('ID_TaiKhoan', sql.Int, transfer.positiveId(req.body?.idTaiKhoan))
        .input('PackageIDsJson', sql.NVarChar(sql.MAX), JSON.stringify(packageIds))
        .execute('dbo.KhoTM_BTP_TaoPhieuXuatChuyenKho');
      return res.json({ ok: true, ...(result.recordset?.[0] || {}) });
    } catch (error) {
      const status = [2601, 2627, 1205, 51000].includes(error.number) ? 409 : 500;
      return fail(res, status, error.message || 'Không tạo được phiếu xuất chuyển kho');
    }
  });

  router.post('/btp/xuat-chuyen-kho/phieu/tim-kiem', async (req, res) => {
    const pageSize = Math.min(50, Math.max(1, Number(req.body?.pageSize) || 20));
    const pageIndex = Math.max(0, Number(req.body?.pageIndex) || 0);
    const search = String(req.body?.search || '').trim().slice(0, 100);
    const sourceId = transfer.positiveId(req.body?.idKhoXuat);
    const destinationId = transfer.positiveId(req.body?.idKhoNhap);
    const fromDate = optionalDate(req.body?.fromDate);
    const toDate = optionalDate(req.body?.toDate);
    try {
      const result = await (await poolPromise).request()
        .input('Prefix', sql.NVarChar(50), transfer.MARKER_PREFIX)
        .input('Search', sql.NVarChar(100), search)
        .input('SourceID', sql.Int, sourceId)
        .input('DestinationID', sql.Int, destinationId)
        .input('FromDate', sql.Date, fromDate)
        .input('ToDate', sql.Date, toDate)
        .input('Skip', sql.Int, pageIndex * pageSize)
        .input('Take', sql.Int, pageSize)
        .query(`SELECT p.ID_PhieuXuatBTP id,p.So_PhieuXuatBTP documentCode,p.Ngay_XuatBTP documentDate,
          p.ID_KhoXuat idKhoXuat,kx.Ten_Kho khoXuat,p.ID_KhoNhap idKhoNhap,kn.Ten_Kho khoNhap,
          p.TrangThai trangThai,p.QrStatus qrStatus,p.GhiChu ghiChu,
          COUNT(DISTINCT d.ID_TheKhoKienBTP) packageCount,ISNULL(SUM(x.SoLuong_XuatKho),0) totalQuantity
        FROM dbo.PhieuXuatBTP p
        LEFT JOIN dbo.DM_Kho kx ON kx.ID_Kho=p.ID_KhoXuat LEFT JOIN dbo.DM_Kho kn ON kn.ID_Kho=p.ID_KhoNhap
        LEFT JOIN dbo.PhieuXuatBTP_ChiTiet_TheKhoKien x ON x.ID_PhieuXuatBTP=p.ID_PhieuXuatBTP
        LEFT JOIN dbo.TheKhoKienBTP_ChiTiet d ON d.ID_TheKhoKienBTP_ChiTiet=x.ID_TheKhoKienBTP_ChiTiet
        WHERE p.TonTai=1 AND LEFT(ISNULL(p.GhiChu,N''),LEN(@Prefix))=@Prefix
          AND (@SourceID IS NULL OR p.ID_KhoXuat=@SourceID) AND (@DestinationID IS NULL OR p.ID_KhoNhap=@DestinationID)
          AND (@FromDate IS NULL OR p.Ngay_XuatBTP>=@FromDate)
          AND (@ToDate IS NULL OR p.Ngay_XuatBTP<DATEADD(day,1,@ToDate))
          AND (@Search=N'' OR p.So_PhieuXuatBTP LIKE N'%'+@Search+N'%' OR p.GhiChu LIKE N'%'+@Search+N'%')
        GROUP BY p.ID_PhieuXuatBTP,p.So_PhieuXuatBTP,p.Ngay_XuatBTP,p.ID_KhoXuat,kx.Ten_Kho,
          p.ID_KhoNhap,kn.Ten_Kho,p.TrangThai,p.QrStatus,p.GhiChu
        ORDER BY p.ID_PhieuXuatBTP DESC OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY`);
      return res.json({ ok: true, items: result.recordset || [], pageIndex, pageSize });
    } catch (error) { return fail(res, 500, 'Không tải được phiếu xuất chuyển kho', error.message); }
  });

  return router;
};
