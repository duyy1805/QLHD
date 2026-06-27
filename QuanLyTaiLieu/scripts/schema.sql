IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'doc')
    EXEC(N'CREATE SCHEMA doc');

IF OBJECT_ID(N'doc.DocumentTypes', N'U') IS NULL
BEGIN
    CREATE TABLE doc.DocumentTypes (
        Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_doc_DocumentTypes PRIMARY KEY,
        Code NVARCHAR(50) NOT NULL CONSTRAINT UQ_doc_DocumentTypes_Code UNIQUE,
        Name NVARCHAR(250) NOT NULL,
        ModuleKind NVARCHAR(50) NOT NULL,
        Description NVARCHAR(1000) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_doc_DocumentTypes_IsActive DEFAULT (1),
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_doc_DocumentTypes_CreatedAt DEFAULT (SYSDATETIME()),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_doc_DocumentTypes_UpdatedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT CK_doc_DocumentTypes_ModuleKind CHECK (ModuleKind IN (N'VERSIONED_DOCUMENT', N'ASSIGNMENT_DOCUMENT'))
    );
END;

IF OBJECT_ID(N'doc.Documents', N'U') IS NULL
BEGIN
    CREATE TABLE doc.Documents (
        Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_doc_Documents PRIMARY KEY,
        DocumentTypeId INT NOT NULL,
        Title NVARCHAR(300) NOT NULL,
        DocumentNo NVARCHAR(100) NULL,
        Description NVARCHAR(MAX) NULL,
        Status NVARCHAR(30) NOT NULL CONSTRAINT DF_doc_Documents_Status DEFAULT (N'ACTIVE'),
        CreatedByUserId INT NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_doc_Documents_CreatedAt DEFAULT (SYSDATETIME()),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_doc_Documents_UpdatedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT FK_doc_Documents_DocumentTypes FOREIGN KEY (DocumentTypeId) REFERENCES doc.DocumentTypes(Id),
        CONSTRAINT CK_doc_Documents_Status CHECK (Status IN (N'DRAFT', N'ACTIVE', N'ARCHIVED', N'CANCELLED'))
    );
    CREATE INDEX IX_doc_Documents_Type ON doc.Documents(DocumentTypeId);
    CREATE INDEX IX_doc_Documents_CreatedBy ON doc.Documents(CreatedByUserId);
    CREATE INDEX IX_doc_Documents_Status ON doc.Documents(Status);
END;

IF OBJECT_ID(N'doc.DocumentVersions', N'U') IS NULL
BEGIN
    CREATE TABLE doc.DocumentVersions (
        Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_doc_DocumentVersions PRIMARY KEY,
        DocumentId INT NOT NULL,
        VersionNo NVARCHAR(50) NOT NULL,
        FileName NVARCHAR(260) NOT NULL,
        FileUrl NVARCHAR(1000) NOT NULL,
        FilePath NVARCHAR(1000) NOT NULL,
        FileSize INT NULL,
        FileType NVARCHAR(120) NULL,
        ChangeNote NVARCHAR(1000) NULL,
        IsCurrent BIT NOT NULL CONSTRAINT DF_doc_DocumentVersions_IsCurrent DEFAULT (0),
        UploadedByUserId INT NOT NULL,
        UploadedAt DATETIME2 NOT NULL CONSTRAINT DF_doc_DocumentVersions_UploadedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT FK_doc_DocumentVersions_Documents FOREIGN KEY (DocumentId) REFERENCES doc.Documents(Id)
    );
    CREATE INDEX IX_doc_DocumentVersions_Document ON doc.DocumentVersions(DocumentId);
    CREATE INDEX IX_doc_DocumentVersions_Current ON doc.DocumentVersions(DocumentId, IsCurrent);
END;

