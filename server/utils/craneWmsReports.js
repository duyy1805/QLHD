const sql = require('mssql');

const STATUS_LABELS = {
    PENDING: 'Đang chờ gửi WMS', SENDING: 'Đang gửi WMS', SENT: 'Đã gửi WMS', FAILED: 'Gửi WMS lỗi',
    REJECTED: 'WMS từ chối', WAITING_WMS: 'Chờ WMS xác nhận xuất', FAILED_RETRY: 'Xuất lỗi, có thể gửi lại',
    WAITING_RETURN: 'Chờ nhập lại phần còn', RETURNED: 'Đã nhập lại', EXPORTED_FULL: 'Đã xuất hết', COMPLETE: 'Hoàn tất',
};

function dateValue(value, fallback) {
    if (!value) return fallback;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('Khoảng thời gian không hợp lệ'), { status: 400 });
    return date;
}

function filters(query = {}) {
    const to = dateValue(query.to, new Date());
    const from = dateValue(query.from, new Date(to.getTime() - 30 * 86400000));
    if (from >= to) throw Object.assign(new Error('Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc'), { status: 400 });
    const pageIndex = Number(query.pageIndex ?? 0);
    const pageSize = Math.min(100, Number(query.pageSize ?? 20));
    const slaMinutes = Math.min(10080, Math.max(1, Number(query.slaMinutes ?? 30)));
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || !Number.isInteger(pageSize) || pageSize < 1 ||
        !Number.isInteger(slaMinutes)) throw Object.assign(new Error('Bộ lọc báo cáo không hợp lệ'), { status: 400 });
    const search = String(query.search || '').trim().slice(0, 255);
    const status = String(query.status || '').trim().toUpperCase().slice(0, 24);
    return { from, to, pageIndex, pageSize, offset: pageIndex * pageSize, slaMinutes, search, status };
}

function quantityFromInbound(payload) {
    try {
        return (JSON.parse(payload)?.pallets || []).flatMap(p => p.items || [])
            .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    } catch (_) { return 0; }
}

