const sql = require('mssql');
const craneWms = require('../../utils/craneWms');

// This branch exists only under /erp-test. It lets an already-confirmed BTP
// demo order exercise the crane callback without changing the production flow.
function createCraneDemoCallback(testpoolPromise) {
    return async (req, res, next) => {
        const body = req.body || {};
        if (body.demoMode !== true) return next();

        const orderID = craneWms.positiveId(body.orderID);
        const item = Array.isArray(body.items) && body.items.length === 1 ? body.items[0] : null;
        const pallet = Array.isArray(item?.pallets) && item.pallets.length === 1 ? item.pallets[0] : null;
        const requested = Number(item?.requestedQuantity);
        const exported = Number(item?.exportedQuantity);
        const palletQuantity = Number(pallet?.quantity);
        const orderCode = String(body.orderCode || '').trim();
        const itemCode = String(item?.itemCode || '').trim();
        const lot = String(item?.lot || '').trim();
        const palletID = String(pallet?.palletID || '').trim();
        const valid = orderID && orderCode && body.orderType === 'OUTBOUND' &&
            body.status === 'COMPLETED' && Number.isFinite(Date.parse(body.processedAt)) &&
            itemCode && lot && palletID && Number.isSafeInteger(requested) && requested > 0 &&
            exported === requested && palletQuantity === exported;
        if (!valid) return res.status(400).json({ success: false, message: 'Callback demo không hợp lệ' });

        const fingerprint = craneWms.outboundFingerprint('COMPLETED', [{
            itemCode, lot, requestedQuantity: requested, exportedQuantity: exported,
            pallets: [{ palletID, quantity: palletQuantity }],
        }]);
        let transaction;
        let finished = false;
        try {
            const pool = await testpoolPromise;
            transaction = new sql.Transaction(pool);
            await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

            const order = (await new sql.Request(transaction)
                .input('OrderID', sql.Int, orderID)
                .query(`SELECT So_PhieuXuatBTP, ID_KhoXuat, QrStatus FROM dbo.PhieuXuatBTP WITH (UPDLOCK, HOLDLOCK)
                        WHERE ID_PhieuXuatBTP=@OrderID AND TonTai=1`)).recordset[0];
            if (!order || order.So_PhieuXuatBTP !== orderCode || Number(order.ID_KhoXuat) !== 5 || !order.QrStatus)
                throw craneWms.craneError(409, 'Phiếu BTP test chưa xác nhận hoặc không khớp callback');

            const existing = await craneWms.findCraneOrder(transaction, orderID, true);
            if (existing) {
                if (existing.CallbackJson !== fingerprint)
                    throw craneWms.craneError(409, 'Phiếu đã có kết quả callback khác');
                await transaction.commit();
                finished = true;
                return res.json({ success: true, orderID: String(orderID), duplicate: true,
                    status: existing.Status, message: 'Callback demo đã được xử lý' });
            }

            const tempLocation = (await new sql.Request(transaction)
                .query(`SELECT ID_ViTriKho FROM dbo.DM_Kho_ViTri WITH (HOLDLOCK)
                        WHERE ID_Kho=5 AND MaViTriKho=N'CT-TEMP-TEST' AND SuDung=1 AND TonTai=1`)).recordset;
            if (tempLocation.length !== 1)
                throw craneWms.craneError(503, 'Chưa có vị trí CT-TEMP-TEST trên DB test');
            const temporaryLocationID = Number(tempLocation[0].ID_ViTriKho);

            const saved = (await new sql.Request(transaction)
                .input('OrderID', sql.Int, orderID)
                .input('PalletID', sql.NVarChar(255), palletID)
                .query(`SELECT x.ID_TheKhoKienBTP_ChiTiet, x.SoLuong_XuatKho,
                               d.ID_TheKhoKienBTP, d.ItemCode, d.DauTuan,
                               k.ID_ViTriKho, k.QRCode, v.ID_Kho
                        FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien x WITH (UPDLOCK, HOLDLOCK)
                        JOIN dbo.TheKhoKienBTP_ChiTiet d ON d.ID_TheKhoKienBTP_ChiTiet=x.ID_TheKhoKienBTP_ChiTiet
                        JOIN dbo.TheKhoKienBTP k WITH (UPDLOCK, HOLDLOCK) ON k.ID_TheKhoKienBTP=d.ID_TheKhoKienBTP
                        JOIN dbo.DM_Kho_ViTri v ON v.ID_ViTriKho=k.ID_ViTriKho
                        WHERE x.ID_PhieuXuatBTP=@OrderID AND k.QRCode=@PalletID
                          AND d.TonTai=1 AND k.TonTai=1`)).recordset;
            if (saved.length !== 1 || Number(saved[0].ID_Kho) !== 5 ||
                Number(saved[0].ID_ViTriKho) === temporaryLocationID ||
                String(saved[0].ItemCode || '').trim() !== itemCode ||
                (String(saved[0].DauTuan || '').trim() || 'NO_WEEK_MARK') !== lot ||
                Number(saved[0].SoLuong_XuatKho) !== requested)
                throw craneWms.craneError(409, 'Kiện đã lưu không khớp thông tin WMS');
            if (await craneWms.findActivePallet(transaction, palletID, true))
                throw craneWms.craneError(409, 'Pallet đang chờ WMS ở phiếu khác');

            const remainingResult = await new sql.Request(transaction)
                .input('PackageID', sql.Int, Number(saved[0].ID_TheKhoKienBTP))
                .query(`SELECT SUM(d.SoLuong - ISNULL(x.Exported,0)) AS Remaining
                        FROM dbo.TheKhoKienBTP_ChiTiet d WITH (UPDLOCK, HOLDLOCK)
                        OUTER APPLY (SELECT SUM(SoLuong_XuatKho) AS Exported
                            FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien WITH (UPDLOCK, HOLDLOCK)
                            WHERE ID_TheKhoKienBTP_ChiTiet=d.ID_TheKhoKienBTP_ChiTiet) x
                        WHERE d.ID_TheKhoKienBTP=@PackageID AND d.TonTai=1`);
            const remaining = Number(remainingResult.recordset[0]?.Remaining);
            if (!Number.isFinite(remaining) || remaining < 0)
                throw craneWms.craneError(409, 'Tồn pallet không hợp lệ');
            const status = remaining > 0 ? 'WAITING_RETURN' : 'COMPLETE';
            const palletStatus = remaining > 0 ? 'WAITING_RETURN' : 'EXPORTED_FULL';
            const requestJson = JSON.stringify({ orderID: String(orderID), orderCode,
                orderType: 'OUTBOUND', warehouseID: 5,
                pallets: [{ palletID, quantity: requested }],
                items: [{ palletID, itemCode, lot, quantity: requested }] });

            if (remaining > 0) {
                await new sql.Request(transaction)
                    .input('ID_TheKhoKienBTP', sql.Int, Number(saved[0].ID_TheKhoKienBTP))
                    .input('ID_ViTriKho', sql.Int, temporaryLocationID)
                    .input('ID_TaiKhoan', sql.Int, null)
                    .input('LoaiThaoTac', sql.VarChar(20), 'DIEU_CHUYEN')
                    .execute('dbo.App_BTP_CapNhatViTriKien');
            }
            await new sql.Request(transaction)
                .input('OrderID', sql.Int, orderID)
                .input('OrderCode', sql.NVarChar(255), orderCode)
                .input('Status', sql.VarChar(24), status)
                .input('RequestJson', sql.NVarChar(sql.MAX), requestJson)
                .input('CallbackJson', sql.NVarChar(sql.MAX), fingerprint)
                .query(`INSERT dbo.CraneWmsOutbound
                    (ID_PhieuXuatBTP,ID_Kho,OrderCode,Status,DispatchStatus,DispatchAttempts,RequestJson,CallbackJson)
                    VALUES (@OrderID,5,@OrderCode,@Status,'MOCKED',1,@RequestJson,@CallbackJson)`);
            await new sql.Request(transaction)
                .input('OrderID', sql.Int, orderID)
                .input('PackageID', sql.Int, Number(saved[0].ID_TheKhoKienBTP))
                .input('PalletID', sql.NVarChar(255), palletID)
                .input('OriginalLocationID', sql.Int, Number(saved[0].ID_ViTriKho))
                .input('Initial', sql.Decimal(18, 2), remaining + exported)
                .input('Planned', sql.Decimal(18, 2), requested)
                .input('Actual', sql.Decimal(18, 2), exported)
                .input('Status', sql.VarChar(24), palletStatus)
                .query(`INSERT dbo.CraneWmsOutboundPallet
                    (ID_PhieuXuatBTP,ID_TheKhoKienBTP,PalletID,OriginalLocationID,
                     InitialQuantity,PlannedQuantity,ActualQuantity,Status)
                    VALUES (@OrderID,@PackageID,@PalletID,@OriginalLocationID,
                            @Initial,@Planned,@Actual,@Status)`);

            await transaction.commit();
            finished = true;
            return res.json({ success: true, orderID: String(orderID), palletID,
                exportedQuantity: exported, remainingQuantity: remaining,
                status, temporaryLocationID: remaining > 0 ? temporaryLocationID : null,
                message: 'Callback demo đã xử lý' });
        } catch (error) {
            if (transaction && !finished) {
                try { await transaction.rollback(); } catch (rollbackError) {
                    console.error('[crane demo callback rollback]', rollbackError);
                }
            }
            console.error('[crane demo callback]', error);
            return res.status(error.statusCode || 500).json({ success: false,
                orderID: String(orderID || ''), message: error.statusCode ? error.message : 'Internal Server Error' });
        }
    };
}