IF OBJECT_ID(N'doc.DocumentAssignments', N'U') IS NULL
BEGIN
    CREATE TABLE doc.DocumentAssignments (
        Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_doc_DocumentAssignments PRIMARY KEY,
        DocumentId INT NOT NULL,
        AssignedToUserId INT NULL,
        AssignedByUserId INT NOT NULL,
        RequiredRoleCode NVARCHAR(50) NULL,
        DueDate DATETIME2 NULL,
        Status NVARCHAR(30) NOT NULL CONSTRAINT DF_doc_DocumentAssignments_Status DEFAULT (N'PENDING'),
        CompletedByUserId INT NULL,
        CompletedAt DATETIME2 NULL,
        CompletionNote NVARCHAR(1000) NULL,
        AssignedAt DATETIME2 NOT NULL CONSTRAINT DF_doc_DocumentAssignments_AssignedAt DEFAULT (SYSDATETIME()),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_doc_DocumentAssignments_UpdatedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT FK_doc_DocumentAssignments_Documents FOREIGN KEY (DocumentId) REFERENCES doc.Documents(Id),
        CONSTRAINT CK_doc_DocumentAssignments_Status CHECK (Status IN (N'PENDING', N'IN_PROGRESS', N'COMPLETED', N'OVERDUE', N'CANCELLED')),
        CONSTRAINT CK_doc_DocumentAssignments_Target CHECK (AssignedToUserId IS NOT NULL OR RequiredRoleCode IS NOT NULL)
    );
    CREATE INDEX IX_doc_DocumentAssignments_Document ON doc.DocumentAssignments(DocumentId);
    CREATE INDEX IX_doc_DocumentAssignments_AssignedTo ON doc.DocumentAssignments(AssignedToUserId);
    CREATE INDEX IX_doc_DocumentAssignments_Status ON doc.DocumentAssignments(Status);
    CREATE INDEX IX_doc_DocumentAssignments_DueDate ON doc.DocumentAssignments(DueDate);
END;

IF OBJECT_ID(N'doc.DocumentLogs', N'U') IS NULL
BEGIN
    CREATE TABLE doc.DocumentLogs (
        Id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_doc_DocumentLogs PRIMARY KEY,
        DocumentId INT NOT NULL,
        Action NVARCHAR(80) NOT NULL,
        OldValue NVARCHAR(MAX) NULL,
        NewValue NVARCHAR(MAX) NULL,
        CreatedByUserId INT NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_doc_DocumentLogs_CreatedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT FK_doc_DocumentLogs_Documents FOREIGN KEY (DocumentId) REFERENCES doc.Documents(Id)
    );
    CREATE INDEX IX_doc_DocumentLogs_Document ON doc.DocumentLogs(DocumentId);
    CREATE INDEX IX_doc_DocumentLogs_CreatedBy ON doc.DocumentLogs(CreatedByUserId);
END;

MERGE doc.DocumentTypes AS target
USING (VALUES
    (N'QUY_TRINH', N'Quy trình', N'VERSIONED_DOCUMENT', N'Tài liệu có quản lý phiên bản'),
    (N'THONG_BAO', N'Thông báo', N'ASSIGNMENT_DOCUMENT', N'Tài liệu giao/xác nhận xử lý')
) AS source(Code, Name, ModuleKind, Description)
ON target.Code = source.Code
WHEN MATCHED THEN UPDATE SET Name = source.Name, ModuleKind = source.ModuleKind, Description = source.Description, IsActive = 1, UpdatedAt = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (Code, Name, ModuleKind, Description, IsActive)
VALUES (source.Code, source.Name, source.ModuleKind, source.Description, 1);

IF OBJECT_ID(N'Tag_System.dbo.PQ_DM_ChucNang', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'Tag_System.dbo.PQ_DM_ChucNang', N'Ma_ChucNang') IS NOT NULL
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM Tag_System.dbo.PQ_DM_ChucNang WHERE Ma_ChucNang = N'DOC_USER')
            INSERT INTO Tag_System.dbo.PQ_DM_ChucNang (Ma_ChucNang, Ten_ChucNang, TonTai) VALUES (N'DOC_USER', N'Quản lý tài liệu - Người dùng', 1);
        IF NOT EXISTS (SELECT 1 FROM Tag_System.dbo.PQ_DM_ChucNang WHERE Ma_ChucNang = N'DOC_TBP')
            INSERT INTO Tag_System.dbo.PQ_DM_ChucNang (Ma_ChucNang, Ten_ChucNang, TonTai) VALUES (N'DOC_TBP', N'Quản lý tài liệu - Trưởng bộ phận', 1);
        IF NOT EXISTS (SELECT 1 FROM Tag_System.dbo.PQ_DM_ChucNang WHERE Ma_ChucNang = N'DOC_ADMIN')
            INSERT INTO Tag_System.dbo.PQ_DM_ChucNang (Ma_ChucNang, Ten_ChucNang, TonTai) VALUES (N'DOC_ADMIN', N'Quản lý tài liệu - Admin', 1);
    END;
END;

