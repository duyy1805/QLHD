const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcilePallets, outboundFingerprint } = require('../utils/craneWms');

const pallet = { PalletID: 'P-1', InitialQuantity: 500, PlannedQuantity: 300 };
const items = (quantity) => [{ pallets: quantity ? [{ palletID: 'P-1', quantity }] : [] }];

test('500 planned 300 and WMS exports 300 leaves 200 waiting for return', () => {
    const [result] = reconcilePallets([pallet], items(300));
    assert.equal(result.actual, 300);
    assert.equal(result.remaining, 200);
    assert.equal(result.nextStatus, 'WAITING_RETURN');
});

test('full export and partial WMS result classify correctly', () => {
    assert.equal(reconcilePallets([{ ...pallet, PlannedQuantity: 500 }], items(500))[0].nextStatus, 'EXPORTED_FULL');
    assert.equal(reconcilePallets([pallet], items(200))[0].remaining, 300);
    assert.equal(reconcilePallets([pallet], items(0))[0].nextStatus, 'NOT_USED');
});

test('unselected or over quantity callback is rejected', () => {
    assert.throws(() => reconcilePallets([pallet], [{ pallets: [{ palletID: 'P-2', quantity: 1 }] }]), { statusCode: 409 });
    assert.throws(() => reconcilePallets([pallet], items(301)), { statusCode: 409 });
});

test('replayed callback fingerprint ignores ordering and processing timestamp', () => {
    const a = { itemCode: 'A', lot: 'W1', requestedQuantity: 300, exportedQuantity: 300,
        pallets: [{ palletID: 'P-2', quantity: 100 }, { palletID: 'P-1', quantity: 200 }] };
    const b = { itemCode: 'B', lot: 'W2', requestedQuantity: 10, exportedQuantity: 0, pallets: [] };
    assert.equal(outboundFingerprint('PARTIAL', [a, b]), outboundFingerprint('PARTIAL',
        [b, { ...a, pallets: [...a.pallets].reverse() }]));
});
