# PROMPT CHO CODEX: Xây dựng ứng dụng Quản lý tài liệu bằng Next.js + shadcn/ui

## 1. Bối cảnh dự án

Tôi muốn xây dựng một ứng dụng web bằng **Next.js**, sử dụng **shadcn/ui** cho giao diện, phục vụ mục đích **quản lý tài liệu nội bộ**.

Ứng dụng có các nhóm tài liệu chính:

1. **Quy trình**
   - Người dùng có thể tải lên các tài liệu quy trình.
   - Mỗi quy trình có:
     - Tên quy trình
     - Số quy trình
     - File tài liệu
     - Phiên bản
     - Ghi chú thay đổi
   - Mỗi quy trình có thể có nhiều phiên bản.
   - Có thể cập nhật phiên bản mới.
   - Có thể thay thế phiên bản cũ.
   - Cần biết phiên bản nào đang là phiên bản hiện hành.

2. **Thông báo**
   - Người dùng có thể tải tài liệu thông báo lên hệ thống.
   - Khi tạo thông báo, người tạo có thể:
     - Chọn người phụ trách xử lý
     - Chọn hạn hoàn thành
     - Nhập nội dung/ghi chú
     - Upload file đính kèm
   - Người được giao xử lý có thể xác nhận hoàn thành thông báo.
   - Admin hoặc người tạo có thể theo dõi trạng thái xử lý.

3. **Admin có thể tạo thêm mảng tài liệu mới**
   - Ví dụ: ban đầu có mục “Thông báo”.
   - Sau đó admin có thể tạo thêm mục “Công văn”.
   - Mục “Công văn” sẽ có tính năng tương tự “Thông báo”:
     - Upload tài liệu
     - Giao người xử lý
     - Có hạn hoàn thành
     - Người được giao xác nhận hoàn thành

## 2. Định hướng thiết kế

Không hard-code riêng từng module như:

- /quy-trinh
- /thong-bao
- /cong-van

Thay vào đó, thiết kế theo mô hình **loại tài liệu động**.

Các loại tài liệu được lưu trong bảng `DocumentTypes`.

Mỗi loại tài liệu có một kiểu nghiệp vụ:

```ts
type ModuleKind = "VERSIONED_DOCUMENT" | "ASSIGNMENT_DOCUMENT";
```

Trong đó:

- `VERSIONED_DOCUMENT`: dùng cho Quy trình, Quy định, Biểu mẫu chuẩn, tài liệu có phiên bản.
- `ASSIGNMENT_DOCUMENT`: dùng cho Thông báo, Công văn, Yêu cầu xử lý, tài liệu có giao việc.

Ví dụ:

| Code | Name | ModuleKind |
|---|---|---|
| QUY_TRINH | Quy trình | VERSIONED_DOCUMENT |
| THONG_BAO | Thông báo | ASSIGNMENT_DOCUMENT |
| CONG_VAN | Công văn | ASSIGNMENT_DOCUMENT |

## 3. Công nghệ sử dụng

Sử dụng stack sau:

- Next.js App Router
- TypeScript
- shadcn/ui
- Tailwind CSS
- React Hook Form
- Zod
- Prisma
- SQL Server hoặc PostgreSQL
- Auth.js / NextAuth
- Upload file local trước, có thể nâng cấp lên S3/MinIO sau

Nếu chưa có dự án, hãy tạo cấu trúc dự án chuẩn với Next.js App Router.

## 4. Yêu cầu giao diện

Sử dụng shadcn/ui để tạo giao diện quản trị hiện đại, dễ dùng.

Cần có các thành phần:

- Sidebar menu
- Header
- Dashboard layout
- Table danh sách tài liệu
- Form tạo/sửa tài liệu
- Dialog upload file
- Badge trạng thái
- Date picker hạn hoàn thành
- Select người phụ trách
- Tabs lịch sử phiên bản
- Dropdown menu cho action
- Toast thông báo kết quả

