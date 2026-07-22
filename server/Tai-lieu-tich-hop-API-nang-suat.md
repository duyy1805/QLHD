# Tài liệu tích hợp API hệ thống bảng năng suất

## 1. Thông tin chung

- Base URL: `https://nodeapi.z76.vn/khotmtest`
- Dữ liệu sử dụng JSON, mã hóa UTF-8.
- Các ID trong ví dụ chỉ để minh họa. phải lấy ID hợp lệ từ API kế hoạch.

Bộ khóa xác định một nội dung kế hoạch gồm:

- `ID_KeHoachSanXuat`
- `ID_DonHang_SanPham`
- `ID_DonHang_LoSanXuat`

Khi ghi nhận theo giờ, bộ khóa trên được kết hợp thêm `NgayNhap` và `ID_MocGio`.

## 2. Lấy danh sách kế hoạch sản xuất

```http
GET https://nodeapi.z76.vn/khotmtest/kehoachsanxuat
Accept: application/json
```

API không có body. Kết quả trả về các thông tin chính: ID kế hoạch, ID sản phẩm, ID lô sản xuất, tên và mã sản phẩm, ngày bắt đầu/kết thúc, số lượng kế hoạch, sản lượng đã ghi nhận trong ERP, bộ phận và đơn vị thực hiện.

cần lưu đầy đủ ba ID nói trên để sử dụng cho các API cập nhật.

## 3. Cập nhật tổng sản lượng theo mốc giờ

```http
POST https://nodeapi.z76.vn/khotmtest/tiendosanxuat-mocgio
Content-Type: application/json
Accept: application/json

{
  "ID_KeHoachSanXuat": 1250,
  "ID_DonHang_SanPham": 4521,
  "ID_DonHang_LoSanXuat": 803,
  "NgayNhap": "2026-07-20",
  "ID_MocGio": 1,
  "SoLuong_SanPham": 100
}
```

`SoLuong_SanPham` là **tổng sản lượng hiện tại của mốc giờ**, không phải phần tăng thêm. Ví dụ đã gửi 100, sau đó sản lượng tăng lên 120 thì lần tiếp theo phải gửi 120. Dữ liệu mới sẽ ghi đè dữ liệu cũ của cùng mốc giờ, vì vậy gửi lại cùng giá trị không gây cộng trùng.

## 4. Lấy sản lượng các mốc giờ và tổng trong ngày

```http
POST https://nodeapi.z76.vn/khotmtest/thongtin-tiendosanxuat-mocgio
Content-Type: application/json
Accept: application/json

{
  "ID_KeHoachSanXuat": 1250,
  "ID_DonHang_SanPham": 4521,
  "ID_DonHang_LoSanXuat": 803,
  "NgayNhap": "2026-07-20"
}
```

API trả về:

- `danhSachMocGio`: sản lượng của từng mốc giờ trong ngày.
- `TongSoLuong_SanPham`: tổng sản lượng của tất cả mốc giờ.

có thể gọi API này sau khi cập nhật để đối chiếu dữ liệu. Nếu chưa có dữ liệu, danh sách mốc giờ rỗng và tổng sản lượng bằng 0.

## 5. Cập nhật chất lượng và lỗi theo mốc giờ

```http
POST https://nodeapi.z76.vn/khotmtest/chatluong-mocgio
Content-Type: application/json
Accept: application/json

{
  "ID_KeHoachSanXuat": 1250,
  "ID_DonHang_SanPham": 4521,
  "ID_DonHang_LoSanXuat": 803,
  "NgayNhap": "2026-07-20",
  "ID_MocGio": 1,
  "SoLuong_Dat": 90,
  "SoLuong_KhongDat": 10,
  "DanhSachLoi": [
    {
      "MaLoi": "L001",
      "TenLoi": "Lỗi đường may",
      "SoLuong_Loi": 6,
      "ThoiGian_CapNhat": "2026-07-20T08:30:00"
    },
    {
      "MaLoi": "L002",
      "TenLoi": "Bẩn sản phẩm",
      "SoLuong_Loi": 4,
      "ThoiGian_CapNhat": "2026-07-20T08:30:00"
    }
  ]
}
```

`SoLuong_Dat` và `SoLuong_KhongDat` là tổng hiện tại của mốc giờ. Nếu toàn bộ sản phẩm đã được phân loại, cần bảo đảm:

```text
SoLuong_SanPham = SoLuong_Dat + SoLuong_KhongDat
```

`DanhSachLoi` là toàn bộ danh sách lỗi hiện tại của mốc giờ. Mỗi lần cập nhật, hệ thống thay danh sách cũ bằng danh sách mới. Gửi `DanhSachLoi: []` sẽ xóa các lỗi cũ của mốc giờ đó.

Quy định đối với lỗi:

- `MaLoi` phải ổn định và không được trùng trong cùng một request.
- Một mã lỗi chỉ đại diện cho một loại lỗi.
- Mã lỗi mới sẽ được tự động bổ sung vào danh mục lỗi.
- Tổng `SoLuong_Loi` có thể lớn hơn `SoLuong_KhongDat` vì một sản phẩm có thể mắc nhiều lỗi.
- `ThoiGian_CapNhat` dùng định dạng `yyyy-MM-ddTHH:mm:ss`, theo giờ Việt Nam.

## 6. Quy ước dữ liệu và xử lý lỗi

- `NgayNhap` dùng định dạng `yyyy-MM-dd`.
- `ID_MocGio` là ID mốc giờ theo danh mục hai bên thống nhất, không phải số giờ thực tế.
- Các trường số lượng không được âm và có tối đa hai chữ số thập phân.
- Không gửi dữ liệu cho sản phẩm hoặc lô không thuộc kế hoạch.
- Khi cập nhật lại cùng mốc giờ, luôn gửi tổng mới nhất, không gửi phần tăng thêm.
- Cần kiểm tra cả HTTP status và trường `ok` trong response.
- HTTP `200` và `ok: true`: xử lý thành công.
- HTTP `400`: dữ liệu không hợp lệ; cần sửa dữ liệu trước khi gửi lại.
- HTTP `500` hoặc mất kết nối: có thể gửi lại cùng dữ liệu.
- nên lưu nhật ký request, response, thời điểm gửi và trạng thái xử lý để phục vụ đối chiếu.

## 7. Trình tự tích hợp đề nghị

1. Gọi `GET /kehoachsanxuat` để đồng bộ kế hoạch và lưu các ID.
2. Gọi `POST /tiendosanxuat-mocgio` để cập nhật tổng sản lượng mốc giờ.
3. Gọi `POST /chatluong-mocgio` để cập nhật số lượng đạt, không đạt và lỗi.
4. Gọi `POST /thongtin-tiendosanxuat-mocgio` khi cần kiểm tra sản lượng đã lưu.

> Lưu ý bảo mật: trước khi vận hành chính thức, các API cập nhật nên được bảo vệ bằng API key và giới hạn địa chỉ IP được phép truy cập.