function outboundPayload(payload) {
    try {
        const body = JSON.parse(payload);
        return {
            requestedQuantity: (body.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
            skipLot: (body.items || []).flatMap(item => (item.skipLot || []).map(lot => ({ itemCode: item.itemCode, lot }))),
        };
    } catch (_) { return { requestedQuantity: 0, skipLot: [] }; }
}

function label(status) { return STATUS_LABELS[status] || status || 'Chưa xác định'; }

async function overview(pool, warehouseID, temporaryLocationID, query) {
    const f = filters(query);
    const result = await pool.request()
        .input('WarehouseID', sql.Int, warehouseID).input('TemporaryLocationID', sql.Int, temporaryLocationID)
        .input('From', sql.DateTime2, f.from).input('To', sql.DateTime2, f.to).input('SlaMinutes', sql.Int, f.slaMinutes)
        .query(`
        ;WITH ActivePallet AS (
          SELECT ID_TheKhoKienBTP,Status FROM dbo.CraneWmsOutboundPallet
          WHERE Status IN ('WAITING_WMS','FAILED_RETRY','WAITING_RETURN')
        ), Exported AS (
          SELECT x.ID_TheKhoKienBTP_ChiTiet,
            SUM(CASE WHEN active.ID_TheKhoKienBTP IS NOT NULL AND active.Status IN ('WAITING_WMS','FAILED_RETRY')
                     THEN 0 ELSE x.SoLuong_XuatKho END) ExportedQuantity
          FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien x
          JOIN dbo.TheKhoKienBTP_ChiTiet detail ON detail.ID_TheKhoKienBTP_ChiTiet=x.ID_TheKhoKienBTP_ChiTiet
          LEFT JOIN ActivePallet active ON active.ID_TheKhoKienBTP=detail.ID_TheKhoKienBTP
            AND EXISTS (SELECT 1 FROM dbo.CraneWmsOutboundPallet p WHERE p.ID_PhieuXuatBTP=x.ID_PhieuXuatBTP
                        AND p.ID_TheKhoKienBTP=detail.ID_TheKhoKienBTP AND p.Status=active.Status)
          GROUP BY x.ID_TheKhoKienBTP_ChiTiet
        ), Stock AS (
          SELECT k.ID_TheKhoKienBTP,k.ID_ViTriKho,
            SUM(CASE WHEN d.SoLuong-ISNULL(e.ExportedQuantity,0)>0 THEN d.SoLuong-ISNULL(e.ExportedQuantity,0) ELSE 0 END) Quantity,
            MAX(CASE WHEN active.ID_TheKhoKienBTP IS NOT NULL OR
              (inbound.ID_TheKhoKienBTP IS NOT NULL AND (inbound.DispatchStatus<>'SENT' OR inbound.LocationID IS NULL))
              THEN 1 ELSE 0 END) IsLocked
          FROM dbo.TheKhoKienBTP k
          JOIN dbo.DM_Kho_ViTri v ON v.ID_ViTriKho=k.ID_ViTriKho AND v.ID_Kho=@WarehouseID AND v.MaNha=N'Z76' AND v.MaKhuVuc IN (N'CT',N'CTT')
          JOIN dbo.TheKhoKienBTP_ChiTiet d ON d.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP AND ISNULL(d.TonTai,1)=1
          LEFT JOIN Exported e ON e.ID_TheKhoKienBTP_ChiTiet=d.ID_TheKhoKienBTP_ChiTiet
          LEFT JOIN ActivePallet active ON active.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP
          LEFT JOIN dbo.CraneWmsInboundPackage inbound ON inbound.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP
          WHERE ISNULL(k.TonTai,1)=1 GROUP BY k.ID_TheKhoKienBTP,k.ID_ViTriKho
        )
        SELECT ISNULL(SUM(Quantity),0) physicalQuantity,
          ISNULL(SUM(CASE WHEN IsLocked=0 AND ID_ViTriKho<>@TemporaryLocationID THEN Quantity ELSE 0 END),0) availableQuantity,
          ISNULL(SUM(CASE WHEN IsLocked=1 OR ID_ViTriKho=@TemporaryLocationID THEN Quantity ELSE 0 END),0) pendingQuantity,
          COUNT(*) packageCount,SUM(CASE WHEN ID_ViTriKho=@TemporaryLocationID THEN 1 ELSE 0 END) temporaryPackageCount
        FROM Stock WHERE Quantity>0;

        SELECT COUNT(DISTINCT i.ID_PhieuNhapBTP) orderCount,COUNT(*) packageCount,ISNULL(SUM(q.Quantity),0) quantity,
          SUM(CASE WHEN p.DispatchStatus='SENT' AND p.LocationID IS NULL THEN 1 ELSE 0 END) waitingLocationCount,
          SUM(CASE WHEN p.DispatchStatus='FAILED' THEN 1 ELSE 0 END) failedCount,
          AVG(CASE WHEN p.SentAt IS NOT NULL AND p.LocatedAt IS NOT NULL
                   THEN DATEDIFF(SECOND,p.SentAt,p.LocatedAt)/60.0 END) averageLocateMinutes
        FROM dbo.CraneWmsInboundPackage p JOIN dbo.CraneWmsInbound i ON i.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP
        OUTER APPLY (SELECT SUM(TRY_CONVERT(decimal(18,2),JSON_VALUE(item.value,'$.quantity'))) Quantity
          FROM OPENJSON(p.RequestJson,'$.pallets') pallet CROSS APPLY OPENJSON(pallet.value,'$.items') item) q
        WHERE i.ID_Kho=@WarehouseID AND p.CreatedAt>=@From AND p.CreatedAt<@To;

        SELECT COUNT(DISTINCT o.ID_PhieuXuatBTP) orderCount,
          ISNULL(SUM(p.PlannedQuantity),0) requestedQuantity,ISNULL(SUM(p.ActualQuantity),0) exportedQuantity,
          ISNULL(SUM(CASE WHEN p.Status='WAITING_RETURN' THEN p.InitialQuantity-ISNULL(p.ActualQuantity,0) ELSE 0 END),0) waitingReturnQuantity,
          SUM(CASE WHEN o.Status IN ('WAITING_WMS','FAILED_RETRY') THEN 1 ELSE 0 END) waitingWmsPalletCount,
          COUNT(DISTINCT CASE WHEN d.DispatchStatus='REJECTED' THEN d.ID_PhieuXuatBTP END) rejectedCount,
          COUNT(DISTINCT CASE WHEN o.Status='COMPLETE' THEN o.ID_PhieuXuatBTP END) completedCount
        FROM dbo.CraneWmsOutbound o LEFT JOIN dbo.CraneWmsOutboundPallet p ON p.ID_PhieuXuatBTP=o.ID_PhieuXuatBTP
        LEFT JOIN dbo.CraneWmsOutboundDispatch d ON d.ID_PhieuXuatBTP=o.ID_PhieuXuatBTP
        WHERE o.ID_Kho=@WarehouseID AND o.CreatedAt>=@From AND o.CreatedAt<@To;

        SELECT
          (SELECT COUNT(*) FROM dbo.CraneWmsInboundPackage p JOIN dbo.CraneWmsInbound i ON i.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP
           WHERE i.ID_Kho=@WarehouseID AND p.DispatchStatus='FAILED')+
          (SELECT COUNT(*) FROM dbo.CraneWmsOutboundDispatch d JOIN dbo.PhieuXuatBTP x ON x.ID_PhieuXuatBTP=d.ID_PhieuXuatBTP
           WHERE x.ID_KhoXuat=@WarehouseID AND d.DispatchStatus IN ('FAILED','REJECTED')) AS failed,
          (SELECT COUNT(*) FROM dbo.CraneWmsInboundPackage p JOIN dbo.CraneWmsInbound i ON i.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP
           WHERE i.ID_Kho=@WarehouseID AND ((p.DispatchStatus IN ('PENDING','SENDING') AND p.UpdatedAt<DATEADD(MINUTE,-@SlaMinutes,SYSUTCDATETIME()))
              OR (p.DispatchStatus='SENT' AND p.LocationID IS NULL AND p.SentAt<DATEADD(MINUTE,-@SlaMinutes,SYSUTCDATETIME()))))+
          (SELECT COUNT(*) FROM dbo.CraneWmsOutboundPallet p JOIN dbo.CraneWmsOutbound o ON o.ID_PhieuXuatBTP=p.ID_PhieuXuatBTP
           WHERE o.ID_Kho=@WarehouseID AND p.Status IN ('WAITING_WMS','WAITING_RETURN','FAILED_RETRY')
             AND o.UpdatedAt<DATEADD(MINUTE,-@SlaMinutes,SYSUTCDATETIME())) AS overSla;`);
    const inventory = result.recordsets[0]?.[0] || {};
    const inbound = result.recordsets[1]?.[0] || {};
    const outbound = result.recordsets[2]?.[0] || {};
    const alerts = result.recordsets[3]?.[0] || {};
    const numberMap = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, Number(value || 0)]));
    return { generatedAt: new Date().toISOString(), filters: { from: f.from, to: f.to, slaMinutes: f.slaMinutes },
        inventory: numberMap(inventory), inbound: numberMap(inbound), outbound: numberMap(outbound),
        alerts: { failed: Number(alerts.failed || 0), overSla: Number(alerts.overSla || 0), total: Number(alerts.failed || 0)+Number(alerts.overSla || 0) } };
}

