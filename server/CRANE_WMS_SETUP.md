# Luồng xuất kho cầu trục và nhập lại kiện lẻ

## Tổng quan

Khi xuất một phần của kiện, cầu trục vẫn đưa **cả kiện** ra khỏi vị trí kho. Ví dụ kiện có 500 sản phẩm, phiếu xuất 300: ERP ghi xuất 300; 200 còn lại vẫn thuộc kiện cũ nhưng chưa có sẵn trong kho để chọn xuất tiếp. Sau khi WMS xác nhận xuất, ERP theo dõi 200 ở **vị trí tạm cùng kho**. Vị trí tạm là vị trí quản lý, không khẳng định vị trí vật lý chính xác của kiện.

Giai đoạn hiện tại, bộ gửi yêu cầu **xuất** WMS là **mock**: payload được lưu trong DB và chưa có HTTP POST thật sang WMS. Các callback xuất có thể chạy thủ công để thử luồng.

Riêng **xác nhận phiếu nhập** từ lựa chọn Kho cầu trục đã gửi HTTP thật tới `POST /api/share/wmsInbound` sau khi ERP lưu thành công. Luồng xuất phía dưới vẫn dùng mock.

## Xác nhận nhập và gửi WMS

1. Chạy [migration bảng gửi nhập](migrations/20260928_crane_wms_inbound.sql.example) trên DB test trước khi thử `/khotmtest`, và trên DB chính trước khi dùng `/khotm`.
2. Backend dùng `WMS_INBOUND_URL` nếu đã cấu hình; mặc định là `https://z76-local.vercel.app/api/share/wmsInbound` theo tài liệu WMS hiện có. Không đặt khóa API WMS trong app.
3. Trên app, vào **Kho cầu trục**, nhập BTP và dấu tuần, quét QR rồi xác nhận. **Không cần chọn vị trí.** `/khotmtest` chỉ nhận phiếu kho BTP test ID 5; `/khotm` kiểm tra đúng `CRANE_WAREHOUSE_ID`. Xác nhận từ lựa chọn Kho BTP thường không gửi WMS.
4. Vì cột vị trí của DB và thủ tục xác nhận hiện bắt buộc có giá trị, backend **tự gán vị trí tạm chờ WMS** trong cùng giao dịch (DB test: `CT-TEMP-TEST` của kho ID 5; DB chính: `CRANE_TEMP_LOCATION_ID`). Đây không phải vị trí vật lý của kiện và kiện chưa được phép xuất tiếp. Backend kiểm tra dữ liệu kiện đã lưu và tạo yêu cầu `PENDING` chứa `orderID`, `orderCode`, `orderType=INBOUND`, `date`, `pallets[].palletID` và `items[]` (`itemCode`, `itemName`, `Lot`, `quantity`). **Mỗi dòng kiện cần có dấu tuần** vì WMS yêu cầu `Lot`.
5. Sau khi giao dịch hoàn tất, backend POST payload đã lưu sang WMS. Phản hồi 2xx đặt trạng thái `SENT`; lỗi mạng/HTTP đặt `FAILED`. ERP vẫn giữ phiếu đã xác nhận và app thông báo riêng lỗi gửi WMS.
6. Khi WMS xếp kiện vào vị trí thật, WMS gửi `POST /erp-test/wms/location-callback` (DB test) hoặc `/erp/wms/location-callback` (DB chính) với `palletID` và `locationID`; có thể kèm `previousLocationID` là ID vị trí tạm. App hiển thị “Chờ WMS cập nhật” cho đến khi vị trí đổi qua callback.
7. Kiểm tra trạng thái gửi bằng `GET /khotmtest/btp/phieunhap/:id/wms-inbound` hoặc `/khotm/...` với `x-api-key`. Nếu `FAILED`, dùng `POST /.../gui-lai-wms` với cùng khóa để gửi lại đúng payload. Phiếu `SENT` không gửi lại. Xem mẫu trong [request1.http](request1.http).

Nếu thiếu bảng migration hoặc kiện thiếu dữ liệu WMS, xác nhận bị từ chối và giao dịch được hoàn tác. Cần kiểm tra WMS đã nhận phiếu trước khi gửi lại khi lần gửi trước mất phản hồi; `Idempotency-Key` gửi theo ID phiếu, nhưng phía WMS phải hỗ trợ khóa này để bảo đảm không nhận trùng.

