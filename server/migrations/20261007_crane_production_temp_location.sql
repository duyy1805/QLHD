/*
    Create the dedicated production holding location for partial crane pallets.
    It deliberately uses area CTT, so GET /erp/wms/locations (area CT) never
    exposes it as a physical WMS slot.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'TAG_QTKD'
    THROW 51220, N'Wrong database. Crane holding location belongs in TAG_QTKD.', 1;

BEGIN TRY
    BEGIN TRANSACTION;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.DM_Kho WITH (UPDLOCK, HOLDLOCK)
        WHERE ID_Kho=5 AND TonTai=1 AND SuDung=1
    ) THROW 51221, N'Active crane warehouse ID 5 was not found.', 1;

    IF EXISTS (
        SELECT 1 FROM dbo.DM_Kho_ViTri WITH (UPDLOCK, HOLDLOCK)
        WHERE (MaViTriKho=N'CT-TEMP' OR QRCode=N'CT-TEMP')
          AND (ID_Kho<>5 OR MaViTriKho<>N'CT-TEMP' OR QRCode<>N'CT-TEMP')
    ) THROW 51222, N'CT-TEMP code or QR is already owned by another location.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.DM_Kho_ViTri WITH (UPDLOCK, HOLDLOCK)
        WHERE ID_Kho=5 AND MaViTriKho=N'CT-TEMP'
    )
    BEGIN
        INSERT dbo.DM_Kho_ViTri
            (ID_Kho, MaViTriKho, TenViTriKho, TenNha, MaNha,
             TenKhuVuc, MaKhuVuc, QRCode, STT_ViTriKho, SuDung, TonTai,
             MaVung, TenVung)
        VALUES
            (5, N'CT-TEMP', N'Vị trí tạm kho cầu trục', N'Kho cầu trục Z76', N'Z76',
             N'Vị trí tạm cầu trục', N'CTT', N'CT-TEMP', 0, 1, 1,
             N'A', N'Khu A');
    END;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.DM_Kho_ViTri
        WHERE ID_Kho=5 AND MaViTriKho=N'CT-TEMP' AND QRCode=N'CT-TEMP'
          AND MaNha=N'Z76' AND MaKhuVuc=N'CTT' AND TonTai=1 AND SuDung=1
    ) THROW 51223, N'Existing CT-TEMP location does not match the production definition.', 1;

    COMMIT TRANSACTION;

    SELECT ID_ViTriKho, ID_Kho, MaViTriKho, TenViTriKho, MaNha, MaKhuVuc,
           QRCode, SuDung, TonTai
    FROM dbo.DM_Kho_ViTri
    WHERE ID_Kho=5 AND MaViTriKho=N'CT-TEMP';
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
