const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPayload, dispatch } = require('../utils/craneWmsInbound');

const header = {
    ID_PhieuNhapBTP: 12,
    So_PhieuNhapBTP: 'PN-12',
    Ngay_NhapBTP: '2026-09-28T08:00:00.000Z',
};

test('inbound payload groups persisted detail rows by pallet and keeps each Lot', () => {
    const rows = [
        { QRCode: 'BP-1', ItemCode: 'A', Ten_SanPham: 'Hang A', DauTuan: 'W1', SoLuong: 30 },
        { QRCode: 'BP-1', ItemCode: 'B', Ten_SanPham: 'Hang B', DauTuan: 'W2', SoLuong: 20 },
        { QRCode: 'BP-2', ItemCode: 'A', Ten_SanPham: 'Hang A', DauTuan: 'W1', SoLuong: 10 },
    ];
    const payload = buildPayload(header, rows);
    assert.equal(payload.orderType, 'INBOUND');
    assert.equal(payload.orderID, '12');
    assert.equal(payload.pallets.length, 2);
    assert.deepEqual(payload.pallets[0].items.map(item => [item.Lot, item.quantity]), [['W1', 30], ['W2', 20]]);
    assert.deepEqual(payload.pallets[1].items.map(item => [item.Lot, item.quantity]), [['W1', 10]]);
});

test('missing WMS-required Lot rejects payload before confirmation commits', () => {
    assert.throws(() => buildPayload(header, [
        { QRCode: 'BP-1', ItemCode: 'A', Ten_SanPham: 'Hang A', DauTuan: null, SoLuong: 10 },
    ]), /dấu tuần/);
});

function fakePool(initialStatus) {
    const state = { DispatchStatus: initialStatus, DispatchAttempts: 0, DispatchError: null, ResponseStatus: null };
    return {
        state,
        request() {
            const values = {};
            return {
                input(name, _type, value) {
                    // mssql accepts both input(name, value) and input(name, type, value).
                    values[name] = arguments.length === 2 ? _type : value;
                    return this;
                },
                async query(query) {
                    if (query.includes('OUTPUT inserted.RequestJson')) {
                        if (!['PENDING', 'FAILED'].includes(state.DispatchStatus)) return { recordset: [] };
                        state.DispatchStatus = 'SENDING';
                        state.DispatchAttempts++;
                        return { recordset: [{ RequestJson: JSON.stringify({ orderID: '12' }) }] };
                    }
                    if (query.includes('SET DispatchStatus=@NextStatus')) {
                        state.DispatchStatus = values.NextStatus;
                        state.ResponseStatus = values.ResponseStatus;
                        state.DispatchError = values.DispatchError;
                        return { recordset: [] };
                    }
                    return { recordset: [state] };
                },
            };
        },
    };
}

test('dispatch posts once and does not resend a SENT inbound order', async () => {
    const pool = fakePool('PENDING');
    let posts = 0;
    const post = async (_url, payload, options) => {
        posts++;
        assert.equal(payload.orderID, '12');
        assert.equal(options.headers['Idempotency-Key'], 'inbound-12');
        return { status: 202 };
    };
    assert.equal((await dispatch(pool, 12, post)).DispatchStatus, 'SENT');
    assert.equal((await dispatch(pool, 12, post)).DispatchStatus, 'SENT');
    assert.equal(posts, 1);
});

test('failed WMS send keeps request retryable', async () => {
    const pool = fakePool('PENDING');
    const failed = await dispatch(pool, 12, async () => { throw new Error('timeout'); });
    assert.equal(failed.DispatchStatus, 'FAILED');
    assert.match(failed.DispatchError, /timeout/);
    const retried = await dispatch(pool, 12, async () => ({ status: 202 }));
    assert.equal(retried.DispatchStatus, 'SENT');
    assert.equal(retried.DispatchAttempts, 2);
});