GO
CREATE OR ALTER PROCEDURE doc.sp_DocumentType_List
    @ActiveOnly BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Id, Code, Name, ModuleKind, Description, IsActive
    FROM doc.DocumentTypes
    WHERE @ActiveOnly = 0 OR IsActive = 1
    ORDER BY Name;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_DocumentType_GetByCode
    @Code NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 Id, Code, Name, ModuleKind, Description, IsActive
    FROM doc.DocumentTypes
    WHERE Code = UPPER(@Code);
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_DocumentType_Upsert
    @Code NVARCHAR(50),
    @Name NVARCHAR(250),
    @ModuleKind NVARCHAR(50),
    @Description NVARCHAR(1000) = NULL,
    @IsActive BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    MERGE doc.DocumentTypes AS target
    USING (SELECT UPPER(@Code) AS Code) AS source
    ON target.Code = source.Code
    WHEN MATCHED THEN UPDATE SET
        Name = @Name,
        ModuleKind = @ModuleKind,
        Description = @Description,
        IsActive = @IsActive,
        UpdatedAt = SYSDATETIME()
    WHEN NOT MATCHED THEN INSERT (Code, Name, ModuleKind, Description, IsActive)
        VALUES (source.Code, @Name, @ModuleKind, @Description, @IsActive)
    OUTPUT inserted.Id, inserted.Code, inserted.Name, inserted.ModuleKind, inserted.Description, inserted.IsActive;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_DocumentType_SetActive
    @Id INT,
    @IsActive BIT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE doc.DocumentTypes
    SET IsActive = @IsActive, UpdatedAt = SYSDATETIME()
    WHERE Id = @Id;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_User_List
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 500
      id = tk.ID_TaiKhoanDangNhap,
      username = COALESCE(NULLIF(tk.TenDangNhap, N''), CONVERT(NVARCHAR(20), tk.ID_TaiKhoanDangNhap)),
      fullName = COALESCE(NULLIF(tk.TenDayDu, N''), NULLIF(tk.TenDangNhap, N''), CONVERT(NVARCHAR(20), tk.ID_TaiKhoanDangNhap))
    FROM Tag_System.dbo.TaiKhoanDangNhap tk
    WHERE tk.ID_TaiKhoanDangNhap IS NOT NULL
    ORDER BY fullName, id;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Auth_GetDocPermissions
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT MaQuyen = cn.Ma_ChucNang
    FROM Tag_System.dbo.PQ_TaiKhoan_ChucNang AS pq
    JOIN Tag_System.dbo.PQ_DM_ChucNang AS cn
      ON cn.ID_ChucNang = pq.ID_ChucNang
    WHERE pq.ID_TaiKhoanDangNhap = @UserId
      AND pq.CapNhat = 1
      AND cn.TonTai = 1
      AND cn.Ma_ChucNang IN (N'DOC_USER', N'DOC_TBP', N'DOC_ADMIN')
    ORDER BY cn.Ma_ChucNang;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Auth_FindLoginUser
    @Username NVARCHAR(150),
    @UsernameColumn SYSNAME = N'TenDangNhap',
    @PasswordColumn SYSNAME = N'MatKhau'
