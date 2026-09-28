const sql = require('mssql');

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function getCraneConfig() {
    const warehouseID = positiveId(process.env.CRANE_WAREHOUSE_ID);
    const temporaryLocationID = positiveId(process.env.CRANE_TEMP_LOCATION_ID);
    if (!warehouseID && !temporaryLocationID) return null;
    if (!warehouseID || !temporaryLocationID) {
        throw new Error('CRANE_WAREHOUSE_ID and CRANE_TEMP_LOCATION_ID must both be set');
    }
    return { warehouseID, temporaryLocationID, mode: 'mock' };
}

function craneError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function reconcilePallets(selectedPallets, callbackItems) {
    const selected = new Map(selectedPallets.map(p => [String(p.PalletID), p]));
    const actual = new Map();
    for (const item of callbackItems) for (const pallet of item.pallets) {
        const row = selected.get(pallet.palletID);
        if (!row) throw craneError(409, 'WMS trả về pallet không được app chọn');
        actual.set(pallet.palletID, (actual.get(pallet.palletID) || 0) + pallet.quantity);
    }
    for (const [qr, quantity] of actual) {
        if (quantity > Number(selected.get(qr).PlannedQuantity))
            throw craneError(409, 'WMS xuất vượt số lượng app đã chọn');
    }
    return selectedPallets.map(p => {
        const quantity = actual.get(p.PalletID) || 0;
        const remaining = Number(p.InitialQuantity) - quantity;
        return { ...p, actual: quantity, remaining,
            nextStatus: quantity === 0 ? 'NOT_USED' : remaining > 0 ? 'WAITING_RETURN' : 'EXPORTED_FULL' };
    });
}

function outboundFingerprint(status, items) {
    const normalized = items.map(item => ({
        itemCode: item.itemCode,
        lot: item.lot,
        requestedQuantity: item.requestedQuantity,
        exportedQuantity: item.exportedQuantity,
        pallets: [...item.pallets].sort((a, b) => a.palletID.localeCompare(b.palletID))
    })).sort((a, b) => JSON.stringify([a.itemCode, a.lot]).localeCompare(JSON.stringify([b.itemCode, b.lot])));
    return JSON.stringify({ status, items: normalized });
}

async function assertTemporaryLocation(transaction, config) {
    const result = await new sql.Request(transaction)
        .input('LocationID', sql.Int, config.temporaryLocationID)
        .input('WarehouseID', sql.Int, config.warehouseID)
        .query(`SELECT ID_ViTriKho FROM dbo.DM_Kho_ViTri WITH (HOLDLOCK)
                WHERE ID_ViTriKho=@LocationID AND ID_Kho=@WarehouseID AND TonTai=1 AND SuDung=1`);
    if (result.recordset.length !== 1) throw craneError(409, 'Vị trí tạm không thuộc kho cầu trục hoặc chưa sử dụng');
}

async function findCraneOrder(executor, orderID, lock = false) {
    const result = await new sql.Request(executor)
        .input('OrderID', sql.Int, orderID)
        .query(`SELECT * FROM dbo.CraneWmsOutbound ${lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
                WHERE ID_PhieuXuatBTP=@OrderID`);
    return result.recordset[0] || null;
}

async function findActivePallet(executor, palletID, lock = false) {
    const result = await new sql.Request(executor)
        .input('PalletID', sql.NVarChar(255), palletID)
        .query(`SELECT * FROM dbo.CraneWmsOutboundPallet ${lock ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
                WHERE PalletID=@PalletID AND Status IN ('WAITING_WMS','FAILED_RETRY','WAITING_RETURN')`);
    return result.recordset[0] || null;
}