async function inbound(pool, warehouseID, query) {
    const f = filters(query);
    const result = await pool.request().input('WarehouseID',sql.Int,warehouseID).input('From',sql.DateTime2,f.from)
        .input('To',sql.DateTime2,f.to).input('Status',sql.VarChar(24),f.status).input('Search',sql.NVarChar(255),f.search)
        .input('Offset',sql.Int,f.offset).input('Take',sql.Int,f.pageSize).query(`
        SELECT COUNT(*) total FROM dbo.CraneWmsInboundPackage p JOIN dbo.CraneWmsInbound i ON i.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP
        JOIN dbo.PhieuNhapBTP n ON n.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP
        WHERE i.ID_Kho=@WarehouseID AND p.CreatedAt>=@From AND p.CreatedAt<@To
          AND (@Status='' OR p.DispatchStatus=@Status) AND (@Search='' OR n.So_PhieuNhapBTP LIKE '%'+@Search+'%' OR p.PalletID LIKE '%'+@Search+'%');
        SELECT p.ID_PhieuNhapBTP orderID,n.So_PhieuNhapBTP orderCode,p.ID_TheKhoKienBTP packageID,p.PalletID palletID,
          p.DispatchStatus status,p.DispatchAttempts dispatchAttempts,p.ResponseStatus responseStatus,p.DispatchError dispatchError,
          p.LocationID locationID,v.MaViTriKho locationCode,p.SentAt sentAt,p.LocatedAt locatedAt,p.CreatedAt createdAt,p.UpdatedAt updatedAt,p.RequestJson requestJson
        FROM dbo.CraneWmsInboundPackage p JOIN dbo.CraneWmsInbound i ON i.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP
        JOIN dbo.PhieuNhapBTP n ON n.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP LEFT JOIN dbo.DM_Kho_ViTri v ON v.ID_ViTriKho=p.LocationID
        WHERE i.ID_Kho=@WarehouseID AND p.CreatedAt>=@From AND p.CreatedAt<@To
          AND (@Status='' OR p.DispatchStatus=@Status) AND (@Search='' OR n.So_PhieuNhapBTP LIKE '%'+@Search+'%' OR p.PalletID LIKE '%'+@Search+'%')
        ORDER BY p.CreatedAt DESC,p.ID_TheKhoKienBTP DESC OFFSET @Offset ROWS FETCH NEXT @Take ROWS ONLY;`);
    return { items:(result.recordsets[1]||[]).map(row=>({ ...row,quantity:quantityFromInbound(row.requestJson),
            statusLabel:row.status==='SENT'&&!row.locationID?'Chờ WMS xếp vị trí':label(row.status),requestJson:undefined })),
        total:Number(result.recordsets[0]?.[0]?.total||0),pageIndex:f.pageIndex,pageSize:f.pageSize };
}

