const test = require('node:test');
const assert = require('node:assert/strict');
const { buildItems, dispatch } = require('../utils/craneOutboundDispatch');

const rows = [
    { ItemCode: 'A.CP', Ten_SanPham: 'Sản phẩm A', DauTuan: null, SoLuong_XuatKho: 300 },
    { ItemCode: 'B.CP', Ten_SanPham: 'Sản phẩm B', DauTuan: '2640', SoLuong_XuatKho: 100 },
];

test('WMS payload includes skipLot for the matching itemCode', () => {
    const items = buildItems(rows, { 'A.CP': ['2639', '2641', '2639'] });
    assert.deepEqual(items[0], {
        itemCode: 'A.CP', itemName: 'Sản phẩm A', skipLot: ['2639', '2641'], quantity: 300,
    });
    assert.deepEqual(items[1], {
        itemCode: 'B.CP', itemName: 'Sản phẩm B', lot: '2640', quantity: 100,
    });
});

test('skipLot may apply to the entire order and is absent by default', () => {
    assert.deepEqual(buildItems(rows)[0], {
        itemCode: 'A.CP', itemName: 'Sản phẩm A', quantity: 300,
    });
    assert.deepEqual(buildItems(rows, ['2639']).map(item => item.skipLot), [['2639'], ['2639']]);
    assert.deepEqual(buildItems(rows, { 'A.CP': [] })[0].skipLot, undefined);
});

test('a fixed lot cannot be excluded or supplied with invalid skipLot data', () => {
    assert.throws(() => buildItems(rows, { 'B.CP': ['2640'] }), /vừa được chỉ định xuất/);
    assert.throws(() => buildItems(rows, { 'OTHER': ['2640'] }), /itemCode/);
    assert.throws(() => buildItems(rows, { 'A.CP': [2640] }), /chuỗi dấu tuần/);
    assert.throws(() => buildItems(rows, { 'A.CP': [''] }), /chuỗi dấu tuần/);
});

function mockOutboundPool() {
    const state = { dispatch: null, detailRows: rows.map(row => ({ ...row })) };
    return {
        state,
        request() {
            const params = {};
            return {
                input(name, _type, value) {
                    params[name] = arguments.length === 2 ? _type : value;
                    return this;
                },
                async execute(name) {
                    assert.equal(name, 'dbo.App_BTP_PhieuXuat_ThongTinChiTiet');
                    return { recordsets: [[], state.detailRows] };
                },
                async query(query) {
                    if (query.includes('SELECT ID_PhieuXuatBTP, ID_KhoXuat')) return { recordset: [{
                        ID_PhieuXuatBTP: 42, ID_KhoXuat: 8, QrStatus: 0,
                        So_PhieuXuatBTP: 'PX-42', Ngay_XuatBTP: '2026-10-15T04:00:00Z',
                    }] };
                    if (query.startsWith('SELECT RequestJson')) return { recordset: state.dispatch ? [state.dispatch] : [] };
                    if (query.startsWith('SELECT DispatchStatus')) return { recordset: state.dispatch ? [state.dispatch] : [] };
                    if (query.includes('BEGIN TRY') && query.includes('ClaimAttempt')) {
                        const current = state.dispatch;
                        if (!current) {
                            state.dispatch = { RequestJson: params.Payload, DispatchStatus: 'SENDING', DispatchAttempts: 1, Revision: 1, DispatchError: null };
                            return { recordsets: [[{ ClaimAttempt: 1, ClaimRevision: 1 }]] };
                        }
                        if (['FAILED', 'REJECTED'].includes(current.DispatchStatus)) {
                            if (current.DispatchStatus === 'REJECTED' || current.RequestJson !== params.Payload) {
                                current.Revision++;
                                current.RequestJson = params.Payload;
                            } else current.RequestJson ||= params.Payload;
                            current.DispatchStatus = 'SENDING';
                            current.DispatchAttempts++;
                            current.DispatchError = null;
                            return { recordsets: [[{ ClaimAttempt: current.DispatchAttempts, ClaimRevision: current.Revision }]] };
                        }
                        return { recordsets: [[], []] };
                    }
                    if (query.includes('DispatchStatus=@State')) {
                        if (state.dispatch?.DispatchStatus === 'SENDING' && state.dispatch.DispatchAttempts === params.Attempt) {
                            state.dispatch.DispatchStatus = params.State;
                            state.dispatch.DispatchError = params.Error;
                        }
                        return { rowsAffected: [1] };
                    }
                    throw new Error(`Unexpected mocked SQL: ${query.slice(0, 80)}`);
                },
            };
        },
    };
}

