# Hướng dẫn triển khai OTP email cho đăng nhập ERP

Tài liệu này hướng dẫn cấu hình tính năng OTP đã được tích hợp trong backend
`D:\Code\QLHD\server` và frontend `D:\Code\thanhtoan\z76`.

OTP chỉ áp dụng cho tài khoản có `OtpEnabled = 1` trong bảng `dbo.AuthOtpAccount`.
Các tài khoản khác tiếp tục đăng nhập ERP như trước.

## 1. Tổng quan luồng đăng nhập

1. Frontend gửi tài khoản và mật khẩu tới `POST /auth/login` của Node API.
2. Node API tính MD5 tương thích hệ ERP cũ và xác thực trực tiếp với
   `TAG_System.dbo.TaiKhoanDangNhap`.
3. Backend đối chiếu cấu hình `dbo.AuthOtpAccount` với tài khoản thật trong
   `TAG_System.dbo.TaiKhoanDangNhap`.
4. Nếu không bật OTP, backend trả token ERP ngay.
5. Nếu bật OTP, backend gửi mã 6 số qua Gmail API và chỉ trả `challengeId`.
6. Khi OTP đúng, backend mới giải mã và trả token ERP.
7. Nếu chọn tin cậy thiết bị, backend đặt cookie HttpOnly có hiệu lực 7 ngày.

Thông số hiện tại:

- OTP gồm 6 chữ số, hết hạn sau 5 phút và chỉ dùng một lần.
- Tối đa 5 lần nhập sai; chỉ gửi lại sau 60 giây.
- Đăng nhập mật khẩu: tối đa 10 lần sai/tài khoản và 50 lần sai/IP trong 10 phút.
- Phát OTP: giới hạn 5 yêu cầu/tài khoản và 30 yêu cầu/IP trong 10 phút.
- Thiết bị tin cậy trong 7 ngày.
- OTP lưu dưới dạng HMAC; token ERP chờ xác minh được mã hóa AES-256-GCM.

### Vị trí các bảng

- `TAG_System.dbo.TaiKhoanDangNhap` là bảng tài khoản đăng nhập hiện có. Backend đọc
  `ID_TaiKhoanDangNhap`, `TenDangNhap`, `Email`, `SuDung` và `TonTai` từ bảng này.
- `dbo.AuthOtpAccount`, `dbo.AuthOtpChallenge` và `dbo.AuthTrustedDevice` vẫn nằm trong
  database hiện tại mà `db.js` đang kết nối; không tạo các bảng OTP trong `TAG_System`.
- Backend thực hiện JOIN chéo database từ database hiện tại sang
  `TAG_System.dbo.TaiKhoanDangNhap`.
- Cột `AuthOtpAccount.UserId` lưu chuỗi tương ứng với
  `TaiKhoanDangNhap.ID_TaiKhoanDangNhap`. `NormalizedUsername` là phương án đối chiếu dự phòng.
- Tài khoản chỉ được OTP nếu `TaiKhoanDangNhap.SuDung = 1`, `TonTai = 1` và
  `AuthOtpAccount.OtpEnabled = 1`.
- Email trong `AuthOtpAccount.OtpEmail` được ưu tiên. Nếu để chuỗi rỗng, backend thử dùng
  `TaiKhoanDangNhap.Email`; vì migration hiện tại đặt `OtpEmail` là NOT NULL, nên khi thêm
  cấu hình hãy nhập email OTP rõ ràng.

## 2. Chuẩn bị tài khoản gửi mail

Nên dùng hộp thư riêng, ví dụ `no-reply@tencongty.vn`, thay vì hộp thư cá nhân dùng
hằng ngày. Backend chỉ xin quyền gửi mail, không xin quyền đọc hoặc xóa thư.

### 2.1. Google Workspace của công ty — khuyến nghị

- Google Cloud project nên thuộc cùng Google Workspace Organization.
- Chọn đối tượng ứng dụng OAuth là **Internal**.
- Chỉ tài khoản trong tổ chức được cấp quyền.
- Ứng dụng Internal thường không cần xác minh công khai với Google.
- Quản trị viên Workspace có thể phải cho phép ứng dụng trong Google Admin Console.

### 2.2. Gmail cá nhân hoặc Workspace không quản lý được Organization