async function outbound(pool, warehouseID, query) {
    const f=filters(query);
    const result=await pool.request().input('WarehouseID',sql.Int,warehouseID).input('From',sql.DateTime2,f.from).input('To',sql.DateTime2,f.to)
      .input('Status',sql.VarChar(24),f.status).input('Search',sql.NVarChar(255),f.search).input('Offset',sql.Int,f.offset).input('Take',sql.Int,f.pageSize).query(`
      ;WITH Orders AS (SELECT ID_PhieuXuatBTP FROM dbo.CraneWmsOutboundDispatch UNION SELECT ID_PhieuXuatBTP FROM dbo.CraneWmsOutbound), Data AS (
        SELECT ids.ID_PhieuXuatBTP orderID,x.So_PhieuXuatBTP orderCode,COALESCE(o.Status,d.DispatchStatus) status,d.DispatchStatus dispatchStatus,
          d.DispatchAttempts dispatchAttempts,d.DispatchError dispatchError,d.ResponseStatus responseStatus,d.RequestJson requestJson,
          d.SentAt sentAt,COALESCE(o.UpdatedAt,d.UpdatedAt) updatedAt,COALESCE(o.CreatedAt,d.UpdatedAt) createdAt,
          ISNULL(p.palletCount,0) palletCount,ISNULL(p.exportedQuantity,0) exportedQuantity,ISNULL(p.waitingReturnQuantity,0) waitingReturnQuantity
        FROM Orders ids JOIN dbo.PhieuXuatBTP x ON x.ID_PhieuXuatBTP=ids.ID_PhieuXuatBTP
        LEFT JOIN dbo.CraneWmsOutboundDispatch d ON d.ID_PhieuXuatBTP=ids.ID_PhieuXuatBTP LEFT JOIN dbo.CraneWmsOutbound o ON o.ID_PhieuXuatBTP=ids.ID_PhieuXuatBTP
        OUTER APPLY (SELECT COUNT(*) palletCount,SUM(ISNULL(cp.ActualQuantity,0)) exportedQuantity,
          SUM(CASE WHEN cp.Status='WAITING_RETURN' THEN cp.InitialQuantity-ISNULL(cp.ActualQuantity,0) ELSE 0 END) waitingReturnQuantity
          FROM dbo.CraneWmsOutboundPallet cp WHERE cp.ID_PhieuXuatBTP=ids.ID_PhieuXuatBTP) p
        WHERE x.ID_KhoXuat=@WarehouseID AND COALESCE(o.CreatedAt,d.UpdatedAt)>=@From AND COALESCE(o.CreatedAt,d.UpdatedAt)<@To)
      SELECT COUNT(*) total FROM Data WHERE (@Status='' OR status=@Status OR dispatchStatus=@Status)
        AND (@Search='' OR orderCode LIKE '%'+@Search+'%');
      ;WITH Orders AS (SELECT ID_PhieuXuatBTP FROM dbo.CraneWmsOutboundDispatch UNION SELECT ID_PhieuXuatBTP FROM dbo.CraneWmsOutbound), Data AS (
        SELECT ids.ID_PhieuXuatBTP orderID,x.So_PhieuXuatBTP orderCode,COALESCE(o.Status,d.DispatchStatus) status,d.DispatchStatus dispatchStatus,
          d.DispatchAttempts dispatchAttempts,d.DispatchError dispatchError,d.ResponseStatus responseStatus,d.RequestJson requestJson,
          d.SentAt sentAt,COALESCE(o.UpdatedAt,d.UpdatedAt) updatedAt,COALESCE(o.CreatedAt,d.UpdatedAt) createdAt,
          ISNULL(p.palletCount,0) palletCount,ISNULL(p.exportedQuantity,0) exportedQuantity,ISNULL(p.waitingReturnQuantity,0) waitingReturnQuantity
        FROM Orders ids JOIN dbo.PhieuXuatBTP x ON x.ID_PhieuXuatBTP=ids.ID_PhieuXuatBTP
        LEFT JOIN dbo.CraneWmsOutboundDispatch d ON d.ID_PhieuXuatBTP=ids.ID_PhieuXuatBTP LEFT JOIN dbo.CraneWmsOutbound o ON o.ID_PhieuXuatBTP=ids.ID_PhieuXuatBTP
        OUTER APPLY (SELECT COUNT(*) palletCount,SUM(ISNULL(cp.ActualQuantity,0)) exportedQuantity,
          SUM(CASE WHEN cp.Status='WAITING_RETURN' THEN cp.InitialQuantity-ISNULL(cp.ActualQuantity,0) ELSE 0 END) waitingReturnQuantity
          FROM dbo.CraneWmsOutboundPallet cp WHERE cp.ID_PhieuXuatBTP=ids.ID_PhieuXuatBTP) p
        WHERE x.ID_KhoXuat=@WarehouseID AND COALESCE(o.CreatedAt,d.UpdatedAt)>=@From AND COALESCE(o.CreatedAt,d.UpdatedAt)<@To)
      SELECT * FROM Data WHERE (@Status='' OR status=@Status OR dispatchStatus=@Status) AND (@Search='' OR orderCode LIKE '%'+@Search+'%')
      ORDER BY createdAt DESC,orderID DESC OFFSET @Offset ROWS FETCH NEXT @Take ROWS ONLY;`);
    return {items:(result.recordsets[1]||[]).map(row=>{const payload=outboundPayload(row.requestJson);return {...row,...payload,statusLabel:label(row.status),dispatchStatusLabel:label(row.dispatchStatus),requestJson:undefined};}),
      total:Number(result.recordsets[0]?.[0]?.total||0),pageIndex:f.pageIndex,pageSize:f.pageSize};
}

