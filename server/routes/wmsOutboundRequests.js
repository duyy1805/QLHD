const express = require('express');
const sql = require('mssql');
const service = require('../utils/wmsOutboundRequest');

function errorResponse(res, error) {
    const status = error.statusCode || ([2601, 2627, 1205].includes(error.number) ? 409 : 500);
    if (status >= 500) console.error('[YeuCauXuatWMS]', error);
    return res.status(status).json({ ok: false, message: error.message || 'Không xử lý được yêu cầu xuất WMS' });
}

module.exports = function createWmsOutboundRequestRouter(poolPromise, getWarehouseID) {
    const router = express.Router();

    router.get('/btp/cau-truc/yeu-cau-xuat', async (req, res) => {
        try {
            const pool = await poolPromise;
            const warehouseID = await getWarehouseID(pool);
            const search = String(req.query.search || '').trim();
            const page = Math.max(0, Math.trunc(Number(req.query.page) || 0));
            const pageSize = Math.min(50, Math.max(1, Math.trunc(Number(req.query.pageSize) || 20)));
            const result = await pool.request().input('Kho', sql.Int, warehouseID)
                .input('Search', sql.NVarChar(255), search).input('Skip', sql.Int, page * pageSize)
                .input('Take', sql.Int, pageSize).query(`
                SELECT y.ID_YeuCauXuatWMS AS id,y.MaYeuCau AS maYeuCau,y.NgayYeuCau AS ngayYeuCau,
                    y.TrangThai AS trangThai,y.GhiChu AS ghiChu,y.DispatchAttempts AS dispatchAttempts,
                    y.DispatchError AS dispatchError,COUNT(c.ID_YeuCauXuatWMS_ChiTiet) AS itemCount,
                    ISNULL(SUM(CONVERT(bigint,c.SoLuong)),0) AS totalQuantity
                FROM dbo.YeuCauXuatWMS y
                LEFT JOIN dbo.YeuCauXuatWMS_ChiTiet c ON c.ID_YeuCauXuatWMS=y.ID_YeuCauXuatWMS
                WHERE y.ID_Kho=@Kho AND (@Search='' OR y.MaYeuCau LIKE '%'+@Search+'%'
                    OR y.GhiChu LIKE '%'+@Search+'%')
                GROUP BY y.ID_YeuCauXuatWMS,y.MaYeuCau,y.NgayYeuCau,y.TrangThai,y.GhiChu,
                    y.DispatchAttempts,y.DispatchError
                ORDER BY y.ID_YeuCauXuatWMS DESC OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY;`);
            return res.json({ ok: true, items: result.recordset, page, pageSize });
        } catch (error) { return errorResponse(res, error); }
    });

    router.post('/btp/cau-truc/yeu-cau-xuat', async (req, res) => {
        try {
            const pool = await poolPromise;
            const warehouseID = await getWarehouseID(pool);
            const userID = service.positiveId(req.body?.userID);
            const transaction = new sql.Transaction(pool);
            await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
            try {
                const result = await new sql.Request(transaction).input('Kho', sql.Int, warehouseID)
                    .input('User', sql.Int, userID).query(`
                    INSERT dbo.YeuCauXuatWMS(ID_Kho,ID_TaiKhoanTao) OUTPUT inserted.ID_YeuCauXuatWMS AS id
                    VALUES(@Kho,@User);`);
                const id = Number(result.recordset[0].id);
                const code = `YCX-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(id).padStart(6, '0')}`;
                await new sql.Request(transaction).input('ID', sql.Int, id).input('Code', sql.NVarChar(50), code).query(`
                    UPDATE dbo.YeuCauXuatWMS SET MaYeuCau=@Code WHERE ID_YeuCauXuatWMS=@ID;`);
                await transaction.commit();
                return res.status(201).json({ ok: true, id, maYeuCau: code, trangThai: 'DRAFT' });
            } catch (error) {
                try { await transaction.rollback(); } catch (_) { /* preserve error */ }
                throw error;
            }
        } catch (error) { return errorResponse(res, error); }
    });

    router.get('/btp/cau-truc/yeu-cau-xuat-hang-ton', async (req, res) => {
        try {
            const pool = await poolPromise;
            const warehouseID = await getWarehouseID(pool);
            const search = String(req.query.search || '').trim().slice(0, 255);
            const itemCode = String(req.query.itemCode || '').trim().slice(0, 255);
            const result = await pool.request()
                .input('Kho', sql.Int, warehouseID)
                .input('Search', sql.NVarChar(255), search)
                .input('ItemCode', sql.NVarChar(255), itemCode)
                .query(`
                ;WITH Used AS (
                    SELECT x.ID_TheKhoKienBTP_ChiTiet, SUM(x.SoLuong_XuatKho) AS DaXuat
                    FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien x
                    JOIN dbo.PhieuXuatBTP px ON px.ID_PhieuXuatBTP=x.ID_PhieuXuatBTP AND px.TonTai=1
                    GROUP BY x.ID_TheKhoKienBTP_ChiTiet
                ), Stock AS (
                    SELECT d.ItemCode,d.Ten_SanPham,d.DauTuan,
                        CASE WHEN d.SoLuong-ISNULL(u.DaXuat,0)>0 THEN d.SoLuong-ISNULL(u.DaXuat,0) ELSE 0 END AS SoLuongCon
                    FROM dbo.TheKhoKienBTP_ChiTiet d
                    JOIN dbo.TheKhoKienBTP k ON k.ID_TheKhoKienBTP=d.ID_TheKhoKienBTP AND ISNULL(k.TonTai,1)=1
                    JOIN dbo.DM_Kho_ViTri v ON v.ID_ViTriKho=k.ID_ViTriKho
                        AND v.ID_Kho=@Kho AND v.MaNha=N'Z76' AND v.MaKhuVuc IN (N'CT',N'CTT')
                        AND v.TonTai=1 AND v.SuDung=1
                    LEFT JOIN Used u ON u.ID_TheKhoKienBTP_ChiTiet=d.ID_TheKhoKienBTP_ChiTiet
                    WHERE ISNULL(d.TonTai,1)=1
                      AND v.MaViTriKho NOT IN (N'CT-TEMP',N'CT-TEMP-TEST')
                      AND NOT EXISTS (
                          SELECT 1 FROM dbo.CraneWmsOutboundPallet p
                          WHERE p.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP
                            AND p.Status IN ('WAITING_WMS','FAILED_RETRY','WAITING_RETURN')
                      )
                )
                SELECT ItemCode AS itemCode,MAX(NULLIF(LTRIM(RTRIM(Ten_SanPham)),N'')) AS itemName,
                    CASE WHEN @ItemCode=N'' THEN NULL ELSE NULLIF(LTRIM(RTRIM(DauTuan)),N'') END AS weekMark,
                    SUM(SoLuongCon) AS stockQuantity
                FROM Stock
                WHERE SoLuongCon>0 AND NULLIF(LTRIM(RTRIM(ItemCode)),N'') IS NOT NULL
                  AND (@ItemCode=N'' OR ItemCode=@ItemCode)
                  AND (@Search=N'' OR ItemCode LIKE N'%'+@Search+N'%' OR Ten_SanPham LIKE N'%'+@Search+N'%')
                GROUP BY ItemCode,CASE WHEN @ItemCode=N'' THEN NULL ELSE NULLIF(LTRIM(RTRIM(DauTuan)),N'') END
                ORDER BY ItemCode,weekMark;`);
            return res.json({ ok: true, items: result.recordset.map(row => ({
                ...row,
                stockQuantity: Number(row.stockQuantity || 0),
            })) });
        } catch (error) { return errorResponse(res, error); }
    });

    router.get('/btp/cau-truc/yeu-cau-xuat/:id', async (req, res) => {
        try {
            const id = service.positiveId(req.params.id);
            if (!id) return res.status(400).json({ ok: false, message: 'ID yêu cầu không hợp lệ' });
            const pool = await poolPromise;
            const header = (await pool.request().input('ID', sql.Int, id).query(`
                SELECT ID_YeuCauXuatWMS AS id,MaYeuCau AS maYeuCau,NgayYeuCau AS ngayYeuCau,
                    ID_Kho AS idKho,TrangThai AS trangThai,GhiChu AS ghiChu,DispatchAttempts AS dispatchAttempts,
                    DispatchError AS dispatchError,Revision AS revision,SentAt AS sentAt,CompletedAt AS completedAt
                FROM dbo.YeuCauXuatWMS WHERE ID_YeuCauXuatWMS=@ID`)).recordset[0];
            if (!header) return res.status(404).json({ ok: false, message: 'Không tìm thấy yêu cầu xuất' });
            const items = (await pool.request().input('ID', sql.Int, id).query(`
                SELECT ID_YeuCauXuatWMS_ChiTiet AS id,ItemCode AS itemCode,ItemName AS itemName,
                    Lot AS lot,SoLuong AS quantity,ThuTu AS sortOrder,SkipLotJson AS skipLotJson
                FROM dbo.YeuCauXuatWMS_ChiTiet WHERE ID_YeuCauXuatWMS=@ID ORDER BY ThuTu,ID_YeuCauXuatWMS_ChiTiet`)).recordset;
            const pallets = (await pool.request().input('ID', sql.Int, id).query(`
                SELECT ItemCode AS itemCode,Lot AS lot,RequestedQuantity AS requestedQuantity,
                    ExportedQuantity AS exportedQuantity,PalletID AS palletID,PalletQuantity AS quantity
                FROM dbo.YeuCauXuatWMS_KetQuaPallet WHERE ID_YeuCauXuatWMS=@ID
                ORDER BY ItemCode,Lot,PalletID`)).recordset;
            return res.json({ ok: true, ...header, editable: service.EDITABLE.has(header.trangThai), items: items.map(({ skipLotJson, ...item }) => ({ ...item, skipLot: skipLotJson ? JSON.parse(skipLotJson) : [] })), pallets });
        } catch (error) { return errorResponse(res, error); }
    });

    router.put('/btp/cau-truc/yeu-cau-xuat/:id', async (req, res) => {
        const id = service.positiveId(req.params.id);
        if (!id) return res.status(400).json({ ok: false, message: 'ID yêu cầu không hợp lệ' });
        let items;
        try { items = service.normalizeItems(req.body?.items); }
        catch (error) { return errorResponse(res, error); }
        const note = String(req.body?.ghiChu || '').trim().slice(0, 500) || null;
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
            const row = (await new sql.Request(transaction).input('ID', sql.Int, id).query(`
                SELECT TrangThai FROM dbo.YeuCauXuatWMS WITH (UPDLOCK,HOLDLOCK) WHERE ID_YeuCauXuatWMS=@ID`)).recordset[0];
            if (!row) { const error = new Error('Không tìm thấy yêu cầu xuất'); error.statusCode = 404; throw error; }
            if (!service.EDITABLE.has(row.TrangThai)) { const e = new Error('Yêu cầu đã gửi WMS nên không thể sửa'); e.statusCode = 409; throw e; }
            await new sql.Request(transaction).input('ID', sql.Int, id).input('Note', sql.NVarChar(500), note).query(`
                DELETE dbo.YeuCauXuatWMS_ChiTiet WHERE ID_YeuCauXuatWMS=@ID;
                UPDATE dbo.YeuCauXuatWMS SET GhiChu=@Note,RequestJson=NULL,DispatchError=NULL,
                    Revision=Revision+CASE WHEN TrangThai IN ('FAILED','REJECTED') THEN 1 ELSE 0 END,
                    TrangThai='DRAFT',UpdatedAt=SYSUTCDATETIME() WHERE ID_YeuCauXuatWMS=@ID;`);
            for (let index = 0; index < items.length; index++) {
                const item = items[index];
                await new sql.Request(transaction).input('ID', sql.Int, id)
                    .input('Code', sql.NVarChar(255), item.itemCode).input('Name', sql.NVarChar(500), item.itemName)
                    .input('Lot', sql.NVarChar(50), item.lot || null).input('Quantity', sql.Int, item.quantity)
                    .input('SkipLot', sql.NVarChar(sql.MAX), JSON.stringify(item.skipLot || []))
                    .input('Sort', sql.Int, index + 1).query(`
                    INSERT dbo.YeuCauXuatWMS_ChiTiet(ID_YeuCauXuatWMS,ItemCode,ItemName,Lot,SoLuong,ThuTu,SkipLotJson)
                    VALUES(@ID,@Code,@Name,@Lot,@Quantity,@Sort,@SkipLot);`);
            }
            await transaction.commit();
            return res.json({ ok: true, id, itemCount: items.length });
        } catch (error) {
            try { await transaction.rollback(); } catch (_) { /* preserve error */ }
            return errorResponse(res, error);
        }
    });

    router.delete('/btp/cau-truc/yeu-cau-xuat/:id', async (req, res) => {
        try {
            const id = service.positiveId(req.params.id);
            if (!id) return res.status(400).json({ ok: false, message: 'ID yêu cầu không hợp lệ' });
            const result = await (await poolPromise).request().input('ID', sql.Int, id).query(`
                DELETE dbo.YeuCauXuatWMS WHERE ID_YeuCauXuatWMS=@ID AND TrangThai='DRAFT';`);
            if (!result.rowsAffected[0]) return res.status(409).json({ ok: false, message: 'Chỉ được xóa yêu cầu đang nháp' });
            return res.json({ ok: true });
        } catch (error) { return errorResponse(res, error); }
    });

    router.post('/btp/cau-truc/yeu-cau-xuat/:id/send', async (req, res) => {
        try {
            const result = await service.dispatch(await poolPromise, req.params.id);
            return res.status(result.ok ? 200 : 502).json({ ...result, message: result.error || undefined });
        } catch (error) { return errorResponse(res, error); }
    });

    return router;
};
