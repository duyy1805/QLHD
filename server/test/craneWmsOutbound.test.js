const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, allocate } = require('../utils/craneWmsOutbound');
const payload = () => ({ eventID: 'event-1', orderID: '12', orderCode: 'PX-12', orderType: 'OUTBOUND',
    processedAt: '2026-09-29T00:00:00Z', status: 'COMPLETED', items: [{ itemCode: 'A.CP', lot: '2639',
        requestedQuantity: 300, exportedQuantity: 300, pallets: [{ palletID: 'QR1', quantity: 300 }] }] });
const line = (order, quantity, product = 1) => ({ ID_DonHang: order, ID_DonHang_LoSanXuat: 1,
    ID_DonHang_SanPham: product, ItemCode: 'A.CP', SoLuong_XuatKho: quantity });
test('requires event ID and full success; rejects mismatched pallet sums', () => {
    for (const update of [{eventID:''},{status:'PARTIAL'},{status:'FAILED'}]) {
        assert.throws(() => normalize({...payload(),...update}), e => [400,422].includes(e.statusCode));
    }
    const p=payload();p.items[0].exportedQuantity=299;
    assert.throws(()=>normalize(p),e=>e.statusCode===422);
    p.items[0].exportedQuantity=300;p.items[0].pallets[0].quantity=301;
    assert.throws(()=>normalize(p),e=>e.statusCode===400);
});
test('canonical event is stable when lots and pallets are reordered', () => {
    const p=payload();p.items[0].pallets=[{palletID:'B',quantity:100},{palletID:'A',quantity:200}];
    p.items.push({...p.items[0],lot:'2640'});
    const a=normalize(p);p.items.reverse();p.items.forEach(i=>i.pallets.reverse());
    assert.deepEqual(normalize(p),a);
});
test('duplicate QR in one item/lot and duplicate item/lot are rejected',()=>{
    const p=payload();p.items.push({...p.items[0]});assert.throws(()=>normalize(p));
    p.items.pop();p.items[0].pallets.push({...p.items[0].pallets[0]});assert.throws(()=>normalize(p));
});
test('allocation ignores source order and fills stable destination order/lot/product keys',()=>{
    const result=allocate([line(20,200),line(10,100)],normalize(payload()).items);
    assert.deepEqual(result.map(x=>[x.row.ID_DonHang,x.quantity]),[[10,100],[20,200]]);
});
test('multiple week marks fill the same ERP item across multiple lines',()=>{
    const p=payload();p.items[0].requestedQuantity=p.items[0].exportedQuantity=p.items[0].pallets[0].quantity=100;
    p.items.push({itemCode:'A.CP',lot:'2640',requestedQuantity:200,exportedQuantity:200,pallets:[{palletID:'QR2',quantity:200}]});
    const result=allocate([line(1,150),line(1,150,2)],normalize(p).items);
    assert.deepEqual(result.map(x=>[x.lot,x.row.ID_DonHang_SanPham,x.quantity]),[['2639',1,100],['2640',1,50],['2640',2,150]]);
});
test('ERP requested quantities and item codes must match exactly',()=>{
    for(const details of [[line(1,299)],[line(1,301)],[{...line(1,300),ItemCode:'B'}]])
        assert.throws(()=>allocate(details,normalize(payload()).items),e=>e.statusCode===422);
});
