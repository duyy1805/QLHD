/*
    Read-only production preflight for the crane warehouse.

    Set @WarehouseID and @TemporaryLocationID from the production database.
    This script never creates or updates data.
*/
SET NOCOUNT ON;

DECLARE @WarehouseID int = 5;
DECLARE @TemporaryLocationID int = NULL;

SELECT
    DB_NAME() AS DatabaseName,
    OBJECT_ID(N'dbo.CraneWmsOutbound', N'U') AS CraneWmsOutbound,
    OBJECT_ID(N'dbo.CraneWmsOutboundPallet', N'U') AS CraneWmsOutboundPallet,
    OBJECT_ID(N'dbo.CraneWmsOutboundEvent', N'U') AS CraneWmsOutboundEvent,
    OBJECT_ID(N'dbo.CraneWmsInbound', N'U') AS CraneWmsInbound,
    OBJECT_ID(N'dbo.CraneWmsInboundPackage', N'U') AS CraneWmsInboundPackage,
    COL_LENGTH(N'dbo.CraneWmsOutboundPallet', N'NewPalletID') AS NewPalletIDColumn,
    COL_LENGTH(N'dbo.CraneWmsInbound', N'FinalizeStatus') AS FinalizeStatusColumn;

SELECT ID_Kho, Ten_Kho, LoaiKho, SuDung, TonTai
FROM dbo.DM_Kho
WHERE ID_Kho=@WarehouseID;

-- Choose a dedicated holding location from this result, not a physical WMS slot.
SELECT ID_ViTriKho, ID_Kho, MaViTriKho, TenViTriKho,
       MaNha, TenNha, MaKhuVuc, TenKhuVuc, SuDung, TonTai
FROM dbo.DM_Kho_ViTri
WHERE ID_Kho=@WarehouseID
  AND (UPPER(ISNULL(MaViTriKho,N'')) LIKE N'%TEMP%'
       OR UPPER(ISNULL(MaViTriKho,N'')) LIKE N'%TAM%'
       OR UPPER(ISNULL(TenViTriKho,N'')) LIKE N'%TẠM%'
       OR MaKhuVuc=N'CTT')
ORDER BY ID_ViTriKho;

SELECT
    CASE WHEN k.ID_Kho IS NOT NULL THEN 1 ELSE 0 END AS WarehouseReady,
    CASE WHEN v.ID_ViTriKho IS NOT NULL THEN 1 ELSE 0 END AS TemporaryLocationReady,
    k.ID_Kho,
    k.Ten_Kho,
    v.ID_ViTriKho,
    v.MaViTriKho,
    v.TenViTriKho
FROM (VALUES (1)) seed(value)
LEFT JOIN dbo.DM_Kho k
  ON k.ID_Kho=@WarehouseID AND k.TonTai=1 AND k.SuDung=1
LEFT JOIN dbo.DM_Kho_ViTri v
  ON v.ID_ViTriKho=@TemporaryLocationID AND v.ID_Kho=k.ID_Kho
 AND v.TonTai=1 AND v.SuDung=1;

-- Expected final result: both values are 1 and the location is a dedicated
-- temporary holding position. Use these exact IDs for CRANE_WAREHOUSE_ID and
-- CRANE_TEMP_LOCATION_ID on the production backend.