## 5. Vai trò người dùng

Tối thiểu có các role:

```ts
type UserRole = "ADMIN" | "MANAGER" | "USER" | "VIEWER";
```

Quyền cơ bản:

### ADMIN
- Toàn quyền hệ thống
- Quản lý loại tài liệu
- Quản lý người dùng
- Xem tất cả tài liệu
- Cập nhật/xóa tài liệu nếu cần

### MANAGER
- Tạo tài liệu
- Upload tài liệu
- Giao xử lý tài liệu
- Theo dõi tiến độ xử lý

### USER
- Xem tài liệu được phép xem
- Xử lý tài liệu được giao
- Xác nhận hoàn thành tài liệu được giao

### VIEWER
- Chỉ xem tài liệu

## 6. Database schema đề xuất

Thiết kế database theo các bảng chính sau.

### 6.1. Users

```prisma
model User {
  id        Int      @id @default(autoincrement())
  fullName  String
  email     String   @unique
  password  String?
  role      UserRole @default(USER)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  documentsCreated Document[] @relation("DocumentCreatedBy")
  versionsUploaded DocumentVersion[] @relation("VersionUploadedBy")
  assignmentsAssigned DocumentAssignment[] @relation("AssignmentAssignedBy")
  assignmentsReceived DocumentAssignment[] @relation("AssignmentAssignedTo")
  logs DocumentLog[]
}
```

### 6.2. DocumentTypes

```prisma
model DocumentType {
  id          Int        @id @default(autoincrement())
  code        String     @unique
  name        String
  moduleKind  ModuleKind
  description String?
  isActive    Boolean    @default(true)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  documents   Document[]
}
```

### 6.3. Documents

```prisma
model Document {
  id             Int            @id @default(autoincrement())
  documentTypeId Int
  title          String
  documentNo     String?
  description    String?
  status         DocumentStatus @default(DRAFT)
  createdById    Int
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  documentType   DocumentType   @relation(fields: [documentTypeId], references: [id])
  createdBy      User           @relation("DocumentCreatedBy", fields: [createdById], references: [id])

  versions       DocumentVersion[]
  assignments    DocumentAssignment[]
  logs           DocumentLog[]

  @@index([documentTypeId])
  @@index([createdById])
  @@index([status])
}
```

### 6.4. DocumentVersions

```prisma
model DocumentVersion {
  id          Int      @id @default(autoincrement())
  documentId  Int
  versionNo   String
  fileName    String
  fileUrl     String
  fileSize    Int?
  fileType    String?
  changeNote  String?
  isCurrent   Boolean  @default(false)
  uploadedById Int
  uploadedAt  DateTime @default(now())

  document    Document @relation(fields: [documentId], references: [id])
  uploadedBy  User     @relation("VersionUploadedBy", fields: [uploadedById], references: [id])

  @@index([documentId])
  @@index([isCurrent])
}
```

### 6.5. DocumentAssignments

```prisma
model DocumentAssignment {
  id              Int              @id @default(autoincrement())
  documentId      Int
  assignedToUserId Int
  assignedByUserId Int
  dueDate         DateTime?
  status          AssignmentStatus @default(PENDING)
  completedAt     DateTime?
  completionNote  String?
  assignedAt      DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  document        Document @relation(fields: [documentId], references: [id])
  assignedTo      User     @relation("AssignmentAssignedTo", fields: [assignedToUserId], references: [id])
  assignedBy      User     @relation("AssignmentAssignedBy", fields: [assignedByUserId], references: [id])

  @@index([documentId])
  @@index([assignedToUserId])
  @@index([status])
  @@index([dueDate])
}
```

### 6.6. DocumentLogs

```prisma
model DocumentLog {
  id          Int      @id @default(autoincrement())
  documentId  Int
  action      String
  oldValue    String?
  newValue    String?
  createdById Int
  createdAt   DateTime @default(now())

  document    Document @relation(fields: [documentId], references: [id])
  createdBy   User     @relation(fields: [createdById], references: [id])

  @@index([documentId])
  @@index([createdById])
}
```

