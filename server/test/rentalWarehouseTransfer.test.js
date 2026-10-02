const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  isSupportedRentalExport,
  hasRentalTransferMarker,
  isMarkedRentalExport,
  isRentalTransfer,
  rentalTransferDirection,
  assertFullRentalPackageSelection,
} = require('../utils/rentalWarehouseTransfer');

test('recognizes supported transfers to warehouse 35 and back to warehouse 5', () => {
  assert.equal(isSupportedRentalExport({ ID_KhoXuat: 4, ID_KhoNhap: 35 }), true);
  assert.equal(isSupportedRentalExport({ ID_KhoXuat: 35, ID_KhoNhap: 5 }), true);
  assert.equal(isSupportedRentalExport({ ID_KhoXuat: 35, ID_KhoNhap: 4 }), false);
  assert.equal(isSupportedRentalExport({ ID_KhoXuat: 4, ID_KhoNhap: 5 }), false);
});

test('recognizes the explicit rental-transfer note marker', () => {
  assert.equal(hasRentalTransferMarker({ GhiChu: 'Điều chuyển [khothue] tháng 10' }), true);
  assert.equal(hasRentalTransferMarker({ GhiChuPhieuXuat: ['[KHOTHUE]', '[KHOTHUE]'] }), true);
  assert.equal(hasRentalTransferMarker({ GhiChu: 'chuyển kho thông thường' }), false);
  assert.equal(isMarkedRentalExport({ ID_KhoXuat: 4, ID_KhoNhap: 35, GhiChu: '[KHOTHUE]' }), true);
  assert.equal(isMarkedRentalExport({ ID_KhoXuat: 4, ID_KhoNhap: 35 }), false);
});

test('an import is locked only when it has a marked source export', () => {
  assert.equal(isRentalTransfer({ ID_PhieuXuatBTP: 10, ID_KhoXuat: 4, ID_KhoNhap: 35, GhiChuPhieuXuat: '[KHOTHUE]' }), true);
  assert.equal(isRentalTransfer({ ID_PhieuXuatBTP: 10, ID_KhoXuat: 4, ID_KhoNhap: 35 }), false);
  assert.equal(isRentalTransfer({ ID_PhieuXuatBTP: null, ID_KhoXuat: 4, ID_KhoNhap: 35, GhiChuPhieuXuat: '[KHOTHUE]' }), false);
  assert.equal(isRentalTransfer({ ID_PhieuXuatBTP: 11, ID_KhoXuat: 35, ID_KhoNhap: 5, GhiChuPhieuXuat: '[KHOTHUE]' }), true);
});

test('direction remains stable for duplicate SQL column arrays', () => {
  assert.equal(rentalTransferDirection({ ID_KhoNhap: [35, 35] }), 'TO_RENTAL_WAREHOUSE');
  assert.equal(rentalTransferDirection({ ID_KhoNhap: [5, 5] }), 'TO_FACTORY');
});

test('full-package validation aggregates duplicate picked details', async () => {
  const inputs = new Map();
  let queryText = '';
  const request = {
    input(name, _type, value) {
      inputs.set(name, value);
      return this;
    },
    async query(text) {
      queryText = text;
      return { recordset: [] };
    },
  };
  const sql = { Int: 'Int', Decimal: () => 'Decimal' };
  await assertFullRentalPackageSelection(request, sql, 20, [
    { IdTheKhoKienBTPChiTiet: 7, SoLuongXuatKho: 2 },
    { IdTheKhoKienBTPChiTiet: 7, SoLuongXuatKho: 3 },
  ]);
  assert.equal(inputs.get('RentalExportID'), 20);
  assert.equal(inputs.get('RentalDetail0'), 7);
  assert.equal(inputs.get('RentalQuantity0'), 5);
  assert.match(queryText, /UPDLOCK, HOLDLOCK/);
});

test('full-package validation rejects a partial package result', async () => {
  const request = {
    input() { return this; },
    async query() { return { recordset: [{ InvalidSelection: 1 }] }; },
  };
  const sql = { Int: 'Int', Decimal: () => 'Decimal' };
  await assert.rejects(
    assertFullRentalPackageSelection(request, sql, 20, [
      { IdTheKhoKienBTPChiTiet: 7, SoLuongXuatKho: 2 },
    ]),
    /chỉ cho phép xuất nguyên kiện/i,
  );
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

test('main and test routes expose the same rental-transfer protections', () => {
  for (const file of ['khotm.js', 'khotmtest.js']) {
    const route = fs.readFileSync(path.resolve(__dirname, `../routes/${file}`), 'utf8');
    assert.match(route, /isMarkedRentalExport/);
    assert.match(route, /packagesLocked:\s*isRentalTransfer/);
    assert.match(route, /allowRentalTransfer:\s*true/);
    assert.doesNotMatch(route, /KhoTM_BTP_TaoKienNhapChuyenKhoThue/);
    assert.match(route, /\[KHOTHUE\]/);
    assert.match(route, /filterUnconfirmedRentalPackages/);
    assert.match(route, /loadPackageLineageHistory/);
    assert.match(route, /ID_TheKhoKienBTP_Nguon/);
    assert.match(route, /CHUYEN_KHO_THUE|rentalTransfer/);
  }
});
