const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPayload, dispatch, runSelectedPackageDispatch } = require('../utils/craneWmsInbound');

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
    assert.equal(payload.date, '2026-09-28T08:00:00.000Z');
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
    const state = { DispatchStatus: initialStatus, DispatchAttempts: 0, DispatchError: null, ResponseStatus: null,
        RequestJson: JSON.stringify({ orderID: '12', date: '2026-09-28T08:00:00.000Z', pallets: [
            { palletID: 'BP-1', items: [] }, { palletID: 'BP-2', items: [] },
        ] }) };
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
                        return { recordset: [{ RequestJson: state.RequestJson }] };
                    }
                    if (query.includes('SET RequestJson=@Payload')) {
                        state.RequestJson = values.Payload;
                        return { recordset: [] };
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

test('dispatch sends each pallet with its own idempotency key and does not resend a SENT order', async () => {
    const pool = fakePool('PENDING');
    let posts = 0;
    const post = async (_url, payload, options) => {
        posts++;
        assert.equal(payload.orderID, '12');
        assert.match(payload.date, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
        assert.equal(payload.pallets.length, 1);
        assert.match(payload.pallets[0].date, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
        assert.equal(options.headers['Idempotency-Key'], `inbound-12-${payload.pallets[0].palletID}`);
        return { status: 202 };
    };
    assert.equal((await dispatch(pool, 12, post)).DispatchStatus, 'SENT');
    assert.equal((await dispatch(pool, 12, post)).DispatchStatus, 'SENT');
    assert.equal(posts, 2);
});

test('failed WMS send keeps request retryable', async () => {
    const pool = fakePool('PENDING');
    const firstDates = [];
    const failed = await dispatch(pool, 12, async (_url, payload) => {
        firstDates.push(payload.pallets[0].date);
        throw new Error('timeout');
    });
    assert.equal(failed.DispatchStatus, 'FAILED');
    assert.match(failed.DispatchError, /timeout/);
    const retryDates = [];
    const retried = await dispatch(pool, 12, async (_url, payload) => {
        retryDates.push(payload.pallets[0].date);
        return { status: 202 };
    });
    assert.equal(retried.DispatchStatus, 'SENT');
    assert.equal(retried.DispatchAttempts, 2);
    assert.equal(retryDates[0], firstDates[0]);
    assert.equal(retryDates.length, 2);
    assert.notEqual(retryDates[0], undefined);
    assert.match(JSON.parse(pool.state.RequestJson).date, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test('selected inbound packages are sent sequentially while invalid packages are skipped', async () => {
    const calls = [];
    const results = await runSelectedPackageDispatch([11, 12, 13], {
        prepare: async (id) => {
            calls.push(`prepare:${id}`);
            if (id === 12) throw new Error('Thiếu QR');
            return null;
        },
        send: async (id) => {
            calls.push(`send:${id}`);
            return { DispatchStatus: 'SENT' };
        },
    });
    assert.deepEqual(calls, ['prepare:11', 'send:11', 'prepare:12', 'prepare:13', 'send:13']);
    assert.deepEqual(results, [
        { idPackage: 11, result: 'SENT' },
        { idPackage: 12, result: 'SKIPPED', message: 'Thiếu QR' },
        { idPackage: 13, result: 'SENT' },
    ]);
});

test('one failed selected package does not stop later packages', async () => {
    const sent = [];
    const results = await runSelectedPackageDispatch([21, 22], {
        prepare: async () => null,
        send: async (id) => {
            sent.push(id);
            return id === 21
                ? { DispatchStatus: 'FAILED', DispatchError: 'timeout' }
                : { DispatchStatus: 'SENT' };
        },
    });
    assert.deepEqual(sent, [21, 22]);
    assert.deepEqual(results, [
        { idPackage: 21, result: 'FAILED', message: 'timeout' },
        { idPackage: 22, result: 'SENT' },
    ]);
});
