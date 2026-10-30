const sql = require('mssql');

const PROCEDURES = Object.freeze({
    units: 'dbo.pr_WMS_XuatSX_DonVi_Select',
    departments: 'dbo.pr_WMS_XuatSX_BoPhan_Select_ByDonVi',
    list: 'dbo.pr_WMS_YeuCauXuat_List',
    insert: 'dbo.pr_WMS_YeuCauXuat_Insert',
    select: 'dbo.pr_WMS_YeuCauXuat_Select',
    save: 'dbo.pr_WMS_YeuCauXuat_Save',
    remove: 'dbo.pr_WMS_YeuCauXuat_Delete',
    stock: 'dbo.pr_WMS_YeuCauXuat_HangTon_Select',
    dispatchRead: 'dbo.pr_WMS_YeuCauXuat_Dispatch_Read',
    dispatchClaim: 'dbo.pr_WMS_YeuCauXuat_Dispatch_Claim',
    dispatchFinish: 'dbo.pr_WMS_YeuCauXuat_Dispatch_Finish',
    callback: 'dbo.pr_WMS_YeuCauXuat_Callback_Save',
    postErp: 'dbo.pr_WMS_YeuCauXuat_TaoChungTuERP',
});

function itemTable(items) {
    const table = new sql.Table('dbo.WMS_YeuCauXuat_ItemType');
    table.columns.add('ItemCode', sql.NVarChar(255), { nullable: false });
    table.columns.add('ItemName', sql.NVarChar(500), { nullable: false });
    table.columns.add('SoLuong', sql.Int, { nullable: false });
    table.columns.add('ThuTu', sql.Int, { nullable: false });
    table.columns.add('SkipLotJson', sql.NVarChar(sql.MAX), { nullable: true });
    items.forEach((item, index) => table.rows.add(item.itemCode, item.itemName, item.quantity,
        index + 1, JSON.stringify(item.skipLot || [])));
    return table;
}

function callbackTable(items) {
    const table = new sql.Table('dbo.WMS_YeuCauXuat_PalletType');
    table.columns.add('ItemCode', sql.NVarChar(255), { nullable: false });
    table.columns.add('Lot', sql.NVarChar(50), { nullable: false });
    table.columns.add('RequestedQuantity', sql.Int, { nullable: false });
    table.columns.add('ExportedQuantity', sql.Int, { nullable: false });
    table.columns.add('PalletID', sql.NVarChar(255), { nullable: false });
    table.columns.add('PalletQuantity', sql.Int, { nullable: false });
    for (const item of items || []) for (const pallet of item.pallets) {
        table.rows.add(item.itemCode, item.lot, item.requestedQuantity,
            item.exportedQuantity, pallet.palletID, pallet.quantity);
    }
    return table;
}

const request = executor => new sql.Request(executor);

module.exports = { sql, PROCEDURES, itemTable, callbackTable, request };