### 6.7. Enums

```prisma
enum UserRole {
  ADMIN
  MANAGER
  USER
  VIEWER
}

enum ModuleKind {
  VERSIONED_DOCUMENT
  ASSIGNMENT_DOCUMENT
}

enum DocumentStatus {
  DRAFT
  ACTIVE
  ARCHIVED
  CANCELLED
}

enum AssignmentStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  OVERDUE
  CANCELLED
}
```

## 7. Route/pages cần xây dựng

Dùng Next.js App Router.

Cấu trúc gợi ý:

```txt
app/
  layout.tsx
  page.tsx

  dashboard/
    page.tsx

  documents/
    [type]/
      page.tsx
      new/
        page.tsx
      [id]/
        page.tsx
      [id]/
        edit/
          page.tsx

  assignments/
    page.tsx

  admin/
    document-types/
      page.tsx
      new/
        page.tsx
      [id]/
        edit/
          page.tsx

    users/
      page.tsx
```

## 8. API / Server Actions cần có

Có thể dùng Server Actions hoặc Route Handlers.

### Document Types

- Tạo loại tài liệu
- Sửa loại tài liệu
- Bật/tắt loại tài liệu
- Lấy danh sách loại tài liệu

### Documents

- Tạo tài liệu
- Sửa thông tin tài liệu
- Xóa hoặc archive tài liệu
- Lấy danh sách tài liệu theo loại
- Tìm kiếm tài liệu theo tên, số tài liệu
- Lọc theo trạng thái

### Versions

- Upload phiên bản đầu tiên
- Upload phiên bản mới
- Set phiên bản mới là hiện hành
- Xem lịch sử phiên bản
- Download file

Khi upload phiên bản mới:
1. Set tất cả version cũ của document thành `isCurrent = false`
2. Insert version mới với `isCurrent = true`
3. Ghi log `UPLOAD_NEW_VERSION`

### Assignments

- Giao người xử lý
- Cập nhật hạn hoàn thành
- Người được giao xác nhận hoàn thành
- Người tạo/admin xem danh sách xử lý
- Lọc quá hạn

Khi user xác nhận hoàn thành:
1. Kiểm tra user hiện tại có đúng là người được giao không
2. Update `status = COMPLETED`
3. Set `completedAt = now()`
4. Lưu `completionNote`
5. Ghi log `COMPLETE_ASSIGNMENT`

## 9. Luồng nghiệp vụ chi tiết

### 9.1. Tạo Quy trình

1. Người dùng vào menu `Quy trình`.
2. Bấm `Thêm quy trình`.
3. Nhập:
   - Tên quy trình
   - Số quy trình
   - Mô tả
   - Phiên bản, ví dụ: v1
   - Upload file
   - Ghi chú phiên bản
4. Hệ thống tạo bản ghi `Documents`.
5. Hệ thống tạo bản ghi `DocumentVersions` với `isCurrent = true`.
6. Ghi log.

### 9.2. Cập nhật phiên bản Quy trình

1. Người dùng mở chi tiết quy trình.
2. Bấm `Upload phiên bản mới`.
3. Nhập:
   - Phiên bản mới, ví dụ: v2
   - File mới
   - Ghi chú thay đổi
4. Hệ thống set version cũ `isCurrent = false`.
5. Tạo version mới `isCurrent = true`.
6. Ghi log.

### 9.3. Tạo Thông báo

1. Người dùng vào menu `Thông báo`.
2. Bấm `Thêm thông báo`.
3. Nhập:
   - Tên thông báo
   - Số thông báo nếu có
   - Mô tả/nội dung
   - File đính kèm
   - Người phụ trách
   - Hạn hoàn thành
4. Hệ thống tạo `Documents`.
5. Hệ thống tạo version đầu tiên hoặc file đính kèm.
6. Hệ thống tạo `DocumentAssignments`.
7. Ghi log.