async function alerts(pool, warehouseID, query) {
    const f=filters(query);
    const result=await pool.request().input('WarehouseID',sql.Int,warehouseID).input('SlaMinutes',sql.Int,f.slaMinutes)
      .input('Offset',sql.Int,f.offset).input('Take',sql.Int,f.pageSize).query(`
      ;WITH Alerts AS (
        SELECT 'INBOUND' flow,p.ID_PhieuNhapBTP orderID,n.So_PhieuNhapBTP orderCode,p.PalletID palletID,
          CASE WHEN p.DispatchStatus='FAILED' THEN 'FAILED' ELSE 'OVER_SLA' END alertType,p.DispatchStatus status,
          p.DispatchError message,p.UpdatedAt updatedAt,DATEDIFF(MINUTE,p.UpdatedAt,SYSUTCDATETIME()) ageMinutes
        FROM dbo.CraneWmsInboundPackage p JOIN dbo.CraneWmsInbound i ON i.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP
        JOIN dbo.PhieuNhapBTP n ON n.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP WHERE i.ID_Kho=@WarehouseID AND
          (p.DispatchStatus='FAILED' OR (p.DispatchStatus IN ('PENDING','SENDING') AND p.UpdatedAt<DATEADD(MINUTE,-@SlaMinutes,SYSUTCDATETIME()))
           OR (p.DispatchStatus='SENT' AND p.LocationID IS NULL AND p.SentAt<DATEADD(MINUTE,-@SlaMinutes,SYSUTCDATETIME())))
        UNION ALL
        SELECT 'OUTBOUND',x.ID_PhieuXuatBTP,x.So_PhieuXuatBTP,NULL,
          CASE WHEN d.DispatchStatus IN ('FAILED','REJECTED') OR o.Status='FAILED_RETRY' THEN 'FAILED' ELSE 'OVER_SLA' END,
          COALESCE(o.Status,d.DispatchStatus),COALESCE(d.DispatchError,o.DispatchError),COALESCE(o.UpdatedAt,d.UpdatedAt),
          DATEDIFF(MINUTE,COALESCE(o.UpdatedAt,d.UpdatedAt),SYSUTCDATETIME())
        FROM dbo.PhieuXuatBTP x LEFT JOIN dbo.CraneWmsOutboundDispatch d ON d.ID_PhieuXuatBTP=x.ID_PhieuXuatBTP
        LEFT JOIN dbo.CraneWmsOutbound o ON o.ID_PhieuXuatBTP=x.ID_PhieuXuatBTP WHERE x.ID_KhoXuat=@WarehouseID AND
          (d.DispatchStatus IN ('FAILED','REJECTED') OR o.Status='FAILED_RETRY' OR
           (o.Status IN ('WAITING_WMS','WAITING_RETURN') AND o.UpdatedAt<DATEADD(MINUTE,-@SlaMinutes,SYSUTCDATETIME())))
      ) SELECT COUNT(*) total FROM Alerts;
      ;WITH Alerts AS (
        SELECT 'INBOUND' flow,p.ID_PhieuNhapBTP orderID,n.So_PhieuNhapBTP orderCode,p.PalletID palletID,
          CASE WHEN p.DispatchStatus='FAILED' THEN 'FAILED' ELSE 'OVER_SLA' END alertType,p.DispatchStatus status,
          p.DispatchError message,p.UpdatedAt updatedAt,DATEDIFF(MINUTE,p.UpdatedAt,SYSUTCDATETIME()) ageMinutes
        FROM dbo.CraneWmsInboundPackage p JOIN dbo.CraneWmsInbound i ON i.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP
        JOIN dbo.PhieuNhapBTP n ON n.ID_PhieuNhapBTP=p.ID_PhieuNhapBTP WHERE i.ID_Kho=@WarehouseID AND
          (p.DispatchStatus='FAILED' OR (p.DispatchStatus IN ('PENDING','SENDING') AND p.UpdatedAt<DATEADD(MINUTE,-@SlaMinutes,SYSUTCDATETIME()))
           OR (p.DispatchStatus='SENT' AND p.LocationID IS NULL AND p.SentAt<DATEADD(MINUTE,-@SlaMinutes,SYSUTCDATETIME())))
        UNION ALL
        SELECT 'OUTBOUND',x.ID_PhieuXuatBTP,x.So_PhieuXuatBTP,NULL,
          CASE WHEN d.DispatchStatus IN ('FAILED','REJECTED') OR o.Status='FAILED_RETRY' THEN 'FAILED' ELSE 'OVER_SLA' END,
          COALESCE(o.Status,d.DispatchStatus),COALESCE(d.DispatchError,o.DispatchError),COALESCE(o.UpdatedAt,d.UpdatedAt),
          DATEDIFF(MINUTE,COALESCE(o.UpdatedAt,d.UpdatedAt),SYSUTCDATETIME())
        FROM dbo.PhieuXuatBTP x LEFT JOIN dbo.CraneWmsOutboundDispatch d ON d.ID_PhieuXuatBTP=x.ID_PhieuXuatBTP
        LEFT JOIN dbo.CraneWmsOutbound o ON o.ID_PhieuXuatBTP=x.ID_PhieuXuatBTP WHERE x.ID_KhoXuat=@WarehouseID AND
          (d.DispatchStatus IN ('FAILED','REJECTED') OR o.Status='FAILED_RETRY' OR
           (o.Status IN ('WAITING_WMS','WAITING_RETURN') AND o.UpdatedAt<DATEADD(MINUTE,-@SlaMinutes,SYSUTCDATETIME())))
      ) SELECT *,CASE WHEN alertType='FAILED' THEN N'Lỗi cần xử lý' ELSE N'Chờ quá SLA' END alertLabel
        FROM Alerts ORDER BY CASE WHEN alertType='FAILED' THEN 0 ELSE 1 END,updatedAt DESC
        OFFSET @Offset ROWS FETCH NEXT @Take ROWS ONLY;`);
    return {items:(result.recordsets[1]||[]).map(row=>({...row,statusLabel:label(row.status)})),total:Number(result.recordsets[0]?.[0]?.total||0),pageIndex:f.pageIndex,pageSize:f.pageSize};
}

