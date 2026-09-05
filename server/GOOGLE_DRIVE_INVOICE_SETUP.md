# Google Drive cho hóa đơn điện tử

Backend lưu file đính kèm hóa đơn và file Excel gốc của nhóm import trong một thư mục Google Drive riêng.

## Biến môi trường

```env
HD_GOOGLE_DRIVE_FOLDER_ID=<folder-id-danh-cho-hoa-don>

# Chọn một trong hai cách xác thực service account:
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=<duong-dan-tuyet-doi-den-file-json>

# Hoặc dùng email/private key trực tiếp:
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="<private-key-voi-ky-tu-\\n>"
```

Chia sẻ thư mục ứng với `HD_GOOGLE_DRIVE_FOLDER_ID` cho service account với quyền Editor trước khi chạy backend.

File mới được lưu trong SQL dưới dạng `drive:<fileId>`. Đường dẫn local cũ vẫn được hỗ trợ để xem và xóa.