function createCraneDemoLocationCallback(testpoolPromise) {
    return async (req, res, next) => {
        const body = req.body || {};
        if (body.demoMode !== true) return next();

        const sourceOrderID = craneWms.positiveId(body.sourceOrderID);
        const locationID = craneWms.positiveId(body.locationID);
        const previousLocationID = craneWms.positiveId(body.previousLocationID);
        const palletID = typeof body.palletID === 'string' ? body.palletID.trim() : '';
        const eventID = typeof body.eventID === 'string' ? body.eventID.trim() : '';
        if (!sourceOrderID || !locationID || !previousLocationID || !palletID ||
            palletID.length > 255 || !eventID || eventID.length > 255 ||
            body.reason !== 'RETURN_AFTER_PARTIAL_OUTBOUND' ||
            locationID === previousLocationID) {
            return res.status(400).json({ success: false, message: 'Callback nhập lại demo không hợp lệ' });
        }

        let transaction;
        let finished = false;
        try {
            const pool = await testpoolPromise;
            transaction = new sql.Transaction(pool);
            await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

            const order = await craneWms.findCraneOrder(transaction, sourceOrderID, true);
            if (!order || Number(order.ID_Kho) !== 5)
                throw craneWms.craneError(404, 'Không tìm thấy phiếu cầu trục demo');
            const cycle = (await new sql.Request(transaction)
                .input('OrderID', sql.Int, sourceOrderID)
                .input('PalletID', sql.NVarChar(255), palletID)
                .query(`SELECT * FROM dbo.CraneWmsOutboundPallet WITH (UPDLOCK, HOLDLOCK)
                        WHERE ID_PhieuXuatBTP=@OrderID AND PalletID=@PalletID`)).recordset[0];
            if (!cycle) throw craneWms.craneError(404, 'Không tìm thấy pallet của phiếu');
            if (cycle.Status === 'RETURNED' && cycle.ReturnEventID === eventID &&
                Number(cycle.ReturnLocationID) === locationID) {
                await transaction.commit();
                finished = true;
                return res.json({ success: true, palletID, locationID, updated: false });
            }
            if (cycle.Status !== 'WAITING_RETURN' || order.Status !== 'WAITING_RETURN')
                throw craneWms.craneError(409, 'Pallet không ở trạng thái chờ nhập lại');
            if (Number(cycle.OriginalLocationID) !== locationID)
                throw craneWms.craneError(409, 'Vị trí nhập lại không phải vị trí gốc của pallet');

            const tempLocation = (await new sql.Request(transaction)
                .query(`SELECT ID_ViTriKho FROM dbo.DM_Kho_ViTri WITH (HOLDLOCK)
                        WHERE ID_Kho=5 AND MaViTriKho=N'CT-TEMP-TEST' AND TonTai=1 AND SuDung=1`)).recordset;
            if (tempLocation.length !== 1 || Number(tempLocation[0].ID_ViTriKho) !== previousLocationID)
                throw craneWms.craneError(409, 'previousLocationID không phải vị trí tạm demo');
            const target = (await new sql.Request(transaction)
                .input('LocationID', sql.Int, locationID)
                .query(`SELECT ID_ViTriKho FROM dbo.DM_Kho_ViTri WITH (HOLDLOCK)
                        WHERE ID_ViTriKho=@LocationID AND ID_Kho=5 AND TonTai=1 AND SuDung=1`)).recordset;
            if (target.length !== 1)
                throw craneWms.craneError(400, 'Vị trí nhập lại không thuộc kho BTP test');
            const current = (await new sql.Request(transaction)
                .input('PackageID', sql.Int, Number(cycle.ID_TheKhoKienBTP))
                .query(`SELECT ID_ViTriKho, QRCode FROM dbo.TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK)
                        WHERE ID_TheKhoKienBTP=@PackageID AND TonTai=1`)).recordset[0];
            if (!current || current.QRCode !== palletID || Number(current.ID_ViTriKho) !== previousLocationID)
                throw craneWms.craneError(409, 'Pallet không còn ở vị trí tạm');
            const usedEvent = (await new sql.Request(transaction)
                .input('EventID', sql.NVarChar(255), eventID)
                .query(`SELECT ID_PhieuXuatBTP FROM dbo.CraneWmsOutboundPallet WITH (UPDLOCK, HOLDLOCK)
                        WHERE ReturnEventID=@EventID`)).recordset;
            if (usedEvent.length) throw craneWms.craneError(409, 'Mã sự kiện WMS đã được dùng');

            await new sql.Request(transaction)
                .input('ID_TheKhoKienBTP', sql.Int, Number(cycle.ID_TheKhoKienBTP))
                .input('ID_ViTriKho', sql.Int, locationID)
                .input('ID_TaiKhoan', sql.Int, null)
                .input('LoaiThaoTac', sql.VarChar(20), 'DIEU_CHUYEN')
                .execute('dbo.App_BTP_CapNhatViTriKien');
            await new sql.Request(transaction)
                .input('OrderID', sql.Int, sourceOrderID)
                .input('PackageID', sql.Int, Number(cycle.ID_TheKhoKienBTP))
                .input('EventID', sql.NVarChar(255), eventID)
                .input('LocationID', sql.Int, locationID)
                .query(`UPDATE dbo.CraneWmsOutboundPallet
                        SET Status='RETURNED', ReturnEventID=@EventID, ReturnLocationID=@LocationID
                        WHERE ID_PhieuXuatBTP=@OrderID AND ID_TheKhoKienBTP=@PackageID;
                        IF NOT EXISTS (SELECT 1 FROM dbo.CraneWmsOutboundPallet
                            WHERE ID_PhieuXuatBTP=@OrderID AND Status='WAITING_RETURN')
                        UPDATE dbo.CraneWmsOutbound SET Status='COMPLETE', UpdatedAt=SYSUTCDATETIME()
                            WHERE ID_PhieuXuatBTP=@OrderID;`);
            await transaction.commit();
            finished = true;
            return res.json({ success: true, palletID, locationID, updated: true,
                status: 'RETURNED', message: 'Pallet đã nhập lại kho BTP test' });
        } catch (error) {
            if (transaction && !finished) {
                try { await transaction.rollback(); } catch (rollbackError) {
                    console.error('[crane demo location rollback]', rollbackError);
                }
            }
            console.error('[crane demo location callback]', error);
            return res.status(error.statusCode || 500).json({ success: false,
                palletID, message: error.statusCode ? error.message : 'Internal Server Error' });
        }
    };
}

module.exports = { createCraneDemoCallback, createCraneDemoLocationCallback };