async function inventoryAisles(pool, warehouseID, temporaryLocationID) {
    const result=await pool.request().input('WarehouseID',sql.Int,warehouseID).input('TemporaryLocationID',sql.Int,temporaryLocationID).query(`
      SELECT v.MaDay maDay,MAX(v.TenDay) tenDay,MAX(v.MaNha) maNha,MAX(v.TenNha) tenNha,COUNT(*) locationCount
      FROM dbo.DM_Kho_ViTri v WHERE v.ID_Kho=@WarehouseID AND v.MaNha=N'Z76' AND v.MaKhuVuc=N'CT' AND v.TonTai=1 AND v.SuDung=1
        AND v.ID_ViTriKho<>@TemporaryLocationID AND NULLIF(LTRIM(RTRIM(v.MaDay)),N'') IS NOT NULL
      GROUP BY v.MaDay ORDER BY v.MaDay`);
    return {items:result.recordset||[]};
}

async function inventory(pool, warehouseID, temporaryLocationID, query={}) {
    const aisle=String(query.aisle||query.maDay||'').trim().slice(0,100);
    const itemCode=String(query.itemCode||'').trim().slice(0,255);
    const lot=String(query.lot||query.dauTuan||'').trim().slice(0,50);
    const result=await pool.request().input('WarehouseID',sql.Int,warehouseID).input('TemporaryLocationID',sql.Int,temporaryLocationID)
      .input('Aisle',sql.NVarChar(100),aisle).input('ItemCode',sql.NVarChar(255),itemCode).input('Lot',sql.NVarChar(50),lot).query(`
      ;WITH ActivePallet AS (
        SELECT ID_PhieuXuatBTP,ID_TheKhoKienBTP,Status FROM dbo.CraneWmsOutboundPallet
        WHERE Status IN ('WAITING_WMS','FAILED_RETRY','WAITING_RETURN')
      ), Exported AS (
        SELECT x.ID_TheKhoKienBTP_ChiTiet,
          SUM(CASE WHEN active.ID_TheKhoKienBTP IS NOT NULL AND active.Status IN ('WAITING_WMS','FAILED_RETRY')
                   THEN 0 ELSE x.SoLuong_XuatKho END) ExportedQuantity
        FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien x
        JOIN dbo.TheKhoKienBTP_ChiTiet d ON d.ID_TheKhoKienBTP_ChiTiet=x.ID_TheKhoKienBTP_ChiTiet
        LEFT JOIN ActivePallet active ON active.ID_PhieuXuatBTP=x.ID_PhieuXuatBTP AND active.ID_TheKhoKienBTP=d.ID_TheKhoKienBTP
        GROUP BY x.ID_TheKhoKienBTP_ChiTiet
      ), Lines AS (
        SELECT k.ID_ViTriKho,k.ID_TheKhoKienBTP,
          CASE WHEN d.SoLuong-ISNULL(e.ExportedQuantity,0)>0 THEN d.SoLuong-ISNULL(e.ExportedQuantity,0) ELSE 0 END Quantity,
          CASE WHEN active.ID_TheKhoKienBTP IS NOT NULL OR
            (inbound.ID_TheKhoKienBTP IS NOT NULL AND (inbound.DispatchStatus<>'SENT' OR inbound.LocationID IS NULL)) THEN 1 ELSE 0 END IsLocked
        FROM dbo.TheKhoKienBTP k JOIN dbo.TheKhoKienBTP_ChiTiet d ON d.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP AND ISNULL(d.TonTai,1)=1
        LEFT JOIN Exported e ON e.ID_TheKhoKienBTP_ChiTiet=d.ID_TheKhoKienBTP_ChiTiet
        LEFT JOIN ActivePallet active ON active.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP
        LEFT JOIN dbo.CraneWmsInboundPackage inbound ON inbound.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP
        WHERE ISNULL(k.TonTai,1)=1 AND (@ItemCode='' OR d.ItemCode=@ItemCode) AND (@Lot='' OR LTRIM(RTRIM(d.DauTuan))=@Lot)
      )
      SELECT v.ID_ViTriKho idViTriKho,v.MaViTriKho maViTriKho,v.QRCode qrCode,v.TenViTriKho,
        v.MaNha maNha,v.TenNha,v.MaDay maDay,v.TenDay,v.MaTang,v.TenTang,v.MaKe,v.TenKe,
        COUNT(DISTINCT CASE WHEN line.Quantity>0 THEN line.ID_TheKhoKienBTP END) slKien,
        ISNULL(SUM(line.Quantity),0) tonViTri,
        ISNULL(SUM(CASE WHEN line.IsLocked=0 THEN line.Quantity ELSE 0 END),0) tonKhaDung,
        COUNT(DISTINCT CASE WHEN line.Quantity>0 AND line.IsLocked=1 THEN line.ID_TheKhoKienBTP END) kienDangKhoa
      FROM dbo.DM_Kho_ViTri v LEFT JOIN Lines line ON line.ID_ViTriKho=v.ID_ViTriKho
      WHERE v.ID_Kho=@WarehouseID AND v.MaNha=N'Z76' AND v.MaKhuVuc=N'CT' AND v.TonTai=1 AND v.SuDung=1 AND v.ID_ViTriKho<>@TemporaryLocationID
        AND (@Aisle='' OR v.MaDay=@Aisle)
      GROUP BY v.ID_ViTriKho,v.MaViTriKho,v.QRCode,v.TenViTriKho,v.MaNha,v.TenNha,v.MaDay,v.TenDay,v.MaTang,v.TenTang,v.MaKe,v.TenKe
      HAVING (@ItemCode='' AND @Lot='') OR ISNULL(SUM(line.Quantity),0)>0
      ORDER BY v.MaDay,v.MaTang,v.MaKe,v.MaViTriKho`);
    return {items:(result.recordset||[]).map(row=>({...row,slKien:Number(row.slKien||0),tonViTri:Number(row.tonViTri||0),
      tonKhaDung:Number(row.tonKhaDung||0),kienDangKhoa:Number(row.kienDangKhoa||0)})),filters:{aisle,itemCode,lot}};
}

