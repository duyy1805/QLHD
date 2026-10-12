/*
    BTP rental-warehouse transfers (warehouse 35 <-> factory warehouse 5).
    Rerunnable. Deploy before the API version that calls
    dbo.KhoTM_BTP_TaoKienNhapChuyenKhoThue.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() IS NULL OR OBJECT_ID(N'dbo.TheKhoKienBTP', N'U') IS NULL
    THROW 51100, N'Database không có cấu trúc kho BTP.', 1;

BEGIN TRY
    BEGIN TRANSACTION;

    IF NOT EXISTS (SELECT 1 FROM dbo.DM_Kho WHERE ID_Kho = 35 AND TonTai = 1)
        THROW 51101, N'Không tìm thấy kho thuê ID 35.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.DM_Kho WHERE ID_Kho = 5 AND TonTai = 1)
        THROW 51102, N'Không tìm thấy kho nhà máy ID 5.', 1;

    DECLARE @NextLocationOrder int = ISNULL((SELECT MAX(CONVERT(int, STT_ViTriKho)) FROM dbo.DM_Kho_ViTri), 0);

    IF NOT EXISTS (SELECT 1 FROM dbo.DM_Kho_ViTri WHERE ID_Kho = 35 AND MaViTriKho = N'KT-NEN-01')
    BEGIN
        SET @NextLocationOrder += 1;
        INSERT dbo.DM_Kho_ViTri
            (ID_Kho, MaViTriKho, TenViTriKho, TenKhuVuc, MaKhuVuc, QRCode,
             STT_ViTriKho, SuDung, TonTai)
        VALUES
            (35, N'KT-NEN-01', N'Khu vực nền kho thuê', N'Khu vực nền kho thuê', N'KTN',
             N'KT-NEN-01', @NextLocationOrder, 1, 1);
    END
    ELSE
        UPDATE dbo.DM_Kho_ViTri
        SET TenViTriKho = N'Khu vực nền kho thuê', TenKhuVuc = N'Khu vực nền kho thuê',
            MaKhuVuc = N'KTN', QRCode = N'KT-NEN-01', SuDung = 1, TonTai = 1
        WHERE ID_Kho = 35 AND MaViTriKho = N'KT-NEN-01';

    IF NOT EXISTS (SELECT 1 FROM dbo.DM_Kho_ViTri WHERE ID_Kho = 5 AND MaViTriKho = N'KT-CNK-01')
    BEGIN
        SET @NextLocationOrder += 1;
        INSERT dbo.DM_Kho_ViTri
            (ID_Kho, MaViTriKho, TenViTriKho, TenKhuVuc, MaKhuVuc, QRCode,
             STT_ViTriKho, SuDung, TonTai)
        VALUES
            (5, N'KT-CNK-01', N'Chờ nhập từ kho thuê', N'Chờ nhập từ kho thuê', N'CNKT',
             N'KT-CNK-01', @NextLocationOrder, 1, 1);
    END
    ELSE
        UPDATE dbo.DM_Kho_ViTri
        SET TenViTriKho = N'Chờ nhập từ kho thuê', TenKhuVuc = N'Chờ nhập từ kho thuê',
            MaKhuVuc = N'CNKT', QRCode = N'KT-CNK-01', SuDung = 1, TonTai = 1
        WHERE ID_Kho = 5 AND MaViTriKho = N'KT-CNK-01';

    IF COL_LENGTH(N'dbo.TheKhoKienBTP_LichSuViTri', N'ID_TheKhoKienBTP_Nguon') IS NULL
        ALTER TABLE dbo.TheKhoKienBTP_LichSuViTri ADD ID_TheKhoKienBTP_Nguon int NULL;
    IF COL_LENGTH(N'dbo.TheKhoKienBTP_LichSuViTri', N'ID_PhieuXuatBTP') IS NULL
        ALTER TABLE dbo.TheKhoKienBTP_LichSuViTri ADD ID_PhieuXuatBTP int NULL;

    DECLARE @HistoryCheck sysname = (
        SELECT TOP (1) cc.name
        FROM sys.check_constraints cc
        WHERE cc.parent_object_id = OBJECT_ID(N'dbo.TheKhoKienBTP_LichSuViTri')
          AND cc.definition LIKE N'%LoaiThaoTac%'
    );
    IF @HistoryCheck IS NOT NULL
    BEGIN
        DECLARE @DropHistoryCheck nvarchar(max) =
            N'ALTER TABLE dbo.TheKhoKienBTP_LichSuViTri DROP CONSTRAINT ' + QUOTENAME(@HistoryCheck);
        EXEC sys.sp_executesql @DropHistoryCheck;
    END;
    ALTER TABLE dbo.TheKhoKienBTP_LichSuViTri WITH CHECK
        ADD CONSTRAINT CK_BTP_LichSuViTri_LoaiThaoTac
        CHECK (LoaiThaoTac IN ('GAN_VI_TRI_NHAP', 'DIEU_CHUYEN', 'CHUYEN_KHO_THUE'));

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.TheKhoKienBTP')
          AND name = N'UX_BTP_KienNhap_ChuyenKho_Nguon'
    )
        CREATE UNIQUE INDEX UX_BTP_KienNhap_ChuyenKho_Nguon
            ON dbo.TheKhoKienBTP(ID_PhieuNhapBTP, ID_TheKhoKienBTP_Xuat, ID_PhieuXuatBTP)
            WHERE TonTai = 1 AND ID_TheKhoKienBTP_Xuat IS NOT NULL AND ID_PhieuXuatBTP IS NOT NULL;

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.TheKhoKienBTP')
          AND name = N'IX_BTP_Kien_DongChuyenKho'
    )
        CREATE INDEX IX_BTP_Kien_DongChuyenKho
            ON dbo.TheKhoKienBTP(ID_TheKhoKienBTP_Xuat, ID_TheKhoKienBTP)
            INCLUDE (QRCode, ID_PhieuNhapBTP, ID_ViTriKho, TonTai);

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO

CREATE OR ALTER PROCEDURE dbo.KhoTM_BTP_TaoKienNhapChuyenKhoThue
    @ID_PhieuXuatBTP int,
    @ID_TaiKhoan int = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @OwnTransaction bit = CASE WHEN @@TRANCOUNT = 0 THEN 1 ELSE 0 END;
    BEGIN TRY
        IF @OwnTransaction = 1 BEGIN TRANSACTION;
        ELSE SAVE TRANSACTION RentalWarehouseTransfer;

        DECLARE @KhoXuat int, @KhoNhap int, @ID_PhieuNhapBTP int,
                @ID_ViTriKho int, @MaViTriKho nvarchar(25), @SoPhieuXuat nvarchar(50);

        SELECT @KhoXuat = ID_KhoXuat, @KhoNhap = ID_KhoNhap, @SoPhieuXuat = So_PhieuXuatBTP
        FROM dbo.PhieuXuatBTP WITH (UPDLOCK, HOLDLOCK)
        WHERE ID_PhieuXuatBTP = @ID_PhieuXuatBTP AND TonTai = 1;

        IF @KhoXuat IS NULL THROW 51103, N'Không tìm thấy phiếu xuất chuyển kho.', 1;
        IF NOT (@KhoNhap = 35 AND @KhoXuat <> 35 OR @KhoXuat = 35 AND @KhoNhap = 5)
            THROW 51104, N'Phiếu không thuộc luồng chuyển kho thuê được hỗ trợ.', 1;

        IF (SELECT COUNT(*) FROM dbo.PhieuNhapBTP WITH (UPDLOCK, HOLDLOCK)
            WHERE ID_PhieuXuatBTP = @ID_PhieuXuatBTP AND TonTai = 1
              AND ID_KhoXuat = @KhoXuat AND ID_KhoNhap = @KhoNhap) <> 1
            THROW 51105, N'Phải có đúng một phiếu nhập đối ứng của phiếu xuất.', 1;

        SELECT @ID_PhieuNhapBTP = ID_PhieuNhapBTP
        FROM dbo.PhieuNhapBTP WITH (UPDLOCK, HOLDLOCK)
        WHERE ID_PhieuXuatBTP = @ID_PhieuXuatBTP AND TonTai = 1
          AND ID_KhoXuat = @KhoXuat AND ID_KhoNhap = @KhoNhap;

        IF EXISTS (SELECT 1 FROM dbo.PhieuNhapBTP WHERE ID_PhieuNhapBTP = @ID_PhieuNhapBTP AND ISNULL(QrStatus, 0) = 1)
            THROW 51106, N'Phiếu nhập đối ứng đã xác nhận.', 1;

        SET @MaViTriKho = CASE WHEN @KhoNhap = 35 THEN N'KT-NEN-01' ELSE N'KT-CNK-01' END;
        SELECT @ID_ViTriKho = ID_ViTriKho
        FROM dbo.DM_Kho_ViTri WITH (UPDLOCK, HOLDLOCK)
        WHERE ID_Kho = @KhoNhap AND MaViTriKho = @MaViTriKho AND TonTai = 1 AND SuDung = 1;
        IF @ID_ViTriKho IS NULL THROW 51107, N'Chưa cấu hình vị trí mặc định của luồng kho thuê.', 1;

        DECLARE @Selected TABLE (ID_TheKhoKienBTP int PRIMARY KEY);
        INSERT @Selected(ID_TheKhoKienBTP)
        SELECT DISTINCT d.ID_TheKhoKienBTP
        FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien x WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.TheKhoKienBTP_ChiTiet d WITH (UPDLOCK, HOLDLOCK)
          ON d.ID_TheKhoKienBTP_ChiTiet = x.ID_TheKhoKienBTP_ChiTiet
        WHERE x.ID_PhieuXuatBTP = @ID_PhieuXuatBTP AND x.SoLuong_XuatKho > 0;
        IF NOT EXISTS (SELECT 1 FROM @Selected) THROW 51108, N'Phiếu xuất chưa có kiện.', 1;

        IF EXISTS (
            SELECT 1
            FROM @Selected s
            JOIN dbo.TheKhoKienBTP k WITH (UPDLOCK, HOLDLOCK) ON k.ID_TheKhoKienBTP = s.ID_TheKhoKienBTP
            LEFT JOIN dbo.DM_Kho_ViTri vt ON vt.ID_ViTriKho = k.ID_ViTriKho
            WHERE ISNULL(k.TonTai, 1) <> 1 OR vt.ID_Kho <> @KhoXuat OR NULLIF(LTRIM(RTRIM(k.QRCode)), N'') IS NULL
        ) THROW 51109, N'Kiện không còn hiệu lực, thiếu QR hoặc không thuộc kho xuất.', 1;

        ;WITH PriorExport AS (
            SELECT x.ID_TheKhoKienBTP_ChiTiet, SUM(x.SoLuong_XuatKho) AS SoLuong
            FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien x
            JOIN dbo.PhieuXuatBTP p ON p.ID_PhieuXuatBTP = x.ID_PhieuXuatBTP AND p.TonTai = 1
            WHERE x.ID_PhieuXuatBTP <> @ID_PhieuXuatBTP
            GROUP BY x.ID_TheKhoKienBTP_ChiTiet
        ), CurrentExport AS (
            SELECT ID_TheKhoKienBTP_ChiTiet, SUM(SoLuong_XuatKho) AS SoLuong
            FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien
            WHERE ID_PhieuXuatBTP = @ID_PhieuXuatBTP
            GROUP BY ID_TheKhoKienBTP_ChiTiet
        )
        SELECT d.ID_TheKhoKienBTP_ChiTiet
        INTO #InvalidPartialPackage
        FROM dbo.TheKhoKienBTP_ChiTiet d WITH (UPDLOCK, HOLDLOCK)
        JOIN @Selected s ON s.ID_TheKhoKienBTP = d.ID_TheKhoKienBTP
        LEFT JOIN PriorExport pe ON pe.ID_TheKhoKienBTP_ChiTiet = d.ID_TheKhoKienBTP_ChiTiet
        LEFT JOIN CurrentExport ce ON ce.ID_TheKhoKienBTP_ChiTiet = d.ID_TheKhoKienBTP_ChiTiet
        WHERE ISNULL(d.TonTai, 1) = 1
          AND (d.SoLuong - ISNULL(pe.SoLuong, 0) <= 0
               OR ABS(ISNULL(ce.SoLuong, 0) - (d.SoLuong - ISNULL(pe.SoLuong, 0))) > 0.000001);
        IF EXISTS (SELECT 1 FROM #InvalidPartialPackage)
            THROW 51110, N'Chuyển kho thuê chỉ cho phép xuất nguyên kiện; hãy tách kiện trước.', 1;

        IF EXISTS (
            SELECT 1 FROM dbo.TheKhoKienBTP WITH (UPDLOCK, HOLDLOCK)
            WHERE ID_PhieuNhapBTP = @ID_PhieuNhapBTP AND ID_PhieuXuatBTP = @ID_PhieuXuatBTP
              AND ID_TheKhoKienBTP_Xuat IN (SELECT ID_TheKhoKienBTP FROM @Selected) AND TonTai = 1
        ) THROW 51111, N'Kiện nhập chuyển kho đã được tạo.', 1;

        DECLARE @PackageMap TABLE (ID_TheKhoKienBTP_Nguon int PRIMARY KEY, ID_TheKhoKienBTP_Moi int UNIQUE);
        INSERT dbo.TheKhoKienBTP
            (ID_PhieuNhapBTP, SoKien, QRCode, ID_ViTriKho, ID_TheKhoKienBTP_Xuat,
             ID_PhieuXuatBTP, TonTai, DauTuan)
        OUTPUT inserted.ID_TheKhoKienBTP_Xuat, inserted.ID_TheKhoKienBTP
            INTO @PackageMap(ID_TheKhoKienBTP_Nguon, ID_TheKhoKienBTP_Moi)
        SELECT @ID_PhieuNhapBTP, k.SoKien, k.QRCode, @ID_ViTriKho, k.ID_TheKhoKienBTP,
               @ID_PhieuXuatBTP, 1, k.DauTuan
        FROM dbo.TheKhoKienBTP k
        JOIN @Selected s ON s.ID_TheKhoKienBTP = k.ID_TheKhoKienBTP;

        INSERT dbo.TheKhoKienBTP_ChiTiet
            (ID_TheKhoKienBTP, ID_PhieuNhapBTP, ID_DonHang_SanPham, SoLuong,
             ItemCode, Ten_SanPham, TonTai, ID_DonHang, ID_QuyTrinhSanXuat,
             Ten_QuyTrinhSanXuat, ID_DonHang_LoSanXuat, ID_KeHoachSanXuat, DauTuan)
        SELECT m.ID_TheKhoKienBTP_Moi, @ID_PhieuNhapBTP, d.ID_DonHang_SanPham,
               SUM(x.SoLuong_XuatKho), d.ItemCode, d.Ten_SanPham, 1, d.ID_DonHang,
               d.ID_QuyTrinhSanXuat, d.Ten_QuyTrinhSanXuat, d.ID_DonHang_LoSanXuat,
               d.ID_KeHoachSanXuat, d.DauTuan
        FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien x
        JOIN dbo.TheKhoKienBTP_ChiTiet d ON d.ID_TheKhoKienBTP_ChiTiet = x.ID_TheKhoKienBTP_ChiTiet
        JOIN @PackageMap m ON m.ID_TheKhoKienBTP_Nguon = d.ID_TheKhoKienBTP
        WHERE x.ID_PhieuXuatBTP = @ID_PhieuXuatBTP AND x.SoLuong_XuatKho > 0
        GROUP BY m.ID_TheKhoKienBTP_Moi, d.ID_DonHang_SanPham, d.ItemCode, d.Ten_SanPham,
                 d.ID_DonHang, d.ID_QuyTrinhSanXuat, d.Ten_QuyTrinhSanXuat,
                 d.ID_DonHang_LoSanXuat, d.ID_KeHoachSanXuat, d.DauTuan;

        INSERT dbo.TheKhoKienBTP_LichSuViTri
            (ID_TheKhoKienBTP, ID_TheKhoKienBTP_Nguon, ID_PhieuXuatBTP, QRCodeKien,
             ID_ViTriCu, MaViTriCu, QRCodeViTriCu, ID_ViTriMoi, MaViTriMoi, QRCodeViTriMoi,
             ID_TaiKhoan, LoaiThaoTac, ThongTinViTriCu, ThongTinViTriMoi,
             SnapshotVersion, ThongTinKien, ChiTietKien)
        SELECT m.ID_TheKhoKienBTP_Moi, m.ID_TheKhoKienBTP_Nguon, @ID_PhieuXuatBTP, oldK.QRCode,
               oldK.ID_ViTriKho, oldV.MaViTriKho, oldV.QRCode,
               newV.ID_ViTriKho, newV.MaViTriKho, newV.QRCode,
               CASE WHEN @ID_TaiKhoan > 0 THEN @ID_TaiKhoan END, 'CHUYEN_KHO_THUE',
               (SELECT TenViTriKho, TenNha, MaNha, TenKhuVuc, MaKhuVuc, TenDay, MaDay,
                       TenTang, MaTang, TenKe, MaKe FROM dbo.DM_Kho_ViTri WHERE ID_ViTriKho = oldK.ID_ViTriKho
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
               (SELECT TenViTriKho, TenNha, MaNha, TenKhuVuc, MaKhuVuc, TenDay, MaDay,
                       TenTang, MaTang, TenKe, MaKe FROM dbo.DM_Kho_ViTri WHERE ID_ViTriKho = newV.ID_ViTriKho
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
               1,
               (SELECT nk.* FROM dbo.TheKhoKienBTP nk WHERE nk.ID_TheKhoKienBTP = m.ID_TheKhoKienBTP_Moi
                FOR JSON PATH, INCLUDE_NULL_VALUES, WITHOUT_ARRAY_WRAPPER),
               (SELECT nd.*, dh.Ma_DonHang AS [DanhMuc.MaDonHang], lsx.So_LoSanXuat AS [DanhMuc.SoLoSanXuat]
                FROM dbo.TheKhoKienBTP_ChiTiet nd
                LEFT JOIN dbo.DonHang dh ON dh.ID_DonHang = nd.ID_DonHang
                LEFT JOIN dbo.DonHang_LoSanXuat lsx ON lsx.ID_DonHang_LoSanXuat = nd.ID_DonHang_LoSanXuat
                WHERE nd.ID_TheKhoKienBTP = m.ID_TheKhoKienBTP_Moi
                ORDER BY nd.ID_TheKhoKienBTP_ChiTiet
                FOR JSON PATH, INCLUDE_NULL_VALUES)
        FROM @PackageMap m
        JOIN dbo.TheKhoKienBTP oldK ON oldK.ID_TheKhoKienBTP = m.ID_TheKhoKienBTP_Nguon
        LEFT JOIN dbo.DM_Kho_ViTri oldV ON oldV.ID_ViTriKho = oldK.ID_ViTriKho
        JOIN dbo.DM_Kho_ViTri newV ON newV.ID_ViTriKho = @ID_ViTriKho;

        SELECT @ID_PhieuNhapBTP AS ID_PhieuNhapBTP, COUNT(*) AS SoKienDaTao
        FROM @PackageMap;

        IF @OwnTransaction = 1 COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @OwnTransaction = 1 AND XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        ELSE IF @OwnTransaction = 0 AND XACT_STATE() = 1 ROLLBACK TRANSACTION RentalWarehouseTransfer;
        THROW;
    END CATCH;
END;
GO
