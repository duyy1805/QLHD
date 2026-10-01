const RENTAL_WAREHOUSE_ID = 35;
const RENTAL_FACTORY_WAREHOUSE_ID = 5;

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

function isRentalTransfer(row = {}) {
  const sourceExportId = numeric(row.ID_PhieuXuatBTP ?? row.sourceExportId);
  return Boolean(sourceExportId) && isSupportedRentalExport(row);
}

function rentalTransferDirection(row = {}) {
  return numeric(row.ID_KhoNhap ?? row.idKhoNhap) === RENTAL_WAREHOUSE_ID
    ? 'TO_RENTAL_WAREHOUSE'
    : 'TO_FACTORY';
}

module.exports = {
  RENTAL_WAREHOUSE_ID,
  RENTAL_FACTORY_WAREHOUSE_ID,
  isSupportedRentalExport,
  isRentalTransfer,
  rentalTransferDirection,
};