async function inventoryLocationByQr(pool, warehouseID, temporaryLocationID, qrCode) {
    const qr=String(qrCode||'').trim();
    if (!qr || qr.length>255) throw Object.assign(new Error('QR vị trí không hợp lệ'),{status:400});
    const result=await pool.request().input('WarehouseID',sql.Int,warehouseID).input('TemporaryLocationID',sql.Int,temporaryLocationID)
      .input('QRCode',sql.NVarChar(255),qr).query(`SELECT TOP (1) ID_ViTriKho idViTriKho,MaViTriKho maViTriKho,QRCode qrCode,
        TenViTriKho,MaNha maNha,TenNha,MaDay maDay,TenDay,MaTang,TenTang,MaKe,TenKe
        FROM dbo.DM_Kho_ViTri WHERE ID_Kho=@WarehouseID AND MaNha=N'Z76' AND MaKhuVuc=N'CT' AND TonTai=1 AND SuDung=1 AND ID_ViTriKho<>@TemporaryLocationID
          AND (QRCode=@QRCode OR MaViTriKho=@QRCode)`);
    if (!result.recordset[0]) throw Object.assign(new Error('Không tìm thấy vị trí thuộc kho cầu trục'),{status:404});
    return result.recordset[0];
}

module.exports={filters,overview,inbound,outbound,alerts,inventoryAisles,inventory,inventoryLocationByQr,STATUS_LABELS};
