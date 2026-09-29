// Opt-in: RUN_WMS_DB_TESTS=1 node --test test/craneWmsOutbound.integration.test.js
// Creates dedicated test rows and removes only those IDs in finally. Never connects to db2.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const express = require('express');
const outbound = require('../utils/craneWmsOutbound');

test('WMS HTTP + DB: validation, confirmation, concurrency, rollback and return',
    { skip: process.env.RUN_WMS_DB_TESTS !== '1', timeout: 180000 }, async () => {
    require('dotenv').config({ quiet: true });
    assert.ok(process.env.DB_DATABASE_TEST && process.env.DB_SERVER_TEST);
    const lower=value=>String(value||'').toLowerCase();
    assert.ok(!(lower(process.env.DB_SERVER_TEST) === lower(process.env.DB_SERVER2) &&
        lower(process.env.DB_DATABASE_TEST) === lower(process.env.DB_DATABASE2) && Number(process.env.DB_PORT_TEST) === Number(process.env.DB_PORT2)));
    const pool = await new sql.ConnectionPool({ server: process.env.DB_SERVER_TEST, database: process.env.DB_DATABASE_TEST,
        user: process.env.DB_USER_TEST, password: process.env.DB_PASSWORD_TEST, port: Number(process.env.DB_PORT_TEST),
        options: { encrypt: true, trustServerCertificate: true }, requestTimeout: 30000 }).connect();
    const prefix = 'WA' + Date.now().toString(36), orderIDs = [], packageIDs = [];
    let server;
    const oldDb2 = require.cache[require.resolve('../db2')];
    try {
        await pool.request().batch(fs.readFileSync(path.join(__dirname, '../migrations/20260929_crane_wms_events.sql'), 'utf8'));
        const cfg = await outbound.config(pool, true);
        const templates = (await pool.request().query(`
            SELECT TOP 1 ID_PhieuXuatBTP FROM dbo.PhieuXuatBTP WHERE TonTai=1 AND ID_KhoXuat=5
                AND EXISTS(SELECT 1 FROM dbo.PhieuXuatBTP_ChiTiet d WHERE d.ID_PhieuXuatBTP=PhieuXuatBTP.ID_PhieuXuatBTP)
                ORDER BY ID_PhieuXuatBTP DESC;
            SELECT TOP 1 k.ID_TheKhoKienBTP,k.ID_ViTriKho,d.ID_TheKhoKienBTP_ChiTiet
                FROM dbo.TheKhoKienBTP k JOIN dbo.TheKhoKienBTP_ChiTiet d ON d.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP
                JOIN dbo.DM_Kho_ViTri v ON v.ID_ViTriKho=k.ID_ViTriKho
                WHERE k.TonTai=1 AND d.TonTai=1 AND v.ID_Kho=5 AND v.TonTai=1 AND v.SuDung=1
                    AND v.MaViTriKho<>N'CT-TEMP-TEST' ORDER BY k.ID_TheKhoKienBTP DESC;`)).recordsets;
        const sourceID=templates[0][0].ID_PhieuXuatBTP, source=templates[1][0];
        const sourceLine=(await outbound.loadDetails(pool, sourceID))[0];
        assert.ok(sourceLine?.ItemCode);
        async function clone(table, identity, sourceId, changes) {
            const columns=(await pool.request().input('Name',sql.NVarChar(255),'dbo.'+table).query(`
                SELECT name FROM sys.columns WHERE object_id=OBJECT_ID(@Name) AND is_identity=0 AND is_computed=0 ORDER BY column_id`)).recordset.map(x=>x.name);
            const req=pool.request().input('Source',sql.Int,sourceId);
            const values=columns.map((col,i)=>{
                if(!Object.hasOwn(changes,col)) return '['+col+']';
                req.input('v'+i,changes[col]);return '@v'+i;
            });
            return (await req.query(`INSERT dbo.${table} (${columns.map(c=>'['+c+']').join(',')})
                OUTPUT inserted.${identity} SELECT ${values.join(',')} FROM dbo.${table} WHERE ${identity}=@Source`)).recordset[0][identity];
        }
        async function fixture(suffix, stock=500) {
            const code=prefix+'-'+(orderIDs.length+1);
            const id=await clone('PhieuXuatBTP','ID_PhieuXuatBTP',sourceID,{So_PhieuXuatBTP:code,QrStatus:false,TrangThai:1});
            orderIDs.push(id);
            await pool.request().input('ID',sql.Int,id).input('Order',sql.Int,sourceLine.ID_DonHang)
                .input('Lot',sql.Int,sourceLine.ID_DonHang_LoSanXuat).input('Product',sql.Int,sourceLine.ID_DonHang_SanPham)
                .query(`INSERT dbo.PhieuXuatBTP_ChiTiet(ID_PhieuXuatBTP,ID_DonHang,ID_DonHang_LoSanXuat,ID_DonHang_SanPham,SoLuong_XuatKho)
                    VALUES(@ID,@Order,@Lot,@Product,300)`);
            const qr=code+'-QR';
            const pkg=await clone('TheKhoKienBTP','ID_TheKhoKienBTP',source.ID_TheKhoKienBTP,{QRCode:qr});
            packageIDs.push(pkg);
            const detail=await clone('TheKhoKienBTP_ChiTiet','ID_TheKhoKienBTP_ChiTiet',source.ID_TheKhoKienBTP_ChiTiet,
                {ID_TheKhoKienBTP:pkg,ItemCode:sourceLine.ItemCode,DauTuan:'2639',SoLuong:stock});
            return {id,code,pkg,detail,qr,body:{eventID:code+'-EVENT',orderID:String(id),orderCode:code,
                orderType:'OUTBOUND',status:'COMPLETED',processedAt:'2026-09-29T01:00:00Z',items:[{
                    itemCode:sourceLine.ItemCode,lot:'2639',requestedQuantity:300,exportedQuantity:300,
                    pallets:[{palletID:qr,quantity:300}]}]}};
        }
        // Loading ERP factory must not open its default production connection.
        require.cache[require.resolve('../db2')]={id:require.resolve('../db2'),filename:require.resolve('../db2'),loaded:true,exports:{tagpoolPromise:Promise.resolve(pool)}};
        const {createRouter}=require('../routes/ERP/erp');
        const app=express();app.use(express.json());app.use('/erp-test',createRouter(Promise.resolve(pool),{isTest:true}));
        app.use('/khotmtest',require('../routes/khotmtest'));
        server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
        const base='http://127.0.0.1:'+server.address().port;
        const send=async(url,body,method=body?'POST':'GET')=>{
            const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json','x-api-key':process.env.API_KEY},
                ...(body?{body:JSON.stringify(body)}:{})});return {code:response.status,body:await response.json()};
        };
        const callback=body=>send('/erp-test/wms/outbound-callback',body);
        const a=await fixture('partial-pallet');
        assert.equal((await send('/erp-test/wms/outbound-orders?soPhieu='+a.code)).body.data.length,1);
        assert.equal((await send('/erp-test/wms/outbound-orders/'+a.id)).body.data.items[0].quantity,300);
        const invalid=[ [{...a.body,eventID:undefined},400], [{...a.body,orderCode:'WRONG'},409],
            [{...a.body,status:'PARTIAL'},422], [{...a.body,status:'FAILED'},422] ];
        for (const [body,expected] of invalid) assert.equal((await callback(body)).code,expected);
        const wrong=structuredClone(a.body);wrong.items[0].lot='WRONG';assert.equal((await callback(wrong)).code,409);
        const short=structuredClone(a.body);short.items[0].requestedQuantity=short.items[0].exportedQuantity=short.items[0].pallets[0].quantity=299;
        assert.equal((await callback(short)).code,422);
        const missing=structuredClone(a.body);missing.items[0].pallets[0].palletID='NO-SUCH-QR';assert.equal((await callback(missing)).code,404);
        const mismatch=structuredClone(a.body);mismatch.items[0].pallets[0].quantity=299;assert.equal((await callback(mismatch)).code,400);
        const both=await Promise.all([callback(a.body),callback(a.body)]);
        assert.deepEqual(both.map(r=>r.code),[200,200]);
        assert.deepEqual(both.map(r=>r.body.duplicate).sort(),[false,true]);
        assert.equal(both[0].body.pallets[0].remainingQuantity,200);
        assert.equal((await callback({...a.body,processedAt:'2026-09-29T02:00:00Z'})).code,409);
        assert.equal((await callback({...a.body,eventID:a.body.eventID+'-new'})).code,409);
        assert.equal((await send('/erp-test/wms/outbound-orders?soPhieu='+a.code)).body.data.length,0);
        const tracked=(await send('/khotmtest/btp/cau-truc/orders/'+a.id)).body;
        assert.equal(tracked.pallets[0].CurrentLocationID,cfg.temporaryLocationID);
        const appList=await send('/khotmtest/btp/phieuxuat/tim-kiem',{
            craneMode:true,soPhieu:a.code,IdTaiKhoanDangNhap:1,PageSize:20,PageIndex:0});
        assert.equal(appList.code,200);assert.equal(appList.body.data[0].wmsStatus,'WAITING_RETURN');
        const saved=await send('/khotmtest/btp/phieuxuat/'+a.id);
        assert.equal(saved.body.trangThai,true);assert.equal(saved.body.kiens[0].qrCode,a.qr);
        assert.equal((await callback({...a.body,eventID:undefined})).code,400);
        const locked=await fixture('locked');locked.body.items[0].pallets[0].palletID=a.qr;
        assert.equal((await callback(locked.body)).code,409);
        const wrongWarehouse=await fixture('warehouse');
        const otherWarehouse=(await pool.request().query('SELECT TOP 1 ID_Kho FROM DM_Kho WHERE ID_Kho<>5 ORDER BY ID_Kho')).recordset[0].ID_Kho;
        await pool.request().input('ID',sql.Int,wrongWarehouse.id).input('Warehouse',sql.Int,otherWarehouse)
            .query('UPDATE PhieuXuatBTP SET ID_KhoXuat=@Warehouse WHERE ID_PhieuXuatBTP=@ID');
        assert.equal((await callback(wrongWarehouse.body)).code,409);
        const returned={reason:'RETURN_AFTER_PARTIAL_OUTBOUND',sourceOrderID:String(a.id),palletID:a.qr,
            eventID:a.code+'-RETURN',previousLocationID:cfg.temporaryLocationID,locationID:source.ID_ViTriKho};
        assert.equal((await send('/erp-test/wms/location-callback',returned)).body.updated,true);
        assert.equal((await send('/erp-test/wms/location-callback',returned)).body.updated,false);
        assert.equal((await callback(a.body)).body.duplicate,true);
        const full=await fixture('full',300);assert.equal((await callback(full.body)).body.status,'COMPLETE');
        const race=await fixture('race-events',300);
        const raceResults=await Promise.all([callback(race.body),callback({...race.body,eventID:race.body.eventID+'-other'})]);
        assert.deepEqual(raceResults.map(x=>x.code).sort(),[200,409]);
        const insufficient=await fixture('insufficient',299);assert.equal((await callback(insufficient.body)).code,409);
        const multi=await fixture('multiple-lots');
        // Two destination lines of the same product; preserve 150+150, not 300 on each line.
        await pool.request().input('ID',sql.Int,multi.id).query(`
            UPDATE PhieuXuatBTP_ChiTiet SET SoLuong_XuatKho=150 WHERE ID_PhieuXuatBTP=@ID;
            INSERT PhieuXuatBTP_ChiTiet(ID_PhieuXuatBTP,ID_DonHang,ID_DonHang_LoSanXuat,ID_DonHang_SanPham,SoLuong_XuatKho)
                SELECT ID_PhieuXuatBTP,ID_DonHang,0,ID_DonHang_SanPham,150 FROM PhieuXuatBTP_ChiTiet WHERE ID_PhieuXuatBTP=@ID;`);
        const qr2=multi.qr+'B';
        const pkg2=await clone('TheKhoKienBTP','ID_TheKhoKienBTP',source.ID_TheKhoKienBTP,{QRCode:qr2});packageIDs.push(pkg2);
        await clone('TheKhoKienBTP_ChiTiet','ID_TheKhoKienBTP_ChiTiet',source.ID_TheKhoKienBTP_ChiTiet,
            {ID_TheKhoKienBTP:pkg2,ItemCode:sourceLine.ItemCode,DauTuan:'2640',SoLuong:200});
        multi.body.items[0].requestedQuantity=multi.body.items[0].exportedQuantity=multi.body.items[0].pallets[0].quantity=100;
        multi.body.items.push({itemCode:sourceLine.ItemCode,lot:'2640',requestedQuantity:200,exportedQuantity:200,pallets:[{palletID:qr2,quantity:200}]});
        assert.equal((await callback(multi.body)).code,200);
        const quantities=(await pool.request().input('ID',sql.Int,multi.id).query('SELECT SoLuong_XuatKho FROM PhieuXuatBTP_ChiTiet WHERE ID_PhieuXuatBTP=@ID')).recordset;
        assert.deepEqual(quantities.map(x=>Number(x.SoLuong_XuatKho)),[150,150]);
        const ordinary=await fixture('ordinary-btp');
        assert.equal((await send('/khotmtest/btp/phieuxuat/xac-nhan',{IdPhieuXuat:ordinary.id,Kiens:[{
            IdTheKhoKienBTPChiTiet:ordinary.detail,IdDonHang:sourceLine.ID_DonHang,IdDonHangLoSanXuat:sourceLine.ID_DonHang_LoSanXuat,
            IdDonHangSanPham:sourceLine.ID_DonHang_SanPham,SoLuongXuatKho:300}]},'PUT')).code,200);
        const legacy=await fixture('legacy-crane');
        const oldWarehouse=process.env.CRANE_WAREHOUSE_ID,oldLocation=process.env.CRANE_TEMP_LOCATION_ID;
        try {
            process.env.CRANE_WAREHOUSE_ID='5';process.env.CRANE_TEMP_LOCATION_ID=String(cfg.temporaryLocationID);
            await require('../utils/craneWms').confirmCraneOutbound(pool,legacy.id,[{
                IdTheKhoKienBTPChiTiet:legacy.detail,IdDonHang:sourceLine.ID_DonHang,IdDonHangLoSanXuat:sourceLine.ID_DonHang_LoSanXuat,
                IdDonHangSanPham:sourceLine.ID_DonHang_SanPham,SoLuongXuatKho:300}]);
            const body={...legacy.body};delete body.eventID;
            assert.equal((await callback(body)).code,200);
            assert.equal((await callback(body)).body.duplicate,true);
        } finally {
            if(oldWarehouse===undefined) delete process.env.CRANE_WAREHOUSE_ID;else process.env.CRANE_WAREHOUSE_ID=oldWarehouse;
            if(oldLocation===undefined) delete process.env.CRANE_TEMP_LOCATION_ID;else process.env.CRANE_TEMP_LOCATION_ID=oldLocation;
        }
        // Inject failures after confirmation and after a successful location update; original DB writes must roll back.
        for(const stage of ['confirm','location']) {
            const f=await fixture('rollback-'+stage);
            const originalQuery=sql.Request.prototype.query, originalExecute=sql.Request.prototype.execute;
            let injected=false;
            if(stage==='confirm') sql.Request.prototype.query=async function(command,...args){
                const result=await originalQuery.call(this,command,...args);
                if(!injected && String(command).includes('SET QrStatus=1,TrangThai=4')){injected=true;throw new Error('Injected after confirm');}return result;
            };
            else sql.Request.prototype.execute=async function(command,...args){
                const result=await originalExecute.call(this,command,...args);
                if(!injected && command==='dbo.App_BTP_CapNhatViTriKien'){injected=true;throw new Error('Injected after location');}return result;
            };
            try {await assert.rejects(outbound.confirm(pool,f.body,true),/Injected/);} finally {
                sql.Request.prototype.query=originalQuery;sql.Request.prototype.execute=originalExecute;
            }
            const state=(await pool.request().input('ID',sql.Int,f.id).input('Package',sql.Int,f.pkg).query(`
                SELECT QrStatus FROM PhieuXuatBTP WHERE ID_PhieuXuatBTP=@ID;
                SELECT * FROM CraneWmsOutboundEvent WHERE ID_PhieuXuatBTP=@ID;
                SELECT * FROM PhieuXuatBTP_ChiTiet_TheKhoKien WHERE ID_PhieuXuatBTP=@ID;
                SELECT ID_ViTriKho FROM TheKhoKienBTP WHERE ID_TheKhoKienBTP=@Package;`)).recordsets;
            assert.equal(state[0][0].QrStatus,false);assert.equal(state[1].length,0);assert.equal(state[2].length,0);
            assert.equal(state[3][0].ID_ViTriKho,source.ID_ViTriKho);
            assert.equal((await callback(f.body)).code,200);
        }
        console.log('WMS DB test passed: isolated fixtures, HTTP sequence, retries, concurrency, rollback and return.');
    } finally {
        if(server) await new Promise(r=>server.close(r));
        if(oldDb2) require.cache[require.resolve('../db2')]=oldDb2;else delete require.cache[require.resolve('../db2')];
        for(const id of orderIDs) await pool.request().input('ID',sql.Int,id).query(`
            DELETE dbo.CraneWmsOutboundEvent WHERE ID_PhieuXuatBTP=@ID;
            DELETE dbo.CraneWmsOutboundPallet WHERE ID_PhieuXuatBTP=@ID;
            DELETE dbo.CraneWmsOutbound WHERE ID_PhieuXuatBTP=@ID;
            DELETE dbo.PhieuXuatBTP_ChiTiet_TheKhoKien WHERE ID_PhieuXuatBTP=@ID;
            DELETE dbo.PhieuXuatBTP_ChiTiet WHERE ID_PhieuXuatBTP=@ID;
            DELETE dbo.PhieuXuatBTP WHERE ID_PhieuXuatBTP=@ID;`);
        for(const id of packageIDs) await pool.request().input('ID',sql.Int,id).query(`
            DELETE dbo.TheKhoKienBTP_LichSuViTri WHERE ID_TheKhoKienBTP=@ID;
            DELETE dbo.TheKhoKienBTP_ChiTiet WHERE ID_TheKhoKienBTP=@ID;
            DELETE dbo.TheKhoKienBTP WHERE ID_TheKhoKienBTP=@ID;`);
        await pool.close();
        const cached=require.cache[require.resolve('../dbtest')];
        if(cached) await (await cached.exports.testpoolPromise).close();
    }
});