test('failed delivery retries the exact saved request and preserves the original skipLot', async () => {
    const pool = mockOutboundPool();
    const sent = [];
    let failOnce = true;
    const post = async (_url, payload, config) => {
        sent.push(JSON.stringify(payload));
        assert.equal(config.headers['Idempotency-Key'], 'outbound-42');
        if (failOnce) { failOnce = false; throw new Error('WMS temporarily unavailable'); }
        return { status: 202 };
    };

    const first = await dispatch(pool, 42, 8, post, { 'A.CP': ['02639', '2641'] });
    assert.equal(first.status, 502);
    assert.equal(first.dispatch.DispatchStatus, 'FAILED');
    const original = pool.state.dispatch.RequestJson;

    pool.state.detailRows = [{ ItemCode: 'OTHER', Ten_SanPham: 'New item', SoLuong_XuatKho: 999 }];
    const second = await dispatch(pool, 42, 8, post);
    assert.equal(second.status, 200);
    assert.equal(second.dispatch.DispatchStatus, 'SENT');
    assert.equal(pool.state.dispatch.RequestJson, original);
    assert.equal(pool.state.dispatch.DispatchAttempts, 2);
    assert.deepEqual(sent, [original, original]);
    assert.deepEqual(JSON.parse(original).items[0].skipLot, ['02639', '2641']);

    const repeated = await dispatch(pool, 42, 8, post);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.alreadySent, true);
    assert.equal(sent.length, 2);
});

test('a failed dispatch accepts revised exclusions while keeping the WMS idempotency key', async () => {
    const pool = mockOutboundPool();
    const keys = [];
    const post = async (_url, _payload, config) => {
        keys.push(config.headers['Idempotency-Key']);
        return { status: 202 };
    };
    const first = await dispatch(pool, 42, 8, async () => { throw new Error('Temporary failure'); }, { 'A.CP': ['2639'] });
    assert.equal(first.status, 502);
    const changed = await dispatch(pool, 42, 8, post, { 'A.CP': ['2641'] });
    assert.equal(changed.status, 200);
    assert.deepEqual(keys, ['outbound-42']);
    assert.deepEqual(JSON.parse(pool.state.dispatch.RequestJson).items[0].skipLot, ['2641']);
    assert.equal(pool.state.dispatch.DispatchAttempts, 2);
});

test('WMS stock rejection permits revised skipLot with the same WMS idempotency key', async () => {
    const pool = mockOutboundPool();
    const sentKeys = [];
    const post = async (_url, _payload, config) => {
        sentKeys.push(config.headers['Idempotency-Key']);
        return { status: 202 };
    };
    assert.equal((await dispatch(pool, 42, 8, post, { 'A.CP': ['2639'] })).status, 200);
    pool.state.dispatch.DispatchStatus = 'REJECTED'; // simulate validated stock-rejection callback
    const revised = await dispatch(pool, 42, 8, post, { 'A.CP': ['2641'] });
    assert.equal(revised.status, 200);
    assert.deepEqual(sentKeys, ['outbound-42', 'outbound-42']);
    assert.equal(pool.state.dispatch.Revision, 2);
    assert.deepEqual(JSON.parse(pool.state.dispatch.RequestJson).items[0].skipLot, ['2641']);
});
