const sql = require('mssql');

const isCraneNote = (note) => String(note ?? '').toLowerCase().includes('cautruc');

async function assertCraneDocument(executor, kind, id, warehouseID, expectedCrane = true) {
  const inbound = kind === 'inbound';
  if (!inbound && kind !== 'outbound') throw new Error('Loại phiếu không hợp lệ');
  const table = inbound ? 'PhieuNhapBTP' : 'PhieuXuatBTP';
  const key = inbound ? 'ID_PhieuNhapBTP' : 'ID_PhieuXuatBTP';
  const warehouse = inbound ? 'ID_KhoNhap' : 'ID_KhoXuat';
  const result = await new sql.Request(executor).input('OrderID', sql.Int, id).query(
    `SELECT ${warehouse} AS WarehouseID, GhiChu FROM dbo.${table} WHERE ${key}=@OrderID AND TonTai=1`
  );
  const row = result.recordset[0];
  if (!row || (warehouseID != null && Number(row.WarehouseID) !== Number(warehouseID)) || isCraneNote(row.GhiChu) !== expectedCrane) {
    const err = new Error('Phiếu không thuộc nghiệp vụ ' + (expectedCrane ? 'cầu trục' : 'BTP thông thường'));
    err.statusCode = 409;
    throw err;
  }
  return row;
}

module.exports = { isCraneNote, assertCraneDocument };