async function confirmCraneOutbound(pool, orderID, picks) {
    const config = getCraneConfig();
    if (!config) throw craneError(409, 'Kho cầu trục chưa được cấu hình');
    if (!positiveId(orderID) || !Array.isArray(picks) || !picks.length) throw craneError(400, 'Phiếu hoặc kiện xuất không hợp lệ');
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
        const orderResult = await new sql.Request(transaction)
            .input('OrderID', sql.Int, orderID)
            .query(`SELECT ID_PhieuXuatBTP, ID_KhoXuat, So_PhieuXuatBTP, QrStatus
                    FROM dbo.PhieuXuatBTP WITH (UPDLOCK, HOLDLOCK)
                    WHERE ID_PhieuXuatBTP=@OrderID AND TonTai=1`);
        const order = orderResult.recordset[0];
        if (!order) throw craneError(404, 'Không tìm thấy phiếu xuất');
        if (Number(order.ID_KhoXuat) !== config.warehouseID) throw craneError(400, 'Phiếu không thuộc kho cầu trục');
        if (order.QrStatus) throw craneError(409, 'Phiếu đã xác nhận');
        await assertTemporaryLocation(transaction, config);

        const table = new sql.Table('dbo.ChiTietKienBTPsType');
        table.columns.add('ID_TheKhoKienBTP_ChiTiet', sql.Int);
        table.columns.add('ID_DonHang_LoSanXuat', sql.Int);
        table.columns.add('ID_DonHang_SanPham', sql.Int);
        table.columns.add('ID_DonHang', sql.Int);
        table.columns.add('SoLuong_XuatKho', sql.Decimal(18, 2));
        const seenDetails = new Set();
        const palletMap = new Map();
        const outboundItems = [];
        for (const pick of picks) {
            const detailID = positiveId(pick.IdTheKhoKienBTPChiTiet);
            const quantity = Number(pick.SoLuongXuatKho);
            if (!detailID || seenDetails.has(detailID) || !Number.isFinite(quantity) || quantity <= 0 || Math.round(quantity * 100) !== quantity * 100) {
                throw craneError(400, 'Chi tiết kiện hoặc số lượng xuất không hợp lệ');
            }
            seenDetails.add(detailID);
            const result = await new sql.Request(transaction)
                .input('DetailID', sql.Int, detailID)
                .query(`SELECT d.ID_TheKhoKienBTP, d.ItemCode, d.DauTuan, k.QRCode,
                               k.ID_ViTriKho, v.ID_Kho,
                               d.SoLuong - ISNULL((SELECT SUM(x.SoLuong_XuatKho)
                                   FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien x WITH (UPDLOCK, HOLDLOCK)
                                   WHERE x.ID_TheKhoKienBTP_ChiTiet=d.ID_TheKhoKienBTP_ChiTiet),0) AS Available
                        FROM dbo.TheKhoKienBTP_ChiTiet d WITH (UPDLOCK, HOLDLOCK)
                        JOIN dbo.TheKhoKienBTP k WITH (UPDLOCK, HOLDLOCK) ON k.ID_TheKhoKienBTP=d.ID_TheKhoKienBTP
                        JOIN dbo.DM_Kho_ViTri v ON v.ID_ViTriKho=k.ID_ViTriKho
                        WHERE d.ID_TheKhoKienBTP_ChiTiet=@DetailID AND d.TonTai=1 AND k.TonTai=1`);
            const row = result.recordset[0];
            if (!row || Number(row.ID_Kho) !== config.warehouseID || Number(row.ID_ViTriKho) === config.temporaryLocationID ||
                !row.QRCode || quantity > Number(row.Available)) throw craneError(409, 'Kiện không khả dụng để xuất');
            if (!String(row.ItemCode || '').trim() || !String(row.DauTuan || '').trim())
                throw craneError(409, 'Kiện thiếu ItemCode hoặc dấu tuần để WMS đối chiếu');
            const key = Number(row.ID_TheKhoKienBTP);
            if (!palletMap.has(key)) {
                if (await findActivePallet(transaction, String(row.QRCode), true)) throw craneError(409, 'Pallet đang chờ WMS');
                palletMap.set(key, { palletID: String(row.QRCode), locationID: Number(row.ID_ViTriKho), planned: 0 });
            }
            palletMap.get(key).planned += quantity;
            outboundItems.push({ palletID: String(row.QRCode), itemCode: String(row.ItemCode || '').trim(),
                lot: String(row.DauTuan || '').trim(), quantity });
            table.rows.add(detailID, positiveId(pick.IdDonHangLoSanXuat) || 0,
                positiveId(pick.IdDonHangSanPham) || 0, positiveId(pick.IdDonHang) || 0, quantity);
        }

        for (const [packageID, pallet] of palletMap) {
            const result = await new sql.Request(transaction)
                .input('PackageID', sql.Int, packageID)
                .query(`SELECT SUM(d.SoLuong - ISNULL(x.Exported,0)) AS InitialQuantity
                        FROM dbo.TheKhoKienBTP_ChiTiet d WITH (UPDLOCK, HOLDLOCK)
                        OUTER APPLY (SELECT SUM(SoLuong_XuatKho) AS Exported
                            FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien WITH (UPDLOCK, HOLDLOCK)
                            WHERE ID_TheKhoKienBTP_ChiTiet=d.ID_TheKhoKienBTP_ChiTiet) x
                        WHERE d.ID_TheKhoKienBTP=@PackageID AND d.TonTai=1`);
            pallet.initial = Number(result.recordset[0]?.InitialQuantity || 0);
            if (pallet.planned > pallet.initial) throw craneError(409, 'Số lượng xuất vượt tồn pallet');
        }
        const request = { orderID: String(orderID), orderCode: String(order.So_PhieuXuatBTP),
            orderType: 'OUTBOUND', warehouseID: config.warehouseID, pallets: [...palletMap.values()].map(p => ({
                palletID: p.palletID, quantity: p.planned })), items: outboundItems };
        await new sql.Request(transaction)
            .input('OrderID', sql.Int, orderID)
            .input('WarehouseID', sql.Int, config.warehouseID)
            .input('OrderCode', sql.NVarChar(255), String(order.So_PhieuXuatBTP))
            .input('RequestJson', sql.NVarChar(sql.MAX), JSON.stringify(request))
            .query(`INSERT dbo.CraneWmsOutbound
                    (ID_PhieuXuatBTP,ID_Kho,OrderCode,Status,RequestJson)
                    VALUES (@OrderID,@WarehouseID,@OrderCode,'WAITING_WMS',@RequestJson)`);
        for (const [packageID, pallet] of palletMap) {
            await new sql.Request(transaction)
                .input('OrderID', sql.Int, orderID)
                .input('PackageID', sql.Int, packageID)
                .input('PalletID', sql.NVarChar(255), pallet.palletID)
                .input('LocationID', sql.Int, pallet.locationID)
                .input('Initial', sql.Decimal(18,2), pallet.initial)
                .input('Planned', sql.Decimal(18,2), pallet.planned)
                .query(`INSERT dbo.CraneWmsOutboundPallet
                    (ID_PhieuXuatBTP,ID_TheKhoKienBTP,PalletID,OriginalLocationID,InitialQuantity,PlannedQuantity,Status)
                    VALUES (@OrderID,@PackageID,@PalletID,@LocationID,@Initial,@Planned,'WAITING_WMS')`);
        }
        const result = await new sql.Request(transaction)
            .input('ChiTietKienBTPsTable', table)
            .input('ID_PhieuXuatBTP', sql.Int, orderID)
            .output('InsertResult', sql.NVarChar(50))
            .execute('App_Update_PhieuXuatBTP_ChiTiet_By_PhieuXuatBTP_ChiTiet_TheKhoKien');
        if (result.output?.InsertResult !== 'success') throw craneError(400, result.output?.InsertResult || 'Xác nhận xuất thất bại');
        await transaction.commit();
        return request;
    } catch (error) {
        try { await transaction.rollback(); } catch (_) { /* SQL procedure may have rolled back. */ }
        throw error;
    }
}

async function dispatchMock(pool, orderID) {
    const result = await pool.request().input('OrderID', sql.Int, orderID)
        .query(`UPDATE dbo.CraneWmsOutbound SET DispatchStatus='MOCKED', DispatchAttempts=DispatchAttempts+1,
                DispatchError=NULL, UpdatedAt=SYSUTCDATETIME()
                OUTPUT inserted.RequestJson, inserted.DispatchStatus
                WHERE ID_PhieuXuatBTP=@OrderID AND DispatchStatus IN ('PENDING','FAILED')`);
    return result.recordset[0] || null;
}

module.exports = { positiveId, getCraneConfig, craneError, assertTemporaryLocation,
    findCraneOrder, findActivePallet, confirmCraneOutbound, dispatchMock, reconcilePallets, outboundFingerprint };
