/*
    Import the physical Z76 crane locations into dbo.DM_Kho_ViTri.

    Location code: [crane]-[rack]-[tier]-[position]
    Example: D-3-6-01.

    The column mapping intentionally follows the agreed legacy convention:
      MaDay = crane, MaTang = rack, MaKe = tier, STT_ViTriKho = position.

    Rerunnable:
      - matching rows are left unchanged;
      - conflicting location codes or QR codes abort the whole transaction.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.DM_Kho', N'U') IS NULL
    THROW 51200, N'Thiếu bảng dbo.DM_Kho.', 1;
IF OBJECT_ID(N'dbo.DM_Kho_ViTri', N'U') IS NULL
    THROW 51201, N'Thiếu bảng dbo.DM_Kho_ViTri.', 1;

DECLARE @ExpectedLocationCount int = 1976;

DECLARE @Locations TABLE
(
    MaViTriKho nvarchar(25) NOT NULL PRIMARY KEY,
    TenViTriKho nvarchar(50) NOT NULL,
    CraneCode nvarchar(1) NOT NULL,
    RackNo tinyint NOT NULL,
    TierNo tinyint NOT NULL,
    PositionNo tinyint NOT NULL,
    QRCode nvarchar(50) NOT NULL UNIQUE
);

;WITH Cranes AS
(
    SELECT CraneCode, MaxTier
    FROM (VALUES
        (CONVERT(nvarchar(1), N'A'), CONVERT(tinyint, 6)),
        (CONVERT(nvarchar(1), N'B'), CONVERT(tinyint, 7)),
        (CONVERT(nvarchar(1), N'C'), CONVERT(tinyint, 7)),
        (CONVERT(nvarchar(1), N'D'), CONVERT(tinyint, 6))
    ) value(CraneCode, MaxTier)
),
Racks AS
(
    SELECT RackNo
    FROM (VALUES (1), (2), (3), (4)) value(RackNo)
),
Tiers AS
(
    SELECT TierNo
    FROM (VALUES (1), (2), (3), (4), (5), (6), (7)) value(TierNo)
),
Positions AS
(
    SELECT PositionNo
    FROM (VALUES
        (1), (2), (3), (4), (5), (6), (7), (8), (9), (10),
        (11), (12), (13), (14), (15), (16), (17), (18), (19)
    ) value(PositionNo)
),
Generated AS
(
    SELECT
        c.CraneCode,
        CONVERT(tinyint, r.RackNo) AS RackNo,
        CONVERT(tinyint, t.TierNo) AS TierNo,
        CONVERT(tinyint, p.PositionNo) AS PositionNo,
        CONVERT(nvarchar(25),
            c.CraneCode + N'-' + CONVERT(nvarchar(1), r.RackNo)
            + N'-' + CONVERT(nvarchar(1), t.TierNo)
            + N'-' + RIGHT(N'0' + CONVERT(nvarchar(2), p.PositionNo), 2)
        ) AS LocationCode
    FROM Cranes c
    CROSS JOIN Racks r
    CROSS JOIN Tiers t
    CROSS JOIN Positions p
    WHERE t.TierNo <= c.MaxTier
)
INSERT @Locations
    (MaViTriKho, TenViTriKho, CraneCode, RackNo, TierNo, PositionNo, QRCode)
SELECT
    g.LocationCode,
    CONVERT(nvarchar(50),
        N'Cầu ' + g.CraneCode
        + N' - Kệ ' + CONVERT(nvarchar(1), g.RackNo)
        + N' - Tầng ' + CONVERT(nvarchar(1), g.TierNo)
        + N' - Vị trí ' + RIGHT(N'0' + CONVERT(nvarchar(2), g.PositionNo), 2)
    ),
    g.CraneCode,
    g.RackNo,
    g.TierNo,
    g.PositionNo,
    g.LocationCode
FROM Generated g;

IF (SELECT COUNT(*) FROM @Locations) <> @ExpectedLocationCount
    THROW 51202, N'Tập vị trí Z76 sinh ra không đủ 1.976 dòng.', 1;

IF EXISTS
(
    SELECT CraneCode
    FROM @Locations
    GROUP BY CraneCode
    HAVING COUNT(*) <> CASE WHEN CraneCode IN (N'A', N'D') THEN 456 ELSE 532 END
)
    THROW 51203, N'Số lượng vị trí theo cầu trục không đúng thiết kế.', 1;

IF EXISTS
(
    SELECT 1
    FROM @Locations
    WHERE (CraneCode IN (N'A', N'D') AND TierNo = 7)
       OR RackNo NOT BETWEEN 1 AND 4
       OR PositionNo NOT BETWEEN 1 AND 19
)
    THROW 51204, N'Tập vị trí Z76 chứa tổ hợp ngoài thiết kế.', 1;

BEGIN TRY
    BEGIN TRANSACTION;

    IF NOT EXISTS
    (
        SELECT 1
        FROM dbo.DM_Kho WITH (UPDLOCK, HOLDLOCK)
        WHERE ID_Kho = 5 AND TonTai = 1 AND SuDung = 1
    )
        THROW 51205, N'Không tìm thấy kho hoạt động ID 5.', 1;

    -- The table has no unique key for warehouse/location code. Refuse ambiguous
    -- pre-existing rows instead of silently choosing one of them.
    IF EXISTS
    (
        SELECT v.MaViTriKho
        FROM dbo.DM_Kho_ViTri v WITH (UPDLOCK, HOLDLOCK)
        JOIN @Locations l ON l.MaViTriKho = v.MaViTriKho
        WHERE v.ID_Kho = 5
        GROUP BY v.MaViTriKho
        HAVING COUNT(*) > 1
    )
        THROW 51206, N'Kho ID 5 đã có nhiều dòng trùng mã vị trí Z76.', 1;

    IF EXISTS
    (
        SELECT v.QRCode
        FROM dbo.DM_Kho_ViTri v WITH (UPDLOCK, HOLDLOCK)
        JOIN @Locations l ON l.QRCode = v.QRCode
        GROUP BY v.QRCode
        HAVING COUNT(*) > 1
    )
        THROW 51207, N'Danh mục đã có nhiều dòng trùng QR vị trí Z76.', 1;

    -- An existing code is accepted only when every imported field matches.
    IF EXISTS
    (
        SELECT 1
        FROM dbo.DM_Kho_ViTri v WITH (UPDLOCK, HOLDLOCK)
        JOIN @Locations l ON l.MaViTriKho = v.MaViTriKho
        WHERE v.ID_Kho = 5
          AND
          (
              ISNULL(v.QRCode, N'') <> l.QRCode
              OR v.TenViTriKho <> l.TenViTriKho
              OR ISNULL(v.MaVung, N'') <> N'A'
              OR ISNULL(v.TenVung, N'') <> N'Khu A'
              OR ISNULL(v.MaNha, N'') <> N'Z76'
              OR ISNULL(v.TenNha, N'') <> N'Kho cầu trục Z76'
              OR ISNULL(v.MaKhuVuc, N'') <> N'CT'
              OR ISNULL(v.TenKhuVuc, N'') <> N'Cầu trục'
              OR ISNULL(v.MaDay, N'') <> l.CraneCode
              OR ISNULL(v.TenDay, N'') <> N'Cầu trục ' + l.CraneCode
              OR ISNULL(v.MaTang, N'') <> CONVERT(nvarchar(10), l.RackNo)
              OR ISNULL(v.TenTang, N'') <> N'Kệ ' + CONVERT(nvarchar(10), l.RackNo)
              OR ISNULL(v.MaKe, N'') <> CONVERT(nvarchar(10), l.TierNo)
              OR ISNULL(v.TenKe, N'') <> N'Tầng ' + CONVERT(nvarchar(10), l.TierNo)
              OR v.MaxCBM IS NOT NULL
              OR CONVERT(int, v.STT_ViTriKho) <> CONVERT(int, l.PositionNo)
              OR v.SuDung <> 1
              OR v.TonTai <> 1
          )
    )
        THROW 51208, N'Mã vị trí Z76 đã tồn tại nhưng khác dữ liệu chuẩn.', 1;

    -- QR lookup is global, so a QR may not be owned by another warehouse/code.
    IF EXISTS
    (
        SELECT 1
        FROM dbo.DM_Kho_ViTri v WITH (UPDLOCK, HOLDLOCK)
        JOIN @Locations l ON l.QRCode = v.QRCode
        WHERE v.ID_Kho <> 5 OR v.MaViTriKho <> l.MaViTriKho
    )
        THROW 51209, N'QR vị trí Z76 đã được sử dụng bởi vị trí khác.', 1;

    DECLARE @Inserted TABLE
    (
        ID_ViTriKho int NOT NULL PRIMARY KEY,
        MaViTriKho nvarchar(25) NOT NULL,
        QRCode nvarchar(50) NOT NULL
    );

    INSERT dbo.DM_Kho_ViTri
    (
        ID_Kho, MaViTriKho, TenViTriKho,
        TenNha, MaNha, TenKhuVuc, MaKhuVuc,
        TenDay, MaDay, TenTang, MaTang, TenKe, MaKe,
        MaxCBM, QRCode, STT_ViTriKho, SuDung, TonTai,
        MaVung, TenVung
    )
    OUTPUT inserted.ID_ViTriKho, inserted.MaViTriKho, inserted.QRCode
        INTO @Inserted (ID_ViTriKho, MaViTriKho, QRCode)
    SELECT
        5,
        l.MaViTriKho,
        l.TenViTriKho,
        N'Kho cầu trục Z76',
        N'Z76',
        N'Cầu trục',
        N'CT',
        N'Cầu trục ' + l.CraneCode,
        l.CraneCode,
        N'Kệ ' + CONVERT(nvarchar(10), l.RackNo),
        CONVERT(nvarchar(10), l.RackNo),
        N'Tầng ' + CONVERT(nvarchar(10), l.TierNo),
        CONVERT(nvarchar(10), l.TierNo),
        NULL,
        l.QRCode,
        CONVERT(smallint, l.PositionNo),
        1,
        1,
        N'A',
        N'Khu A'
    FROM @Locations l
    WHERE NOT EXISTS
    (
        SELECT 1
        FROM dbo.DM_Kho_ViTri v WITH (UPDLOCK, HOLDLOCK)
        WHERE v.ID_Kho = 5 AND v.MaViTriKho = l.MaViTriKho
    );

    IF
    (
        SELECT COUNT(*)
        FROM dbo.DM_Kho_ViTri v
        JOIN @Locations l ON l.MaViTriKho = v.MaViTriKho
        WHERE v.ID_Kho = 5
    ) <> @ExpectedLocationCount
        THROW 51210, N'Đối soát sau import không đủ 1.976 vị trí Z76.', 1;

    IF EXISTS
    (
        SELECT l.CraneCode
        FROM @Locations l
        JOIN dbo.DM_Kho_ViTri v
          ON v.ID_Kho = 5 AND v.MaViTriKho = l.MaViTriKho
        GROUP BY l.CraneCode
        HAVING COUNT(*) <> CASE WHEN l.CraneCode IN (N'A', N'D') THEN 456 ELSE 532 END
    )
        THROW 51211, N'Đối soát sau import sai số lượng theo cầu trục.', 1;

    COMMIT TRANSACTION;

    SELECT
        @ExpectedLocationCount AS ExpectedCount,
        (SELECT COUNT(*) FROM @Inserted) AS InsertedCount,
        @ExpectedLocationCount - (SELECT COUNT(*) FROM @Inserted) AS ExistingMatchingCount;

    SELECT ID_ViTriKho, MaViTriKho, QRCode
    FROM @Inserted
    ORDER BY MaViTriKho;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;
