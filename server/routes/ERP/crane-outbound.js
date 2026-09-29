const express = require('express');
const sql = require('mssql');
const checkApiKey = require('../../middleware/apiKey');
const crane = require('../../utils/craneWms');
const outbound = require('../../utils/craneWmsOutbound');

module.exports = function createCraneOutboundRouter(poolPromise, { isTest = false } = {}) {
    const router = express.Router();
    const errorResponse = (res, error) => {
        console.error('[WMS outbound]', error.message);
        const status = error.statusCode || ([2601, 2627, 1205, 51051].includes(error.number) ? 409 : 500);
        return res.status(status).json({ success: false, message: error.statusCode ? error.message :
            status === 409 ? 'Xung đột xử lý; gửi lại cùng eventID để kiểm tra kết quả' : 'Không xử lý được phiếu xuất WMS' });
    };
    router.get('/wms/outbound-orders', checkApiKey, async (req, res) => {
        try {
            const pool = await poolPromise, cfg = await outbound.config(pool, isTest);
            const page = Number(req.query.page ?? 0), pageSize = Number(req.query.pageSize ?? 100);
            if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500 || page * pageSize > 2147483647)
                throw crane.craneError(400, 'page >= 0; pageSize từ 1 đến 500');
            const request = pool.request().input('Warehouse', sql.Int, cfg.warehouseID)
                .input('Search', sql.NVarChar(255), String(req.query.soPhieu || '').trim())
                .input('Skip', sql.Int, page * pageSize).input('Take', sql.Int, pageSize);
            const result = await request.query(`
                SELECT ID_PhieuXuatBTP AS orderID,So_PhieuXuatBTP AS orderCode,Ngay_XuatBTP AS date,
                    ID_KhoXuat AS warehouseID, ISNULL(QrStatus,0) AS qrStatus, TrangThai AS erpStatus
                FROM dbo.PhieuXuatBTP
                WHERE TonTai=1 AND ISNULL(TrangThai,0)<>5 AND ID_KhoXuat=@Warehouse
                    AND (@Search='' OR So_PhieuXuatBTP LIKE '%'+@Search+'%')
                ORDER BY Ngay_XuatBTP DESC,ID_PhieuXuatBTP DESC OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;`);
            return res.json({ ok: true, page, pageSize, count: result.recordset.length,
                data: result.recordset.map(row => ({ ...row, orderID: String(row.orderID), orderType: 'OUTBOUND' })) });
        } catch (error) { return errorResponse(res, error); }
    });
    router.get('/wms/outbound-orders/:id', checkApiKey, async (req, res, next) => {
        try {
            const id = crane.positiveId(req.params.id);
            if (!id) throw crane.craneError(400, 'ID phiếu xuất không hợp lệ');
            const pool = await poolPromise;
            const row = (await pool.request().input('ID', sql.Int, id)
                .query('SELECT * FROM dbo.PhieuXuatBTP WHERE ID_PhieuXuatBTP=@ID AND TonTai=1')).recordset[0];
            if (!row) throw crane.craneError(404, 'Không tìm thấy phiếu xuất');
            const cfg = await outbound.config(pool, isTest);
            if (Number(row.ID_KhoXuat) !== cfg.warehouseID || Number(row.TrangThai) === 5)
                throw crane.craneError(409, 'Phiếu không thuộc kho cầu trục hoặc đã ghi thẻ kho');
            const details = await outbound.loadDetails(pool, id);
            const items = new Map();
            for (const d of details) {
                const quantity = Number(d.SoLuong_XuatKho);
                if (!Number.isSafeInteger(quantity) || quantity <= 0) throw crane.craneError(422, 'Số lượng phiếu phải là số nguyên dương');
                if (!items.has(d.ItemCode)) items.set(d.ItemCode, { itemCode: d.ItemCode, itemName: d.Ten_SanPham, quantity: 0 });
                items.get(d.ItemCode).quantity += quantity;
            }
            if (!items.size) throw crane.craneError(422, 'Phiếu chưa có dòng yêu cầu xuất');
            return res.json({ ok: true, data: { orderID: String(id), orderCode: row.So_PhieuXuatBTP,
                orderType: 'OUTBOUND', date: new Date(row.Ngay_XuatBTP).toISOString(), warehouseID: cfg.warehouseID,
                qrStatus: Boolean(row.QrStatus), erpStatus: Number(row.TrangThai), items: [...items.values()] } });
        } catch (error) { return errorResponse(res, error); }
    });
    router.post('/wms/outbound-callback', checkApiKey, async (req, res, next) => {
        try {
            const body = req.body || {}, pool = await poolPromise;
            if (body.eventID == null) {
                const id = crane.positiveId(body.orderID);
                if (id) {
                    const row = (await pool.request().input('ID', sql.Int, id).query(`
                        IF OBJECT_ID(N'dbo.CraneWmsOutbound',N'U') IS NULL
                            SELECT QrStatus, CAST(NULL AS varchar(24)) AS DispatchStatus FROM dbo.PhieuXuatBTP
                            WHERE ID_PhieuXuatBTP=@ID AND TonTai=1;
                        ELSE
                        SELECT p.QrStatus, o.DispatchStatus FROM dbo.PhieuXuatBTP p
                        LEFT JOIN dbo.CraneWmsOutbound o ON o.ID_PhieuXuatBTP=p.ID_PhieuXuatBTP
                        WHERE p.ID_PhieuXuatBTP=@ID AND p.TonTai=1`)).recordset[0];
                    if (row?.QrStatus && row.DispatchStatus !== 'WMS_CONFIRMED') return next();
                }
            }
            return res.json(await outbound.confirm(pool, body, isTest));
        } catch (error) { return errorResponse(res, error); }
    });
    return router;
};