## Chuẩn bị kho cầu trục thật

1. Chạy nội dung [migration theo dõi WMS](migrations/20260925_crane_wms_outbound.sql.example) trên DB dùng cho kho. Bảng `CraneWmsOutbound` lưu phiếu; `CraneWmsOutboundPallet` lưu từng kiện.
2. Tạo vị trí tạm đang sử dụng trong `DM_Kho_ViTri`, thuộc đúng kho cầu trục.
3. Đặt đồng thời `CRANE_WAREHOUSE_ID` (ID kho) và `CRANE_TEMP_LOCATION_ID` (ID vị trí tạm) trên backend, rồi khởi động lại. Nếu chưa đặt cả hai, luồng cầu trục chính thức chưa bật và kho BTP thông thường vẫn chạy.
4. Khi có tài liệu WMS, thay bộ gửi mock bằng HTTP POST thật. Cần URL, xác thực, cấu trúc payload, phản hồi tiếp nhận và quy tắc thử lại; hiện chưa tự đặt những thông tin này.

## Trình tự xử lý

### 1. App xác nhận xuất

Nhân viên chọn hoặc quét kiện, nhập số lượng xuất và lưu phiếu. Backend kiểm tra kiện thuộc kho cầu trục, đủ tồn, có QR, mã hàng và dấu tuần để đối chiếu WMS; kiện không được đang tham gia một phiếu cầu trục khác.

Trong **một giao dịch DB**, ERP ghi số lượng xuất, lưu vị trí gốc và tồn ban đầu của từng kiện, tạo yêu cầu WMS trạng thái `WAITING_WMS` (**CHỜ WMS**) và khóa kiện khỏi lần xuất khác. Với ví dụ 500 xuất 300, 200 còn lại chưa được phép xuất tiếp. **Chưa chuyển kiện sang vị trí tạm** vì chưa có kết quả WMS.

Sau khi lưu thành công, bộ gửi mock lưu `RequestJson` và đặt `DispatchStatus=MOCKED`. Trạng thái này nghĩa là **chưa gửi HTTP tới WMS**. `POST /khotm/btp/cau-truc/orders/:id/retry-mock` ghi thêm một lần thử cho phiếu `WAITING_WMS` hoặc `FAILED_RETRY`, vẫn chỉ là mock.

### 2. WMS xác nhận kết quả xuất

WMS gửi `POST /erp/wms/outbound-callback` với ID/mã phiếu, trạng thái, mã hàng, dấu tuần, QR kiện và số thực xuất. ERP đối chiếu các thông tin này với phiếu và các kiện đã chọn.

| Kết quả WMS | ERP xử lý | Trạng thái |
| --- | --- | --- |
| `FAILED` | Giữ số xuất đã ghi, không chuyển kiện, tiếp tục khóa để xử lý hoặc thử lại. | `FAILED_RETRY` |
| `COMPLETED` | Đối chiếu số thực xuất; kiện còn hàng được chuyển sang vị trí tạm. | `WAITING_RETURN` |
| `PARTIAL` | Điều chỉnh số xuất theo số WMS thực xuất; kiện còn hàng được chuyển sang vị trí tạm. | `WAITING_RETURN` nếu còn hàng |
| Xuất hết kiện | Không có phần lẻ chờ về, không cần chuyển sang vị trí tạm. | `COMPLETE` |

Với ví dụ 500 xuất 300, **200 còn lại** được theo dõi tại vị trí tạm, trạng thái `WAITING_RETURN` (**CHỜ NHẬP LẠI**). Đây là tồn chưa khả dụng để xuất. Callback xuất lặp cùng nội dung không ghi xuất hoặc chuyển vị trí thêm lần nữa; kết quả khác bị từ chối.

### 3. WMS đưa kiện lẻ trở lại

Chỉ khi WMS đã đặt kiện vào vị trí thật trong kho, họ gửi `POST /erp/wms/location-callback`:

```json
{
  "reason": "RETURN_AFTER_PARTIAL_OUTBOUND",
  "sourceOrderID": "ID phiếu xuất gốc",
  "palletID": "QR kiện cũ",
  "eventID": "mã sự kiện WMS duy nhất",
  "previousLocationID": 123,
  "locationID": 456
}
```