- Chọn đối tượng ứng dụng OAuth là **External**.
- Khi ứng dụng ở trạng thái **Testing**, thêm email gửi mail vào **Test users**.
- Refresh token của ứng dụng External ở trạng thái Testing có thể hết hạn sau 7 ngày.
- Để chạy lâu dài, chuyển ứng dụng sang **In production**.
- `gmail.send` là scope nhạy cảm. Ứng dụng chưa xác minh có thể hiển thị cảnh báo
  “Google hasn't verified this app”. Ứng dụng cá nhân/nội bộ ít người dùng có các trường
  hợp được miễn xác minh, nhưng cảnh báo và giới hạn người dùng vẫn có thể xuất hiện.

Tài liệu Google:

- [Gmail API Node.js quickstart](https://developers.google.com/workspace/gmail/api/quickstart/nodejs)
- [Danh sách scope Gmail API](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [OAuth 2.0 cho web server](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Audience và Testing/Production](https://support.google.com/cloud/answer/15549945)
- [Các trường hợp không bắt buộc xác minh](https://support.google.com/cloud/answer/13464323)

## 3. Tạo Google Cloud project và bật Gmail API

### Bước 1: Tạo hoặc chọn project

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/).
2. Đăng nhập bằng tài khoản có quyền quản lý project.
3. Nhấn tên project trên thanh phía trên, chọn **New Project**.
4. Đặt tên, ví dụ `Z76 Finance OTP`.
5. Nếu dùng Workspace, chọn đúng Organization/Location của công ty.
6. Nhấn **Create**, sau đó chọn project vừa tạo.

Không dùng project thử nghiệm cá nhân cho production của công ty.

### Bước 2: Bật Gmail API

1. Mở **APIs & Services → Library**.
2. Tìm và chọn **Gmail API**.
3. Nhấn **Enable**.

Nếu chưa bật Gmail API, backend thường nhận lỗi `403 accessNotConfigured`.

## 4. Cấu hình Google Auth Platform

### Bước 1: Branding

1. Mở **Google Auth Platform → Branding**.
2. Nếu thấy **Get Started**, nhấn nút này.
3. Điền:
   - **App name**: `Z76 Finance OTP`.
   - **User support email**: email quản trị có người theo dõi.
   - **Developer contact information**: email nhận cảnh báo từ Google.
4. Đồng ý Google API Services User Data Policy và lưu.

Không cần logo nếu chỉ dùng nội bộ. Ứng dụng External cần xác minh có thể phải khai báo
homepage, privacy policy và tên miền đã xác minh.

### Bước 2: Audience

Mở **Google Auth Platform → Audience**:

- Workspace nội bộ: chọn **Internal**.
- Gmail cá nhân hoặc tài khoản ngoài Organization: chọn **External**.

Nếu chọn External và đang ở Testing:

1. Tìm **Test users**.
2. Nhấn **Add users**.
3. Thêm chính xác email sẽ gửi OTP.
4. Lưu thay đổi.

Production dùng External nên chuyển **Publishing status** sang **In production** sau khi
kiểm thử. Không để Testing lâu dài vì refresh token có thể hết hạn sau 7 ngày.

### Bước 3: Data Access và scope gửi mail

1. Mở **Google Auth Platform → Data Access**.
2. Chọn **Add or remove scopes**.
3. Tìm và chọn duy nhất:

```text
https://www.googleapis.com/auth/gmail.send
```

4. Lưu thay đổi.

Không chọn `https://mail.google.com/`, `gmail.readonly`, `gmail.modify` hoặc
`gmail.compose`. Chức năng OTP chỉ cần `gmail.send`.

## 5. Tạo OAuth Client và lấy refresh token

Hướng dẫn này dùng Google OAuth 2.0 Playground để lấy token một lần. Phải dùng OAuth
Client của chính project. Client mặc định của Playground có thể tự thu hồi refresh token
sau 24 giờ.

### Bước 1: Tạo OAuth Client

1. Mở **Google Auth Platform → Clients**.
2. Nhấn **Create Client**.
3. Chọn **Application type: Web application**.
4. Đặt tên, ví dụ `Z76 OTP Token Generator`.
5. Trong **Authorized redirect URIs**, thêm chính xác:

```text
https://developers.google.com/oauthplayground
```

6. Nhấn **Create**.
7. Sao chép:
   - **Client ID** → `GMAIL_CLIENT_ID`.
   - **Client secret** → `GMAIL_CLIENT_SECRET`.

Không đưa Client secret vào frontend, Git hoặc ảnh chụp màn hình.

### Bước 2: Cấu hình OAuth 2.0 Playground

1. Truy cập [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Nhấn biểu tượng bánh răng **OAuth 2.0 configuration** ở góc trên bên phải.
3. Bật **Use your own OAuth credentials**.
4. Nhập Client ID và Client secret vừa tạo.
5. Đóng bảng cấu hình.

### Bước 3: Cấp quyền gửi Gmail

1. Tại **Step 1 – Select & authorize APIs**, nhập:

```text
https://www.googleapis.com/auth/gmail.send
```

2. Nhấn **Authorize APIs**.
3. Chọn đúng tài khoản Gmail sẽ gửi OTP.
4. Kiểm tra tên ứng dụng và quyền yêu cầu, sau đó nhấn **Allow/Continue**.

Nếu thấy cảnh báo ứng dụng chưa xác minh, chỉ tiếp tục khi đúng project, đúng tên ứng
dụng và quyền duy nhất là gửi email.

### Bước 4: Lấy refresh token

1. Tại **Step 2 – Exchange authorization code for tokens**, nhấn
   **Exchange authorization code for tokens**.
2. Sao chép ô **Refresh token** vào `GMAIL_REFRESH_TOKEN` trên máy chủ.

Không dùng Access token trong `.env`: access token tồn tại ngắn hạn. Backend sẽ tự dùng
refresh token để lấy access token mới.

Nếu không thấy refresh token:

1. Mở [Quyền truy cập tài khoản Google](https://myaccount.google.com/connections).
2. Thu hồi quyền của `Z76 Finance OTP`.
3. Quay lại Playground và cấp quyền lại.
4. Kiểm tra đã bật **Use your own OAuth credentials**.

## 6. Cấu hình biến môi trường backend

Mở file môi trường backend hoặc khai báo trong PM2/Docker:

```dotenv
# JWT do Node backend phát hành sau khi xác thực trực tiếp
ACCESS_TOKEN_SECRET=CHUOI_BI_MAT_KY_JWT
AUTH_TOKEN_TTL=8h

# Hai khóa độc lập cho HMAC và AES-256-GCM
OTP_HASH_SECRET=CHUOI_NGAU_NHIEN_THU_NHAT
OTP_ENCRYPTION_KEY=CHUOI_BASE64_32_BYTE_THU_HAI

# Gmail API OAuth
GMAIL_SENDER=no-reply@example.com
GMAIL_CLIENT_ID=123456789012-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=thay_bang_client_secret_sao_chep_tu_google_cloud
GMAIL_REFRESH_TOKEN=thay_bang_refresh_token_lay_tu_oauth_playground

# Origin frontend, phân cách bằng dấu phẩy và không có dấu / cuối
CORS_ORIGINS=https://finance.z76.vn,http://localhost:5173

# Production HTTPS phải là true
COOKIE_SECURE=true
```

Lưu ý:

- `GMAIL_SENDER` phải là hộp thư đã cấp quyền ở Playground, hoặc địa chỉ “Send mail as”
  đã được Gmail xác minh cho hộp thư đó.
- `GMAIL_CLIENT_ID` phải được sao chép nguyên giá trị từ Google Cloud. Giá trị thật đã
  có sẵn đuôi `.apps.googleusercontent.com`; không tự nối thêm đuôi này lần nữa.
- `CORS_ORIGINS` phải chứa chính xác protocol, hostname và port của frontend.
- `COOKIE_SECURE=false` chỉ dùng local HTTP; production phải dùng `true` và HTTPS.
- Không thêm dấu nháy quanh giá trị nếu công cụ quản lý environment không yêu cầu.

### Tạo hai secret OTP

Chạy hai lần và dùng hai kết quả khác nhau:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- Lần 1 → `OTP_HASH_SECRET`.
- Lần 2 → `OTP_ENCRYPTION_KEY`.
- Không dùng chung hai giá trị.
- Đổi `OTP_ENCRYPTION_KEY` sẽ làm challenge đang chờ không giải mã được; người dùng chỉ
  cần đăng nhập lại.

### API key ERP cũ không còn sử dụng

API key trước đây từng nằm trong `.env` frontend và có thể còn trong lịch sử Git. Cần
thu hồi key cũ. Luồng đăng nhập mới không dùng `ERP_LOGIN_URL` hoặc `ERP_LOGIN_API_KEY`.

## 7. Chạy migration CSDL

Migration:

```text
D:\Code\QLHD\server\migrations\20260722_erp_otp.sql
```

Với SQL Server Management Studio:

1. Kết nối đúng SQL Server.
2. Chọn đúng database mà `D:\Code\QLHD\server\db.js` sử dụng. Đây là database chứa các
   bảng OTP, không phải database `TAG_System`.
3. Mở file migration và kiểm tra lại tên database.
4. Nhấn **Execute**.

Migration kiểm tra tồn tại trước khi tạo và tạo ba bảng:

- `dbo.AuthOtpAccount`: tài khoản bắt buộc OTP.
- `dbo.AuthOtpChallenge`: challenge OTP và token ERP đã mã hóa.
- `dbo.AuthTrustedDevice`: thiết bị tin cậy, hạn dùng và trạng thái thu hồi.
- `dbo.AuthLoginAttempt`: lịch sử tối thiểu để giới hạn đăng nhập sai theo username/IP.

Login SQL của backend phải có quyền đọc chéo database:

```sql
SELECT ID_TaiKhoanDangNhap, TenDangNhap, Email, SuDung, TonTai
FROM TAG_System.dbo.TaiKhoanDangNhap;
```

Backend chỉ cần quyền `SELECT` trên bảng tài khoản và không cập nhật `MatKhau`.

### Cách Node backend xử lý mật khẩu MD5

Cột `TAG_System.dbo.TaiKhoanDangNhap.MatKhau` đang lưu MD5 dạng hexadecimal viết thường.
Frontend gửi mật khẩu gốc tới Node backend qua HTTPS. Node backend thực hiện:

1. Chuyển mật khẩu đầu vào thành byte ASCII.
2. Tính MD5.
3. Chuyển kết quả thành chuỗi hexadecimal viết thường.
4. So sánh với cột `MatKhau`.

Không băm MD5 ở frontend. Backend không ghi mật khẩu gốc hoặc chuỗi MD5 vào log. Sau khi
xác thực thành công, Node phát hành JWT bằng `ACCESS_TOKEN_SECRET`; token chỉ được trả về
sau OTP nếu tài khoản có bật OTP.

Không thêm tài khoản thật trước khi cấu hình Gmail OAuth hoàn chỉnh; nếu không, tài khoản
đó sẽ không nhận được OTP.

## 8. Bật hoặc tắt OTP cho tài khoản

`NormalizedUsername` phải là username chữ thường, bỏ khoảng trắng hai đầu. `UserId` phải
khớp với `TAG_System.dbo.TaiKhoanDangNhap.ID_TaiKhoanDangNhap`.

Thêm tài khoản:

```sql
INSERT dbo.AuthOtpAccount
    (UserId, Username, NormalizedUsername, OtpEmail, OtpEnabled)
VALUES
    (N'123', N'nguyenvana', N'nguyenvana', N'nguyenvana@example.com', 1);
```

Có thể tra ID và email trước khi thêm:

```sql
SELECT ID_TaiKhoanDangNhap, TenDangNhap, TenDayDu, Email, SuDung, TonTai
FROM TAG_System.dbo.TaiKhoanDangNhap
WHERE TenDangNhap = N'nguyenvana';
```

Nếu chưa biết UserId, để `NULL`; backend sẽ đối chiếu bằng username:

```sql
INSERT dbo.AuthOtpAccount
    (UserId, Username, NormalizedUsername, OtpEmail, OtpEnabled)
VALUES
    (NULL, N'nguyenvana', N'nguyenvana', N'nguyenvana@example.com', 1);
```

Kiểm tra danh sách:

```sql
SELECT UserId, Username, NormalizedUsername, OtpEmail, OtpEnabled, UpdatedAt
FROM dbo.AuthOtpAccount
ORDER BY Username;
```

Đổi email nhận OTP:

```sql
UPDATE dbo.AuthOtpAccount
SET OtpEmail = N'emailmoi@example.com', UpdatedAt = SYSUTCDATETIME()
WHERE NormalizedUsername = N'nguyenvana';
```

Tắt OTP không xóa cấu hình:

```sql
UPDATE dbo.AuthOtpAccount
SET OtpEnabled = 0, UpdatedAt = SYSUTCDATETIME()
WHERE NormalizedUsername = N'nguyenvana';
```

Tắt OTP cũng làm challenge chưa xác minh của tài khoản không còn dùng được.

## 9. Quản lý thiết bị tin cậy

Thu hồi toàn bộ thiết bị của một user:

```sql
UPDATE dbo.AuthTrustedDevice
SET RevokedAt = SYSUTCDATETIME()
WHERE UserId = N'123' AND RevokedAt IS NULL;
```

Xem thiết bị còn hiệu lực:

```sql
SELECT Id, UserId, UserAgent, CreatedAt, LastUsedAt, ExpiresAt
FROM dbo.AuthTrustedDevice
WHERE RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()
ORDER BY LastUsedAt DESC;
```

Cookie là HttpOnly nên frontend không đọc được. Khi đăng xuất, backend thu hồi token thiết
bị và xóa cookie.

## 10. Cấu hình frontend

Frontend `.env` chỉ chứa URL công khai:

```dotenv
VITE_API_BASE=https://nodeapi.z76.vn/sosec
VITE_AUTH_BASE=https://nodeapi.z76.vn/auth
```

Không đặt Google Client secret, refresh token, `ACCESS_TOKEN_SECRET` hoặc secret OTP trong frontend.
Mọi biến `VITE_*` đều có thể bị đóng gói vào JavaScript gửi xuống trình duyệt.

## 11. Khởi động và kiểm thử

Backend tại `D:\Code\QLHD\server`:

```powershell
npm test
node --check utils\erpOtpAuth.js
node --check routes\auth.js
node --check index.js
npm start
```

Frontend tại `D:\Code\thanhtoan\z76`:

```powershell
npm run build
npm run dev
```

Kịch bản bắt buộc:

1. Tài khoản không có trong `AuthOtpAccount`: không hỏi OTP.
2. Tài khoản bật OTP: chuyển sang màn hình OTP và chưa nhận access token.
3. Kiểm tra đúng người gửi, người nhận và thời gian nhận email.
4. OTP đúng: đăng nhập thành công.
5. Dùng lại OTP: bị từ chối.
6. Sai 5 lần: challenge bị khóa.
7. Quá 5 phút: OTP hết hạn.
8. Gửi lại: mã cũ vô hiệu, mã mới hoạt động.
9. Tin cậy thiết bị: lần sau trên cùng trình duyệt được bỏ qua OTP.
10. Đăng xuất: thiết bị bị thu hồi và lần sau phải OTP lại.
11. Trình duyệt/thiết bị khác: vẫn phải OTP.
12. Tắt `OtpEnabled`: challenge cũ bị từ chối, lần đăng nhập sau không hỏi OTP.

Nên bật trước cho một tài khoản thử nghiệm rồi mới thêm các tài khoản chính thức.

## 12. Xử lý lỗi thường gặp

### Xem log đăng nhập OTP

Mỗi lần đăng nhập backend tạo một `requestId`. Khi có lỗi, giao diện hiển thị mã này và
backend ghi log JSON bắt đầu bằng `[AUTH]`. Có thể tìm đúng request bằng `requestId` mà
không cần ghi mật khẩu hoặc token.

Nếu chạy trực tiếp bằng Node, xem cửa sổ đang chạy `npm start`. Nếu chạy bằng PM2:

```powershell
pm2 logs --lines 200
```

Các event chính:

- `login_started`: request đã tới backend và cho biết nguồn xác thực đang dùng.
- `direct_login_rejected`: username/mật khẩu không khớp hoặc tài khoản không hoạt động.
- `direct_login_accepted`: xác thực trực tiếp `TaiKhoanDangNhap` thành công.
- `direct_login_rate_limited`: vượt giới hạn đăng nhập sai.
- `direct_login_failed`: lỗi SQL, schema hoặc cấu hình JWT.
- `database_connected`: backend kết nối được database hiện tại.
- `otp_not_required`: tài khoản không bật OTP.
- `otp_account_found`: tìm thấy cấu hình OTP và email.
- `trusted_device_accepted`: cookie thiết bị tin cậy hợp lệ.
- `otp_challenge_created`: đã lưu challenge vào CSDL.
- `otp_email_sent`: Gmail API gửi thành công.
- `otp_email_failed`: Gmail OAuth hoặc Gmail API gặp lỗi.
- `otp_login_failed`: lỗi truy vấn, schema, quyền chéo database hoặc mã hóa.

Log không chứa mật khẩu, OTP, access token, API key hoặc refresh token. Không thêm các
giá trị này vào `console.log` khi điều tra lỗi.

### `redirect_uri_mismatch`

- OAuth Client phải là Web application.
- Redirect URI phải đúng `https://developers.google.com/oauthplayground`.
- Không thêm dấu `/` cuối; chờ vài phút sau khi cập nhật Google Cloud.

### Không nhận được refresh token

- Kiểm tra **Use your own OAuth credentials** trong Playground.
- Thu hồi quyền tại `https://myaccount.google.com/connections` rồi cấp lại.
- Đảm bảo đăng nhập đúng tài khoản gửi mail.
- Không dùng client mặc định của Playground vì token có thể bị thu hồi sau 24 giờ.

### `invalid_grant`

Refresh token hết hạn hoặc bị thu hồi. Nguyên nhân thường gặp:

- Ứng dụng External vẫn ở Testing và quyền đã quá 7 ngày.
- Người dùng đã thu hồi quyền.
- Client ID/secret không khớp refresh token.
- Chính sách bảo mật tài khoản hoặc Workspace thay đổi.

Kiểm tra Audience/Publishing status rồi cấp lại refresh token.

### `insufficientPermissions`

- OAuth chưa cấp scope `https://www.googleapis.com/auth/gmail.send`.
- Thu hồi quyền cũ, thêm đúng scope trong Data Access và cấp lại.

### `403 accessNotConfigured`

- Gmail API chưa được Enable trong đúng project.
- Client ID thuộc project khác với project vừa bật API.

### Backend báo chưa thể gửi mã xác minh

Kiểm tra log và các biến `GMAIL_SENDER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
`GMAIL_REFRESH_TOKEN`; đồng thời kiểm tra kết nối HTTPS tới `gmail.googleapis.com`.
Backend cố ý không trả chi tiết lỗi Gmail ra trình duyệt.

### CORS hoặc cookie không hoạt động

- `CORS_ORIGINS` phải khớp chính xác origin frontend và không có `/` cuối.
- Production frontend/backend phải dùng HTTPS.
- `COOKIE_SECURE=true` ở production.
- Reverse proxy phải chuyển tiếp `Origin`, `Cookie` và `Set-Cookie`.

### Đăng nhập trực tiếp không thành công

- Kiểm tra `ACCESS_TOKEN_SECRET` đã được cấu hình.
- Kiểm tra username, trạng thái `SuDung`, `TonTai` và MD5 trong `TaiKhoanDangNhap`.
- Kiểm tra migration đã tạo `dbo.AuthLoginAttempt`.
- Tìm event `direct_login_rejected` hoặc `direct_login_failed` theo `requestId`.

### Lỗi `Invalid object name` hoặc `SELECT permission denied` với `TAG_System`

- Kiểm tra `TAG_System` nằm trên cùng SQL Server với database hiện tại.
- Kiểm tra login SQL trong `db.js` có quyền `SELECT` trên
  `TAG_System.dbo.TaiKhoanDangNhap`.
- Không chuyển ba bảng OTP sang `TAG_System`; chỉ cấp quyền đọc bảng tài khoản.

## 13. Vận hành và bảo mật

- Không ghi OTP, access token, refresh token hoặc API key vào log.
- Giới hạn người đọc environment của backend.
- Theo dõi lỗi gửi mail và lượng challenge bất thường.
- Thu hồi refresh token ngay khi nghi ngờ bị lộ.
- Định kỳ kiểm tra `AuthOtpAccount` và `AuthTrustedDevice`.
- Không dùng một hộp thư nhận OTP chung cho nhiều người nếu cần xác minh danh tính.

Để thu hồi quyền Gmail của backend, mở
[Google Account Connections](https://myaccount.google.com/connections), chọn
`Z76 Finance OTP` và xóa quyền truy cập. Backend sẽ không gửi được mail cho tới khi được
cấp refresh token mới.

## 14. Thứ tự triển khai production

1. Thu hồi API key ERP từng xuất hiện ở frontend; luồng mới không cần cấp key thay thế.
2. Tạo Google Cloud project, Gmail OAuth Client và refresh token.
3. Cấu hình toàn bộ biến môi trường backend.
4. Chạy migration SQL.
5. Restart/deploy backend.
6. Deploy frontend đã bỏ API key.
7. Thêm một tài khoản thử nghiệm vào `AuthOtpAccount`.
8. Chạy toàn bộ kịch bản kiểm thử.
9. Bật OTP cho các tài khoản chính thức.
10. Theo dõi log và khả năng gửi mail trong những ngày đầu.