### 9.4. Xác nhận hoàn thành Thông báo

1. Người được giao vào danh sách `Việc của tôi` hoặc `Thông báo được giao`.
2. Mở chi tiết thông báo.
3. Bấm `Xác nhận hoàn thành`.
4. Nhập ghi chú hoàn thành nếu có.
5. Hệ thống cập nhật trạng thái assignment.
6. Ghi log.

### 9.5. Admin tạo mục Công văn

1. Admin vào `Admin > Loại tài liệu`.
2. Bấm `Thêm loại tài liệu`.
3. Nhập:
   - Tên: Công văn
   - Mã: CONG_VAN
   - Kiểu nghiệp vụ: ASSIGNMENT_DOCUMENT
   - Mô tả
4. Sau khi tạo, sidebar tự hiển thị thêm menu `Công văn`.
5. Mục Công văn dùng chung logic với Thông báo.

## 10. Giao diện chi tiết cần có

### 10.1. Sidebar

Sidebar hiển thị:

- Dashboard
- Quy trình
- Thông báo
- Công văn nếu admin đã tạo
- Việc của tôi
- Admin
  - Loại tài liệu
  - Người dùng

Menu tài liệu lấy động từ bảng `DocumentTypes`.

### 10.2. Trang danh sách tài liệu

Cần có:

- Tiêu đề loại tài liệu
- Nút thêm mới
- Ô tìm kiếm
- Bộ lọc trạng thái
- Bảng danh sách

Cột bảng:

- Tên tài liệu
- Số tài liệu
- Loại
- Trạng thái
- Người tạo
- Ngày tạo
- Action

Nếu là loại `ASSIGNMENT_DOCUMENT`, thêm:

- Số người được giao
- Số người đã hoàn thành
- Hạn gần nhất

Nếu là loại `VERSIONED_DOCUMENT`, thêm:

- Phiên bản hiện hành

### 10.3. Trang chi tiết tài liệu

Hiển thị:

- Tên tài liệu
- Số tài liệu
- Mô tả
- Loại tài liệu
- Trạng thái
- Người tạo
- Ngày tạo
- File hiện hành
- Nút download
- Lịch sử phiên bản nếu có
- Danh sách người được giao nếu có
- Lịch sử thao tác

### 10.4. Form tạo tài liệu

Form cần thay đổi theo `moduleKind`.

Nếu `VERSIONED_DOCUMENT`:

- Tên tài liệu
- Số tài liệu
- Mô tả
- Version
- File
- Ghi chú phiên bản

Nếu `ASSIGNMENT_DOCUMENT`:

- Tên tài liệu
- Số tài liệu
- Mô tả
- File
- Người phụ trách
- Hạn hoàn thành
- Ghi chú giao việc

## 11. Validation

Sử dụng Zod để validate.

### DocumentType

- Name bắt buộc
- Code bắt buộc, viết hoa, không dấu, không khoảng trắng
- ModuleKind bắt buộc

### Document

- Title bắt buộc
- DocumentTypeId bắt buộc
- File bắt buộc khi tạo mới
- Version bắt buộc nếu là `VERSIONED_DOCUMENT`
- Người phụ trách bắt buộc nếu là `ASSIGNMENT_DOCUMENT`
- Hạn hoàn thành có thể bắt buộc tùy cấu hình

## 12. File upload

Ở giai đoạn đầu, lưu file local vào thư mục:

```txt
public/uploads/documents/yyyy/mm/
```

Khi lưu DB thì lưu:

- fileName
- fileUrl
- fileSize
- fileType

Cần validate:

- Chỉ cho phép pdf, doc, docx, xls, xlsx, png, jpg nếu cần
- Giới hạn dung lượng, ví dụ 20MB

## 13. Audit log

Mọi hành động quan trọng cần ghi log:

