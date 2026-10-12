-- Run on each target database after 20260928_crane_wms_inbound.sql.example.
-- Idempotent migration for incremental crane inbound by package.
IF OBJECT_ID(N'dbo.CraneWmsInbound', N'U') IS NULL
    THROW 51070, N'Run 20260928_crane_wms_inbound.sql.example first', 1;

IF COL_LENGTH(N'dbo.CraneWmsInbound', N'FinalizeStatus') IS NULL
    ALTER TABLE dbo.CraneWmsInbound ADD FinalizeStatus VARCHAR(12) NOT NULL
        CONSTRAINT DF_CraneWmsInbound_FinalizeStatus DEFAULT 'WAITING';
IF COL_LENGTH(N'dbo.CraneWmsInbound', N'FinalizeError') IS NULL
    ALTER TABLE dbo.CraneWmsInbound ADD FinalizeError NVARCHAR(1000) NULL;
IF COL_LENGTH(N'dbo.CraneWmsInbound', N'FinalizedAt') IS NULL
    ALTER TABLE dbo.CraneWmsInbound ADD FinalizedAt DATETIME2 NULL;

IF OBJECT_ID(N'dbo.CraneWmsInboundPackage', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CraneWmsInboundPackage (
        ID_PhieuNhapBTP INT NOT NULL,
        ID_TheKhoKienBTP INT NOT NULL,
        PalletID NVARCHAR(255) NOT NULL,
        RequestJson NVARCHAR(MAX) NOT NULL,
        DispatchStatus VARCHAR(12) NOT NULL
            CONSTRAINT DF_CraneWmsInboundPackage_Status DEFAULT 'PENDING',
        DispatchAttempts INT NOT NULL
            CONSTRAINT DF_CraneWmsInboundPackage_Attempts DEFAULT 0,
        ResponseStatus INT NULL,
        DispatchError NVARCHAR(1000) NULL,
        LocationID INT NULL,
        SentAt DATETIME2 NULL,
        LocatedAt DATETIME2 NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_CraneWmsInboundPackage_Created DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_CraneWmsInboundPackage_Updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CraneWmsInboundPackage PRIMARY KEY (ID_PhieuNhapBTP, ID_TheKhoKienBTP),
        CONSTRAINT FK_CraneWmsInboundPackage_Order FOREIGN KEY (ID_PhieuNhapBTP)
            REFERENCES dbo.CraneWmsInbound(ID_PhieuNhapBTP),
        CONSTRAINT CK_CraneWmsInboundPackage_Status
            CHECK (DispatchStatus IN ('PENDING','SENDING','SENT','FAILED'))
    );
    CREATE UNIQUE INDEX UX_CraneWmsInboundPackage_Pallet
        ON dbo.CraneWmsInboundPackage(PalletID);
END;
