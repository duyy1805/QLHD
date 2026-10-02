const RENTAL_WAREHOUSE_ID = 35;
const RENTAL_FACTORY_WAREHOUSE_ID = 5;
const RENTAL_TRANSFER_NOTE_MARKER = '[KHOTHUE]';

function numeric(value) {
  if (Array.isArray(value)) value = value[0];
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function isSupportedRentalExport(row = {}) {
  const sourceWarehouse = numeric(row.ID_KhoXuat ?? row.idKhoXuat);
  const destinationWarehouse = numeric(row.ID_KhoNhap ?? row.idKhoNhap);
  return (
    (destinationWarehouse === RENTAL_WAREHOUSE_ID && sourceWarehouse !== RENTAL_WAREHOUSE_ID)
    || (sourceWarehouse === RENTAL_WAREHOUSE_ID
        && destinationWarehouse === RENTAL_FACTORY_WAREHOUSE_ID)
  );
}

function rentalTransferNote(row = {}) {
  const value = row.GhiChuPhieuXuat
    ?? row.ghiChuPhieuXuat
    ?? row.SourceExportNote
    ?? row.sourceExportNote
    ?? row.GhiChu
    ?? row.ghiChu;
  const normalized = Array.isArray(value) ? value[value.length - 1] : value;
  return String(normalized ?? '');
}

function hasRentalTransferMarker(row = {}) {
  return rentalTransferNote(row).toUpperCase().includes(RENTAL_TRANSFER_NOTE_MARKER);
}

function isMarkedRentalExport(row = {}) {
  return isSupportedRentalExport(row) && hasRentalTransferMarker(row);
}

function isRentalTransfer(row = {}) {
  const sourceExportId = numeric(row.ID_PhieuXuatBTP ?? row.sourceExportId);
  return Boolean(sourceExportId) && isMarkedRentalExport(row);
}

function rentalTransferDirection(row = {}) {
  return numeric(row.ID_KhoNhap ?? row.idKhoNhap) === RENTAL_WAREHOUSE_ID
    ? 'TO_RENTAL_WAREHOUSE'
    : 'TO_FACTORY';
}

async function assertFullRentalPackageSelection(request, sql, idExport, picks = []) {
  const grouped = new Map();
  for (const pick of picks) {
    const detailId = numeric(pick.IdTheKhoKienBTPChiTiet);
    const quantity = Number(pick.SoLuongXuatKho);
    if (detailId && Number.isFinite(quantity)) {
      grouped.set(detailId, (grouped.get(detailId) || 0) + quantity);
    }
  }
  if (!grouped.size) throw new Error('Phiếu xuất chưa có kiện hợp lệ');

  request.input('RentalExportID', sql.Int, idExport);
  const values = [...grouped.entries()].map(([detailId, quantity], index) => {
    request.input(`RentalDetail${index}`, sql.Int, detailId);
    request.input(`RentalQuantity${index}`, sql.Decimal(18, 2), quantity);
    return `(@RentalDetail${index}, @RentalQuantity${index})`;
  });
  const result = await request.query(`
    WITH Picked AS (
      SELECT ID_TheKhoKienBTP_ChiTiet, SUM(SoLuong) AS SoLuong
      FROM (VALUES ${values.join(',')}) valueList(ID_TheKhoKienBTP_ChiTiet, SoLuong)
      GROUP BY ID_TheKhoKienBTP_ChiTiet
    ), SelectedPackages AS (
      SELECT DISTINCT detail.ID_TheKhoKienBTP
      FROM Picked picked
      JOIN dbo.TheKhoKienBTP_ChiTiet detail
        ON detail.ID_TheKhoKienBTP_ChiTiet = picked.ID_TheKhoKienBTP_ChiTiet
       AND ISNULL(detail.TonTai, 1) = 1
    ), PriorExport AS (
      SELECT exported.ID_TheKhoKienBTP_ChiTiet, SUM(exported.SoLuong_XuatKho) AS SoLuong
      FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien exported
      JOIN dbo.PhieuXuatBTP exportHeader
        ON exportHeader.ID_PhieuXuatBTP = exported.ID_PhieuXuatBTP
       AND exportHeader.TonTai = 1
      WHERE exported.ID_PhieuXuatBTP <> @RentalExportID
      GROUP BY exported.ID_TheKhoKienBTP_ChiTiet
    )
    SELECT TOP (1) 1 AS InvalidSelection
    FROM dbo.TheKhoKienBTP_ChiTiet detail WITH (UPDLOCK, HOLDLOCK)
    JOIN SelectedPackages package ON package.ID_TheKhoKienBTP = detail.ID_TheKhoKienBTP
    LEFT JOIN PriorExport priorExport
      ON priorExport.ID_TheKhoKienBTP_ChiTiet = detail.ID_TheKhoKienBTP_ChiTiet
    LEFT JOIN Picked picked
      ON picked.ID_TheKhoKienBTP_ChiTiet = detail.ID_TheKhoKienBTP_ChiTiet
    WHERE ISNULL(detail.TonTai, 1) = 1
      AND (detail.SoLuong - ISNULL(priorExport.SoLuong, 0) <= 0
           OR ABS(ISNULL(picked.SoLuong, 0)
                  - (detail.SoLuong - ISNULL(priorExport.SoLuong, 0))) > 0.000001)
    UNION ALL
    SELECT TOP (1) 1
    FROM Picked picked
    LEFT JOIN dbo.TheKhoKienBTP_ChiTiet detail
      ON detail.ID_TheKhoKienBTP_ChiTiet = picked.ID_TheKhoKienBTP_ChiTiet
     AND ISNULL(detail.TonTai, 1) = 1
    WHERE detail.ID_TheKhoKienBTP_ChiTiet IS NULL;
  `);
  if (result.recordset?.length) {
    throw new Error('Chuyển kho thuê chỉ cho phép xuất nguyên kiện; hãy tách kiện trước');
  }
}

module.exports = {
  RENTAL_WAREHOUSE_ID,
  RENTAL_FACTORY_WAREHOUSE_ID,
  RENTAL_TRANSFER_NOTE_MARKER,
  isSupportedRentalExport,
  hasRentalTransferMarker,
  isMarkedRentalExport,
  isRentalTransfer,
  rentalTransferDirection,
  assertFullRentalPackageSelection,
};