AS
BEGIN
    SET NOCOUNT ON;
    IF @UsernameColumn IS NULL OR COL_LENGTH(N'Tag_System.dbo.TaiKhoanDangNhap', @UsernameColumn) IS NULL
        SET @UsernameColumn = N'TenDangNhap';
    IF @PasswordColumn IS NULL OR COL_LENGTH(N'Tag_System.dbo.TaiKhoanDangNhap', @PasswordColumn) IS NULL
        SET @PasswordColumn = N'MatKhau';

    DECLARE @Sql NVARCHAR(MAX) = N'
      SELECT TOP 1
        id = ID_TaiKhoanDangNhap,
        username = ' + QUOTENAME(@UsernameColumn) + N',
        fullName = COALESCE(NULLIF(TenDayDu, N''''), NULLIF(' + QUOTENAME(@UsernameColumn) + N', N''''), CONVERT(NVARCHAR(20), ID_TaiKhoanDangNhap)),
        passwordHash = ' + QUOTENAME(@PasswordColumn) + N'
      FROM Tag_System.dbo.TaiKhoanDangNhap
      WHERE ' + QUOTENAME(@UsernameColumn) + N' = @Username
      ORDER BY ID_TaiKhoanDangNhap;';

    EXEC sp_executesql @Sql, N'@Username NVARCHAR(150)', @Username = @Username;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Document_List
    @TypeCode NVARCHAR(50) = NULL,
    @Search NVARCHAR(200) = NULL,
    @Status NVARCHAR(30) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
      d.Id, d.DocumentTypeId, dt.Code AS TypeCode, dt.Name AS TypeName, dt.ModuleKind,
      d.Title, d.DocumentNo, d.Description, d.Status, d.CreatedByUserId, d.CreatedAt,
      CreatedByName = COALESCE(NULLIF(u.TenDayDu, N''), NULLIF(u.TenDangNhap, N''), CONVERT(NVARCHAR(20), d.CreatedByUserId)),
      CurrentVersionNo = cv.VersionNo,
      CurrentFileUrl = cv.FileUrl,
      AssignmentCount = COUNT(a.Id),
      CompletedAssignmentCount = SUM(CASE WHEN a.Status = N'COMPLETED' THEN 1 ELSE 0 END),
      NearestDueDate = MIN(CASE WHEN a.Status <> N'COMPLETED' THEN a.DueDate ELSE NULL END)
    FROM doc.Documents d
    JOIN doc.DocumentTypes dt ON dt.Id = d.DocumentTypeId
    LEFT JOIN Tag_System.dbo.TaiKhoanDangNhap u ON u.ID_TaiKhoanDangNhap = d.CreatedByUserId
    LEFT JOIN doc.DocumentVersions cv ON cv.DocumentId = d.Id AND cv.IsCurrent = 1
    LEFT JOIN doc.DocumentAssignments a ON a.DocumentId = d.Id
    WHERE (@TypeCode IS NULL OR dt.Code = UPPER(@TypeCode))
      AND (@Status IS NULL OR d.Status = @Status)
      AND (@Search IS NULL OR d.Title LIKE N'%' + @Search + N'%' OR d.DocumentNo LIKE N'%' + @Search + N'%')
    GROUP BY d.Id, d.DocumentTypeId, dt.Code, dt.Name, dt.ModuleKind, d.Title, d.DocumentNo, d.Description, d.Status, d.CreatedByUserId, d.CreatedAt, u.TenDayDu, u.TenDangNhap, cv.VersionNo, cv.FileUrl
    ORDER BY d.CreatedAt DESC;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Document_GetHeader
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
      d.Id, d.DocumentTypeId, dt.Code AS TypeCode, dt.Name AS TypeName, dt.ModuleKind,
      d.Title, d.DocumentNo, d.Description, d.Status, d.CreatedByUserId, d.CreatedAt,
      CreatedByName = COALESCE(NULLIF(u.TenDayDu, N''), NULLIF(u.TenDangNhap, N''), CONVERT(NVARCHAR(20), d.CreatedByUserId)),
      CurrentVersionNo = cv.VersionNo,
      CurrentFileUrl = cv.FileUrl,
      AssignmentCount = COUNT(a.Id),
      CompletedAssignmentCount = SUM(CASE WHEN a.Status = N'COMPLETED' THEN 1 ELSE 0 END),
      NearestDueDate = MIN(CASE WHEN a.Status <> N'COMPLETED' THEN a.DueDate ELSE NULL END)
    FROM doc.Documents d
    JOIN doc.DocumentTypes dt ON dt.Id = d.DocumentTypeId
    LEFT JOIN Tag_System.dbo.TaiKhoanDangNhap u ON u.ID_TaiKhoanDangNhap = d.CreatedByUserId
    LEFT JOIN doc.DocumentVersions cv ON cv.DocumentId = d.Id AND cv.IsCurrent = 1
    LEFT JOIN doc.DocumentAssignments a ON a.DocumentId = d.Id
    WHERE d.Id = @Id
    GROUP BY d.Id, d.DocumentTypeId, dt.Code, dt.Name, dt.ModuleKind, d.Title, d.DocumentNo, d.Description, d.Status, d.CreatedByUserId, d.CreatedAt, u.TenDayDu, u.TenDangNhap, cv.VersionNo, cv.FileUrl;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Document_GetVersions
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT v.*, UploadedByName = COALESCE(NULLIF(u.TenDayDu, N''), NULLIF(u.TenDangNhap, N''), CONVERT(NVARCHAR(20), v.UploadedByUserId))
    FROM doc.DocumentVersions v
    LEFT JOIN Tag_System.dbo.TaiKhoanDangNhap u ON u.ID_TaiKhoanDangNhap = v.UploadedByUserId
    WHERE v.DocumentId = @Id
    ORDER BY v.UploadedAt DESC;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Document_GetAssignments
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT a.*,
      AssignedToName = COALESCE(NULLIF(toUser.TenDayDu, N''), NULLIF(toUser.TenDangNhap, N''), NULL),
      AssignedByName = COALESCE(NULLIF(byUser.TenDayDu, N''), NULLIF(byUser.TenDangNhap, N''), CONVERT(NVARCHAR(20), a.AssignedByUserId)),
      CompletedByName = COALESCE(NULLIF(doneUser.TenDayDu, N''), NULLIF(doneUser.TenDangNhap, N''), NULL)
    FROM doc.DocumentAssignments a
    LEFT JOIN Tag_System.dbo.TaiKhoanDangNhap toUser ON toUser.ID_TaiKhoanDangNhap = a.AssignedToUserId
    LEFT JOIN Tag_System.dbo.TaiKhoanDangNhap byUser ON byUser.ID_TaiKhoanDangNhap = a.AssignedByUserId
    LEFT JOIN Tag_System.dbo.TaiKhoanDangNhap doneUser ON doneUser.ID_TaiKhoanDangNhap = a.CompletedByUserId
    WHERE a.DocumentId = @Id
    ORDER BY a.AssignedAt DESC;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Document_GetLogs
    @Id INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT l.*, CreatedByName = COALESCE(NULLIF(u.TenDayDu, N''), NULLIF(u.TenDangNhap, N''), CONVERT(NVARCHAR(20), l.CreatedByUserId))
    FROM doc.DocumentLogs l
    LEFT JOIN Tag_System.dbo.TaiKhoanDangNhap u ON u.ID_TaiKhoanDangNhap = l.CreatedByUserId
    WHERE l.DocumentId = @Id
    ORDER BY l.CreatedAt DESC;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Document_Create
    @DocumentTypeId INT,
    @Title NVARCHAR(300),
    @DocumentNo NVARCHAR(100) = NULL,
    @Description NVARCHAR(MAX) = NULL,
    @VersionNo NVARCHAR(50) = NULL,
    @ChangeNote NVARCHAR(1000) = NULL,
    @AssignedToUserId INT = NULL,
    @DueDate DATETIME2 = NULL,
    @FileName NVARCHAR(260),
    @FileUrl NVARCHAR(1000),
    @FilePath NVARCHAR(1000),
    @FileSize INT = NULL,
    @FileType NVARCHAR(120) = NULL,
    @CreatedByUserId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ModuleKind NVARCHAR(50);
    SELECT @ModuleKind = ModuleKind FROM doc.DocumentTypes WHERE Id = @DocumentTypeId AND IsActive = 1;
    IF @ModuleKind IS NULL THROW 73001, N'Loại tài liệu không tồn tại.', 1;
    IF @ModuleKind = N'VERSIONED_DOCUMENT' AND NULLIF(@VersionNo, N'') IS NULL THROW 73002, N'Phiên bản là bắt buộc.', 1;

    BEGIN TRANSACTION;
    INSERT INTO doc.Documents (DocumentTypeId, Title, DocumentNo, Description, Status, CreatedByUserId)
    VALUES (@DocumentTypeId, @Title, @DocumentNo, @Description, N'ACTIVE', @CreatedByUserId);

    DECLARE @DocumentId INT = SCOPE_IDENTITY();

    INSERT INTO doc.DocumentVersions (DocumentId, VersionNo, FileName, FileUrl, FilePath, FileSize, FileType, ChangeNote, IsCurrent, UploadedByUserId)
    VALUES (@DocumentId, ISNULL(NULLIF(@VersionNo, N''), N'v1'), @FileName, @FileUrl, @FilePath, @FileSize, @FileType, @ChangeNote, 1, @CreatedByUserId);

    IF @ModuleKind = N'ASSIGNMENT_DOCUMENT'
    BEGIN
        INSERT INTO doc.DocumentAssignments (DocumentId, AssignedToUserId, RequiredRoleCode, AssignedByUserId, DueDate)
        VALUES (@DocumentId, @AssignedToUserId, CASE WHEN @AssignedToUserId IS NULL THEN N'DOC_TBP' ELSE NULL END, @CreatedByUserId, @DueDate);
    END;

    INSERT INTO doc.DocumentLogs (DocumentId, Action, NewValue, CreatedByUserId)
    VALUES (@DocumentId, N'CREATE_DOCUMENT', JSON_QUERY((SELECT @Title AS title, @DocumentNo AS documentNo, @VersionNo AS versionNo, @AssignedToUserId AS assignedToUserId FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)), @CreatedByUserId);

    COMMIT TRANSACTION;
    SELECT Id = @DocumentId;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Document_UploadVersion
    @DocumentId INT,
    @VersionNo NVARCHAR(50),
    @ChangeNote NVARCHAR(1000) = NULL,
    @FileName NVARCHAR(260),
    @FileUrl NVARCHAR(1000),
    @FilePath NVARCHAR(1000),
    @FileSize INT = NULL,
    @FileType NVARCHAR(120) = NULL,
    @UploadedByUserId INT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    UPDATE doc.DocumentVersions SET IsCurrent = 0 WHERE DocumentId = @DocumentId;
    INSERT INTO doc.DocumentVersions (DocumentId, VersionNo, FileName, FileUrl, FilePath, FileSize, FileType, ChangeNote, IsCurrent, UploadedByUserId)
    VALUES (@DocumentId, @VersionNo, @FileName, @FileUrl, @FilePath, @FileSize, @FileType, @ChangeNote, 1, @UploadedByUserId);
    INSERT INTO doc.DocumentLogs (DocumentId, Action, NewValue, CreatedByUserId)
    VALUES (@DocumentId, N'UPLOAD_VERSION', JSON_QUERY((SELECT @VersionNo AS versionNo, @FileName AS fileName FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)), @UploadedByUserId);
    COMMIT TRANSACTION;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Document_Update
    @Id INT,
    @Title NVARCHAR(300),
    @DocumentNo NVARCHAR(100) = NULL,
    @Description NVARCHAR(MAX) = NULL,
    @Status NVARCHAR(30) = N'ACTIVE',
    @UpdatedByUserId INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE doc.Documents
    SET Title = @Title, DocumentNo = @DocumentNo, Description = @Description, Status = @Status, UpdatedAt = SYSDATETIME()
    WHERE Id = @Id;
    INSERT INTO doc.DocumentLogs (DocumentId, Action, NewValue, CreatedByUserId)
    VALUES (@Id, N'UPDATE_DOCUMENT', JSON_QUERY((SELECT @Title AS title, @DocumentNo AS documentNo, @Status AS status FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)), @UpdatedByUserId);
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Dashboard_Stats
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
      totalDocuments = (SELECT COUNT(*) FROM doc.Documents WHERE Status <> N'ARCHIVED'),
      versionedDocuments = (SELECT COUNT(*) FROM doc.Documents d JOIN doc.DocumentTypes dt ON dt.Id = d.DocumentTypeId WHERE dt.ModuleKind = N'VERSIONED_DOCUMENT' AND d.Status <> N'ARCHIVED'),
      openAssignments = (SELECT COUNT(*) FROM doc.DocumentAssignments WHERE Status <> N'COMPLETED'),
      myAssignments = (SELECT COUNT(*) FROM doc.DocumentAssignments WHERE AssignedToUserId = @UserId AND Status <> N'COMPLETED'),
      overdueAssignments = (SELECT COUNT(*) FROM doc.DocumentAssignments WHERE DueDate < SYSDATETIME() AND Status <> N'COMPLETED');
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Assignment_List
    @UserId INT,
    @MineOnly BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT a.*, DocumentTitle = d.Title,
      AssignedToName = COALESCE(NULLIF(toUser.TenDayDu, N''), NULLIF(toUser.TenDangNhap, N''), NULL),
      AssignedByName = COALESCE(NULLIF(byUser.TenDayDu, N''), NULLIF(byUser.TenDangNhap, N''), CONVERT(NVARCHAR(20), a.AssignedByUserId)),
      CompletedByName = COALESCE(NULLIF(doneUser.TenDayDu, N''), NULLIF(doneUser.TenDangNhap, N''), NULL)
    FROM doc.DocumentAssignments a
    JOIN doc.Documents d ON d.Id = a.DocumentId
    LEFT JOIN Tag_System.dbo.TaiKhoanDangNhap toUser ON toUser.ID_TaiKhoanDangNhap = a.AssignedToUserId
    LEFT JOIN Tag_System.dbo.TaiKhoanDangNhap byUser ON byUser.ID_TaiKhoanDangNhap = a.AssignedByUserId
    LEFT JOIN Tag_System.dbo.TaiKhoanDangNhap doneUser ON doneUser.ID_TaiKhoanDangNhap = a.CompletedByUserId
    WHERE @MineOnly = 0
      OR a.AssignedToUserId = @UserId
      OR EXISTS (
          SELECT 1
          FROM Tag_System.dbo.PQ_TaiKhoan_ChucNang pq
          JOIN Tag_System.dbo.PQ_DM_ChucNang cn ON cn.ID_ChucNang = pq.ID_ChucNang
          WHERE pq.ID_TaiKhoanDangNhap = @UserId
            AND pq.CapNhat = 1
            AND cn.TonTai = 1
            AND cn.Ma_ChucNang = a.RequiredRoleCode
      )
    ORDER BY CASE WHEN a.Status = N'COMPLETED' THEN 1 ELSE 0 END, a.DueDate, a.AssignedAt DESC;
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Assignment_Create
    @DocumentId INT,
    @AssignedToUserId INT = NULL,
    @DueDate DATETIME2 = NULL,
    @AssignedByUserId INT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO doc.DocumentAssignments (DocumentId, AssignedToUserId, RequiredRoleCode, AssignedByUserId, DueDate)
    VALUES (@DocumentId, @AssignedToUserId, CASE WHEN @AssignedToUserId IS NULL THEN N'DOC_TBP' ELSE NULL END, @AssignedByUserId, @DueDate);
    INSERT INTO doc.DocumentLogs (DocumentId, Action, NewValue, CreatedByUserId)
    VALUES (@DocumentId, N'ASSIGN_USER', JSON_QUERY((SELECT @AssignedToUserId AS assignedToUserId, CASE WHEN @AssignedToUserId IS NULL THEN N'DOC_TBP' ELSE NULL END AS requiredRoleCode FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)), @AssignedByUserId);
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Assignment_Complete
    @Id INT,
    @CompletionNote NVARCHAR(1000) = NULL,
    @CompletedByUserId INT,
    @IsAdmin BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @DocumentId INT, @AssignedToUserId INT, @RequiredRoleCode NVARCHAR(50), @Status NVARCHAR(30);
    SELECT @DocumentId = DocumentId, @AssignedToUserId = AssignedToUserId, @RequiredRoleCode = RequiredRoleCode, @Status = Status
    FROM doc.DocumentAssignments
    WHERE Id = @Id;

    IF @DocumentId IS NULL THROW 73101, N'Không tìm thấy việc cần xác nhận.', 1;
    IF @Status = N'COMPLETED' THROW 73102, N'Việc này đã hoàn thành.', 1;
    IF NOT (
        @IsAdmin = 1
        OR @AssignedToUserId = @CompletedByUserId
        OR (@AssignedToUserId IS NULL AND EXISTS (
            SELECT 1
            FROM Tag_System.dbo.PQ_TaiKhoan_ChucNang pq
            JOIN Tag_System.dbo.PQ_DM_ChucNang cn ON cn.ID_ChucNang = pq.ID_ChucNang
            WHERE pq.ID_TaiKhoanDangNhap = @CompletedByUserId
              AND pq.CapNhat = 1
              AND cn.TonTai = 1
              AND cn.Ma_ChucNang = @RequiredRoleCode
        ))
    ) THROW 73103, N'Bạn không có quyền xác nhận việc này.', 1;

    UPDATE doc.DocumentAssignments
    SET Status = N'COMPLETED', CompletedAt = SYSDATETIME(), CompletedByUserId = @CompletedByUserId, CompletionNote = @CompletionNote, UpdatedAt = SYSDATETIME()
    WHERE Id = @Id;
    INSERT INTO doc.DocumentLogs (DocumentId, Action, NewValue, CreatedByUserId)
    VALUES (@DocumentId, N'COMPLETE_ASSIGNMENT', @CompletionNote, @CompletedByUserId);
END;
GO
CREATE OR ALTER PROCEDURE doc.sp_Log_Create
    @DocumentId INT,
    @Action NVARCHAR(80),
    @OldValue NVARCHAR(MAX) = NULL,
    @NewValue NVARCHAR(MAX) = NULL,
    @CreatedByUserId INT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO doc.DocumentLogs (DocumentId, Action, OldValue, NewValue, CreatedByUserId)
    VALUES (@DocumentId, @Action, @OldValue, @NewValue, @CreatedByUserId);
END;
GO
