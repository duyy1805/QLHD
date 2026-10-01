const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isSupportedRentalExport,
  isRentalTransfer,
  rentalTransferDirection,
} = require('../utils/rentalWarehouseTransfer');

test('recognizes supported transfers to warehouse 35 and back to warehouse 5', () => {
  assert.equal(isSupportedRentalExport({ ID_KhoXuat: 4, ID_KhoNhap: 35 }), true);
  assert.equal(isSupportedRentalExport({ ID_KhoXuat: 35, ID_KhoNhap: 5 }), true);
  assert.equal(isSupportedRentalExport({ ID_KhoXuat: 35, ID_KhoNhap: 4 }), false);
  assert.equal(isSupportedRentalExport({ ID_KhoXuat: 4, ID_KhoNhap: 5 }), false);
});

test('an import is locked only when it has a source export', () => {
  assert.equal(isRentalTransfer({ ID_PhieuXuatBTP: 10, ID_KhoXuat: 4, ID_KhoNhap: 35 }), true);
  assert.equal(isRentalTransfer({ ID_PhieuXuatBTP: null, ID_KhoXuat: 4, ID_KhoNhap: 35 }), false);
  assert.equal(isRentalTransfer({ ID_PhieuXuatBTP: 11, ID_KhoXuat: 35, ID_KhoNhap: 5 }), true);
});

test('direction remains stable for duplicate SQL column arrays', () => {
  assert.equal(rentalTransferDirection({ ID_KhoNhap: [35, 35] }), 'TO_RENTAL_WAREHOUSE');
  assert.equal(rentalTransferDirection({ ID_KhoNhap: [5, 5] }), 'TO_FACTORY');
});

test('migration creates dedicated locations, full-package guard, lineage and transfer history', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../migrations/20260930_rental_warehouse_transfer.sql'),
    'utf8',
  );
  assert.match(sql, /KT-NEN-01/);
  assert.match(sql, /KT-CNK-01/);
  assert.match(sql, /KhoTM_BTP_TaoKienNhapChuyenKhoThue/);
  assert.match(sql, /ID_TheKhoKienBTP_Xuat/);
  assert.match(sql, /CHUYEN_KHO_THUE/);
  assert.match(sql, /chỉ cho phép xuất nguyên kiện/i);
  assert.doesNotMatch(sql, /30179/);
});
