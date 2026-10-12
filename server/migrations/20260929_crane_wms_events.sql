-- Chạy trên DB đích đã có migration CraneWmsOutbound. Không tự chọn database.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.CraneWmsOutbound', N'U') IS NULL
    THROW 51050, N'Chạy migration crane_wms_outbound trước', 1;
IF OBJECT_ID(N'dbo.CraneWmsOutboundEvent', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CraneWmsOutboundEvent (
        EventID nvarchar(255) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
        ID_PhieuXuatBTP int NOT NULL UNIQUE,
        PayloadJson nvarchar(max) NOT NULL,
        ResultJson nvarchar(max) NOT NULL,
        CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_CraneOutboundEvent_Order FOREIGN KEY (ID_PhieuXuatBTP)
            REFERENCES dbo.CraneWmsOutbound(ID_PhieuXuatBTP),
        CONSTRAINT CK_CraneOutboundEvent_Payload CHECK (ISJSON(PayloadJson)=1),
        CONSTRAINT CK_CraneOutboundEvent_Result CHECK (ISJSON(ResultJson)=1)
    );
END;
COMMIT;                        
