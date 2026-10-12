-- CHỈ ĐỌC. Chọn đúng kết nối DB test trước khi chạy. Điền từ GET phiếu WMS.
DECLARE @OrderID int = 0;
DECLARE @WarehouseID int = 5;
DECLARE @ItemCode nvarchar(255) = N'DIEN_MA_HANG_TU_GET';
DECLARE @PalletID nvarchar(255) = N'DIEN_QR_KIEN';

SELECT ID_PhieuXuatBTP,So_PhieuXuatBTP,ID_KhoXuat,TrangThai,QrStatus
FROM dbo.PhieuXuatBTP WHERE ID_PhieuXuatBTP=@OrderID;
EXEC dbo.App_BTP_PhieuXuat_ThongTinChiTiet @ID_PhieuXuatBTP=@OrderID;
SELECT ID_ViTriKho,MaViTriKho,ID_Kho FROM dbo.DM_Kho_ViTri
WHERE ID_Kho=@WarehouseID AND MaViTriKho=N'CT-TEMP-TEST' AND TonTai=1 AND SuDung=1;

-- Các kiện còn tồn đúng mã hàng; chọn đúng dấu tuần trả về, không dùng số lô sản xuất.
SELECT TOP (20) k.QRCode,d.ItemCode,d.DauTuan,k.ID_ViTriKho,v.MaViTriKho,
    d.ID_TheKhoKienBTP_ChiTiet,d.SoLuong-ISNULL(x.Exported,0) AS Available
FROM dbo.TheKhoKienBTP k
JOIN dbo.TheKhoKienBTP_ChiTiet d ON d.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP
JOIN dbo.DM_Kho_ViTri v ON v.ID_ViTriKho=k.ID_ViTriKho
OUTER APPLY (SELECT SUM(SoLuong_XuatKho) AS Exported FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien
    WHERE ID_TheKhoKienBTP_ChiTiet=d.ID_TheKhoKienBTP_ChiTiet) x
WHERE k.TonTai=1 AND d.TonTai=1 AND v.TonTai=1 AND v.SuDung=1 AND v.ID_Kho=@WarehouseID
    AND LTRIM(RTRIM(d.ItemCode))=@ItemCode AND NULLIF(LTRIM(RTRIM(d.DauTuan)),N'') IS NOT NULL
    AND v.MaViTriKho<>N'CT-TEMP-TEST' AND d.SoLuong>ISNULL(x.Exported,0)
    AND NOT EXISTS(SELECT 1 FROM dbo.CraneWmsOutboundPallet p WHERE p.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP
        AND p.Status IN ('WAITING_WMS','FAILED_RETRY','WAITING_RETURN'))
ORDER BY d.DauTuan,k.ID_TheKhoKienBTP,d.ID_TheKhoKienBTP_ChiTiet;

-- Trạng thái sau mỗi request. Số lượng còn = nhập vào kiện - tổng số đã xuất.
SELECT k.QRCode,k.ID_ViTriKho,v.MaViTriKho,v.ID_Kho,d.ItemCode,d.DauTuan,
    d.SoLuong,ISNULL(x.Exported,0) AS Exported,d.SoLuong-ISNULL(x.Exported,0) AS Remaining
FROM dbo.TheKhoKienBTP k
JOIN dbo.TheKhoKienBTP_ChiTiet d ON d.ID_TheKhoKienBTP=k.ID_TheKhoKienBTP
LEFT JOIN dbo.DM_Kho_ViTri v ON v.ID_ViTriKho=k.ID_ViTriKho
OUTER APPLY (SELECT SUM(SoLuong_XuatKho) AS Exported FROM dbo.PhieuXuatBTP_ChiTiet_TheKhoKien
    WHERE ID_TheKhoKienBTP_ChiTiet=d.ID_TheKhoKienBTP_ChiTiet) x
WHERE k.QRCode=@PalletID AND k.TonTai=1 AND d.TonTai=1;
SELECT * FROM dbo.CraneWmsOutbound WHERE ID_PhieuXuatBTP=@OrderID;
SELECT * FROM dbo.CraneWmsOutboundPallet WHERE ID_PhieuXuatBTP=@OrderID;
IF OBJECT_ID(N'dbo.CraneWmsOutboundEvent',N'U') IS NOT NULL
    SELECT * FROM dbo.CraneWmsOutboundEvent WHERE ID_PhieuXuatBTP=@OrderID;