- CREATE_DOCUMENT
- UPDATE_DOCUMENT
- ARCHIVE_DOCUMENT
- UPLOAD_VERSION
- SET_CURRENT_VERSION
- ASSIGN_USER
- UPDATE_DUE_DATE
- COMPLETE_ASSIGNMENT
- CREATE_DOCUMENT_TYPE
- UPDATE_DOCUMENT_TYPE

## 14. Dashboard

Dashboard hiển thị:

- Tổng số tài liệu
- Tổng số quy trình
- Tổng số thông báo/công văn đang xử lý
- Số việc được giao cho tôi
- Số việc quá hạn
- Danh sách việc sắp đến hạn
- Danh sách tài liệu mới nhất

## 15. Yêu cầu code

Hãy triển khai theo hướng clean code:

- Component rõ ràng
- Tách service/database logic
- Tách validation schema
- Tách UI component
- Không viết tất cả logic trong page.tsx
- Có loading state
- Có error handling
- Có toast khi tạo/sửa thành công hoặc thất bại
- Có confirmation dialog khi xóa/archive

## 16. Cấu trúc thư mục gợi ý

```txt
src/
  app/
    dashboard/
    documents/
    assignments/
    admin/

  components/
    layout/
      app-sidebar.tsx
      app-header.tsx
      dashboard-layout.tsx

    documents/
      document-table.tsx
      document-form.tsx
      document-detail.tsx
      version-history.tsx
      assignment-list.tsx

    admin/
      document-type-form.tsx
      document-type-table.tsx

    ui/

  lib/
    prisma.ts
    auth.ts
    upload.ts
    permissions.ts
    utils.ts

  schemas/
    document.schema.ts
    document-type.schema.ts
    assignment.schema.ts

  services/
    document.service.ts
    document-type.service.ts
    assignment.service.ts
    log.service.ts

  types/
    document.ts
```

## 17. Ưu tiên triển khai

Làm theo thứ tự sau:

1. Khởi tạo project Next.js + shadcn/ui
2. Thiết kế Prisma schema
3. Tạo seed dữ liệu:
   - Admin user
   - DocumentTypes: Quy trình, Thông báo
4. Tạo layout dashboard + sidebar động
5. Tạo màn quản lý loại tài liệu
6. Tạo màn danh sách tài liệu theo type
7. Tạo form tạo tài liệu
8. Tạo upload file
9. Tạo version cho Quy trình
10. Tạo assignment cho Thông báo/Công văn
11. Tạo màn “Việc của tôi”
12. Tạo xác nhận hoàn thành
13. Tạo log lịch sử
14. Tạo dashboard thống kê

## 18. Kết quả mong muốn

Sau khi hoàn thành, hệ thống cần đáp ứng:

- Người dùng quản lý được Quy trình có nhiều phiên bản.
- Người dùng tạo được Thông báo và giao người xử lý.
- Người được giao xác nhận hoàn thành.
- Admin tạo được loại tài liệu mới như Công văn.
- Loại tài liệu mới có thể dùng lại tính năng của Thông báo nếu chọn `ASSIGNMENT_DOCUMENT`.
- Menu tự động hiển thị theo loại tài liệu đang active.
- Giao diện đẹp, rõ ràng, phù hợp hệ thống nội bộ.

## 19. Lưu ý quan trọng

Không thiết kế kiểu mỗi loại tài liệu là một module code riêng biệt.

Thiết kế đúng là:

```txt
DocumentType -> Document -> DocumentVersion / DocumentAssignment
```

Trong đó:

- Quy trình là `DocumentType` có `moduleKind = VERSIONED_DOCUMENT`
- Thông báo là `DocumentType` có `moduleKind = ASSIGNMENT_DOCUMENT`
- Công văn là `DocumentType` có `moduleKind = ASSIGNMENT_DOCUMENT`

Mục tiêu là xây hệ thống linh hoạt, sau này admin có thể thêm loại tài liệu mới mà không phải sửa code nhiều.