`previousLocationID` là ID vị trí tạm (tùy chọn trong luồng chính thức); `locationID` là ID vị trí thật nơi WMS đặt kiện. Backend kiểm tra đúng phiếu gốc, đúng kiện, trạng thái `WAITING_RETURN`, kiện hiện ở vị trí tạm và vị trí đích thuộc cùng kho. Sau đó ERP chuyển kiện tới vị trí thật, lưu mã sự kiện, đánh dấu kiện `RETURNED` (**ĐÃ NHẬP LẠI**) và mở lại phần tồn để sử dụng. Khi không còn kiện nào chờ về, phiếu thành `COMPLETE`. Gửi lại cùng `eventID` và vị trí sẽ trả `updated=false`.

**Không tạo phiếu nhập mới và không cộng thêm 200 vào tồn.** Số 200 đã là tồn của kiện sau khi trừ số xuất; callback chỉ xác nhận kiện trở lại kho và đổi vị trí/khả dụng.

## Thử bằng kho BTP trên DB test

Khi chưa có ID kho cầu trục thật, lựa chọn **Kho cầu trục** trên app dùng dữ liệu BTP test (ID kho `5`) qua `/khotmtest` và `/erp-test`. Phiếu BTP test đã lưu trước khi có tích hợp WMS chưa có bản ghi `WAITING_WMS`; callback demo đối chiếu phiếu đã xác nhận rồi tạo bản ghi theo dõi. Luồng này không bật kho cầu trục trên DB chính.

Mẫu hiện tại: phiếu `PXBTP-2026-07-2468` (ID `327023`), kiện `BP0000488679`, xuất `35` từ `2400`, còn `2365`. Vị trí gốc `CNK01` (ID `30179`); vị trí tạm `CT-TEMP-TEST` (ID `30302`).

1. DB test cần có các bảng migration và vị trí tạm từ [script vị trí demo](../../KhoTM/database/scripts/add-crane-demo-temp-location.sql.example). Chỉ chạy script trên kết nối DB test.
2. Trong [request.http](request.http), chạy `POST /erp-test/wms/outbound-callback` với `demoMode: true`. Kết quả: kiện còn `2365` ở `CT-TEMP-TEST`, trạng thái `WAITING_RETURN`.
3. Sau đó chạy `POST /erp-test/wms/location-callback` với `demoMode: true`, `sourceOrderID=327023`, `palletID=BP0000488679`, `previousLocationID=30302`, `locationID=30179` và `eventID` duy nhất. Kết quả: kiện về `CNK01`, kiện `RETURNED`, phiếu `COMPLETE`.
4. Kiểm tra bằng `GET /khotmtest/btp/cau-truc/orders/327023` hoặc [script xem QR, vị trí và tồn](../../KhoTM/database/scripts/check-crane-demo-pallet.sql.example); tải lại phiếu trên app để xem trạng thái.

`demoMode` chỉ dùng cho `/erp-test`, không phải trường callback WMS thật. Callback demo nhập lại yêu cầu `previousLocationID` và chỉ cho trở về vị trí gốc.

## Trạng thái cần theo dõi

| Trạng thái | Ý nghĩa | Phần tồn còn lại có thể xuất? |
| --- | --- | --- |
| `WAITING_WMS` | ERP đã ghi xuất, chờ WMS xác nhận. | Không |
| `FAILED_RETRY` | WMS báo lỗi, chờ xử lý hoặc thử lại. | Không |
| `WAITING_RETURN` | WMS đã xuất, phần còn lại ở vị trí tạm. | Không |
| `RETURNED` | Kiện đã về vị trí thật qua callback. | Có, theo số tồn còn lại |
| `COMPLETE` | Phiếu không còn kiện chờ nhập lại. | Tùy trạng thái và tồn từng kiện |

Xem trạng thái bằng `GET /khotm/btp/cau-truc/orders/:id` (kho thật) hoặc `GET /khotmtest/btp/cau-truc/orders/:id` (demo). Kho thật còn có `GET /khotm/btp/cau-truc/config` và `GET /khotm/btp/cau-truc/summary`.


