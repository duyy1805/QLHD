const express = require('express');
const service = require('../utils/wmsOutboundRequest');
const db = require('../utils/wmsOutboundRequestDb');

function errorResponse(res, error) {
    const status = error.statusCode || ([2601, 2627, 1205, 51000].includes(error.number) ? 409 : 500);
    if (status >= 500) console.error('[YeuCauXuatWMS]', error);
    return res.status(status).json({ ok: false, message: error.message || 'Không xử lý được yêu cầu xuất WMS' });
}

module.exports = function createWmsOutboundRequestRouter(poolPromise, getWarehouseID) {
    const router = express.Router();
    router.get('/btp/cau-truc/yeu-cau-xuat/don-vi', async (_req, res) => {
        try { const r = await db.request(await poolPromise).execute(db.PROCEDURES.units); return res.json({ ok: true, items: r.recordset || [] }); }
        catch (error) { return errorResponse(res, error); }
    });
    router.get('/btp/cau-truc/yeu-cau-xuat/bo-phan', async (req, res) => {
        try { const id = service.positiveId(req.query.idDonVi); if (!id) return res.status(400).json({ ok: false, message: 'Đơn vị không hợp lệ' });
            const r = await db.request(await poolPromise).input('ID_DonVi', db.sql.Int, id).execute(db.PROCEDURES.departments);
            return res.json({ ok: true, items: r.recordset || [] }); } catch (error) { return errorResponse(res, error); }
    });
    router.get('/btp/cau-truc/yeu-cau-xuat', async (req, res) => {
        try { const pool = await poolPromise, page = Math.max(0, Math.trunc(Number(req.query.page) || 0));
            const pageSize = Math.min(50, Math.max(1, Math.trunc(Number(req.query.pageSize) || 20)));
            const r = await db.request(pool).input('ID_Kho', db.sql.Int, await getWarehouseID(pool))
                .input('Search', db.sql.NVarChar(255), String(req.query.search || '').trim().slice(0, 255))
                .input('Skip', db.sql.Int, page * pageSize).input('Take', db.sql.Int, pageSize).execute(db.PROCEDURES.list);
            return res.json({ ok: true, items: r.recordset || [], page, pageSize }); } catch (error) { return errorResponse(res, error); }
    });
    router.post('/btp/cau-truc/yeu-cau-xuat', async (req, res) => {
        try { const pool = await poolPromise; const r = await db.request(pool)
                .input('ID_Kho', db.sql.Int, await getWarehouseID(pool)).input('ID_TaiKhoan', db.sql.Int, service.positiveId(req.body?.userID))
                .execute(db.PROCEDURES.insert); return res.status(201).json({ ok: true, ...r.recordset[0] }); }
        catch (error) { return errorResponse(res, error); }
    });
    router.get('/btp/cau-truc/yeu-cau-xuat-hang-ton', async (req, res) => {
        try { const pool = await poolPromise; const r = await db.request(pool)
                .input('ID_Kho', db.sql.Int, await getWarehouseID(pool)).input('Search', db.sql.NVarChar(255), String(req.query.search || '').trim().slice(0, 255))
                .input('ItemCode', db.sql.NVarChar(255), String(req.query.itemCode || '').trim().slice(0, 255)).execute(db.PROCEDURES.stock);
            return res.json({ ok: true, items: (r.recordset || []).map(x => ({ ...x, stockQuantity: Number(x.stockQuantity || 0) })) }); }
        catch (error) { return errorResponse(res, error); }
    });
    router.get('/btp/cau-truc/yeu-cau-xuat/:id', async (req, res) => {
        try { const id = service.positiveId(req.params.id); if (!id) return res.status(400).json({ ok: false, message: 'ID yêu cầu không hợp lệ' });
            const r = await db.request(await poolPromise).input('ID_YeuCauXuatWMS', db.sql.Int, id).execute(db.PROCEDURES.select);
            const header = r.recordsets?.[0]?.[0]; if (!header) return res.status(404).json({ ok: false, message: 'Không tìm thấy yêu cầu xuất' });
            const items = (r.recordsets?.[1] || []).map(({ skipLotJson, ...x }) => ({ ...x, skipLot: skipLotJson ? JSON.parse(skipLotJson) : [] }));
            return res.json({ ok: true, ...header, editable: service.EDITABLE.has(header.trangThai), items,
                pallets: r.recordsets?.[2] || [], erpDocuments: r.recordsets?.[3] || [],
                palletTracking: r.recordsets?.[4] || [] }); } catch (error) { return errorResponse(res, error); }
    });
    router.put('/btp/cau-truc/yeu-cau-xuat/:id', async (req, res) => {
        try { const id = service.positiveId(req.params.id), idDonVi = service.positiveId(req.body?.idDonVi), idBoPhan = service.positiveId(req.body?.idBoPhan);
            if (!id || !idDonVi || !idBoPhan) return res.status(400).json({ ok: false, message: 'Yêu cầu, đơn vị hoặc bộ phận không hợp lệ' });
            const items = service.normalizeItems(req.body?.items); const r = await db.request(await poolPromise)
                .input('ID_YeuCauXuatWMS', db.sql.Int, id).input('ID_DonVi', db.sql.Int, idDonVi).input('ID_BoPhan', db.sql.Int, idBoPhan)
                .input('GhiChu', db.sql.NVarChar(500), String(req.body?.ghiChu || '').trim().slice(0, 500) || null)
                .input('Items', db.itemTable(items)).execute(db.PROCEDURES.save);
            return res.json({ ok: true, ...(r.recordset?.[0] || { id, itemCount: items.length }) }); } catch (error) { return errorResponse(res, error); }
    });
    router.delete('/btp/cau-truc/yeu-cau-xuat/:id', async (req, res) => {
        try { const id = service.positiveId(req.params.id); if (!id) return res.status(400).json({ ok: false, message: 'ID yêu cầu không hợp lệ' });
            await db.request(await poolPromise).input('ID_YeuCauXuatWMS', db.sql.Int, id).execute(db.PROCEDURES.remove); return res.json({ ok: true }); }
        catch (error) { return errorResponse(res, error); }
    });
    router.post('/btp/cau-truc/yeu-cau-xuat/:id/send', async (req, res) => {
        try { const r = await service.dispatch(await poolPromise, req.params.id); return res.status(r.ok ? 200 : 502).json({ ...r, message: r.error || undefined }); }
        catch (error) { return errorResponse(res, error); }
    });
    router.post('/btp/cau-truc/yeu-cau-xuat/:id/retry-erp', async (req, res) => {
        try { const id = service.positiveId(req.params.id); if (!id) return res.status(400).json({ ok: false, message: 'ID yêu cầu không hợp lệ' });
            const r = await db.request(await poolPromise).input('ID_YeuCauXuatWMS', db.sql.Int, id).execute(db.PROCEDURES.postErp);
            return res.json({ ok: true, documents: r.recordset || [] }); } catch (error) { return errorResponse(res, error); }
    });
    return router;
};
