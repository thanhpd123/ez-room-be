# EZ-Room Admin API Documentation

## Tổng quan

Hệ thống phân quyền với 4 role chính:
- **ADMIN**: Toàn quyền quản trị hệ thống
- **MODERATOR**: Kiểm duyệt nội dung, hỗ trợ user
- **LANDLORD**: Chủ trọ - đăng bài cho thuê
- **TENANT**: Người thuê - tìm kiếm, đặt phòng

---

## Authentication

Tất cả API yêu cầu xác thực cần gửi header:
```
Authorization: Bearer <token>
```

Token được trả về từ `/auth/login` hoặc `/auth/register-oauth`.

---

## 1. Admin - Quản lý Users

**Base URL:** `/admin`

**Yêu cầu:** Role = `ADMIN`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/admin/stats` | Thống kê tổng quan dashboard |
| GET | `/admin/users` | Danh sách users (phân trang, filter) |
| GET | `/admin/users/:userId` | Chi tiết một user |
| PATCH | `/admin/users/:userId/role` | Thay đổi role user |
| PATCH | `/admin/users/:userId/status` | Khóa/Mở khóa user |

### GET /admin/stats

Trả về thống kê tổng quan cho dashboard.

**Response:**
```json
{
  "success": true,
  "data": {
    "users": {
      "total": 150,
      "byRole": {
        "admins": 2,
        "landlords": 30,
        "tenants": 115,
        "moderators": 3
      },
      "byStatus": {
        "active": 145,
        "banned": 5
      }
    }
  }
}
```

### GET /admin/users

Lấy danh sách users với phân trang và filter.

**Query Parameters:**
| Param | Type | Mô tả |
|-------|------|-------|
| page | number | Trang (mặc định: 1) |
| limit | number | Số items/trang (mặc định: 10) |
| role | string | Filter theo role: ADMIN, LANDLORD, TENANT, MODERATOR |
| status | string | Filter theo status: ACTIVE, INACTIVE, SUSPENDED, BANNED |
| search | string | Tìm theo tên, email, phone |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "fullName": "Nguyễn Văn A",
      "email": "a@example.com",
      "phone": "0901234567",
      "avatarUrl": "https://...",
      "role": "TENANT",
      "status": "ACTIVE",
      "createdAt": "2026-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 150,
    "totalPages": 15
  }
}
```

### PATCH /admin/users/:userId/role

Thay đổi role của user.

**Request Body:**
```json
{
  "role": "LANDLORD"
}
```

**Valid Roles:** `ADMIN`, `LANDLORD`, `TENANT`, `GUEST`, `MODERATOR`

**Response:**
```json
{
  "success": true,
  "message": "Đã cập nhật role của \"Nguyễn Văn A\" thành LANDLORD",
  "data": {
    "id": "uuid",
    "fullName": "Nguyễn Văn A",
    "email": "a@example.com",
    "role": "LANDLORD",
    "status": "ACTIVE"
  }
}
```

**Lưu ý:**
- Không thể tự thay đổi role của chính mình
- Không thể thay đổi role của Admin khác

### PATCH /admin/users/:userId/status

Khóa/Mở khóa tài khoản user.

**Request Body:**
```json
{
  "status": "BANNED"
}
```

**Valid Statuses:** `ACTIVE`, `INACTIVE`, `SUSPENDED`, `BANNED`

---

## 2. Amenities - Quản lý Tiện ích

**Base URL:** `/amenities`

| Method | Endpoint | Role | Mô tả |
|--------|----------|------|-------|
| GET | `/amenities` | Public | Danh sách tiện ích |
| GET | `/amenities/:id` | Public | Chi tiết tiện ích |
| POST | `/amenities` | ADMIN | Tạo tiện ích mới |
| PATCH | `/amenities/:id` | ADMIN | Sửa tiện ích |
| DELETE | `/amenities/:id` | ADMIN | Xóa tiện ích |

### GET /amenities

**Response:**
```json
{
  "success": true,
  "data": [
    { "id": "uuid", "name": "WiFi" },
    { "id": "uuid", "name": "Máy lạnh" },
    { "id": "uuid", "name": "Bãi xe" }
  ],
  "total": 12
}
```

### POST /amenities

**Request Body:**
```json
{
  "name": "Máy giặt"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Đã tạo tiện ích \"Máy giặt\"",
  "data": {
    "id": "uuid",
    "name": "Máy giặt"
  }
}
```

---

## 3. Locations - Quản lý Địa điểm

**Base URL:** `/locations`

| Method | Endpoint | Role | Mô tả |
|--------|----------|------|-------|
| GET | `/locations` | Public | Danh sách địa điểm |
| GET | `/locations/cities` | Public | Danh sách thành phố |
| GET | `/locations/districts` | Public | Danh sách quận/huyện |
| GET | `/locations/:id` | Public | Chi tiết địa điểm |
| POST | `/locations` | ADMIN | Tạo địa điểm |
| PATCH | `/locations/:id` | ADMIN | Sửa địa điểm |
| DELETE | `/locations/:id` | ADMIN | Xóa địa điểm |

### GET /locations

**Query Parameters:**
| Param | Type | Mô tả |
|-------|------|-------|
| city | string | Filter theo thành phố |
| district | string | Filter theo quận |
| search | string | Tìm kiếm |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "address": "123 Nguyễn Trãi",
      "district": "Thanh Xuân",
      "city": "Hà Nội",
      "latitude": 21.0031,
      "longitude": 105.8019
    }
  ],
  "total": 50
}
```

### GET /locations/cities

**Response:**
```json
{
  "success": true,
  "data": ["Hà Nội", "Hồ Chí Minh", "Đà Nẵng"]
}
```

### GET /locations/districts?city=Hà Nội

**Response:**
```json
{
  "success": true,
  "data": [
    { "district": "Ba Đình", "city": "Hà Nội" },
    { "district": "Cầu Giấy", "city": "Hà Nội" }
  ]
}
```

### POST /locations

**Request Body:**
```json
{
  "address": "456 Lê Văn Lương",
  "district": "Thanh Xuân",
  "city": "Hà Nội",
  "latitude": 21.0031,
  "longitude": 105.8019
}
```

---

## 4. Rentals - Quản lý Bài đăng

**Base URL:** `/rentals`

**Yêu cầu:** Role = `ADMIN` hoặc `MODERATOR`

| Method | Endpoint | Role | Mô tả |
|--------|----------|------|-------|
| GET | `/rentals/stats` | ADMIN, MOD | Thống kê bài đăng |
| GET | `/rentals` | ADMIN, MOD | Danh sách bài đăng |
| GET | `/rentals/:id` | ADMIN, MOD | Chi tiết bài đăng |
| PATCH | `/rentals/:id/status` | ADMIN, MOD | Ẩn/Hiện bài đăng |
| DELETE | `/rentals/:id` | ADMIN only | Xóa vĩnh viễn |

### GET /rentals/stats

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 500,
    "byStatus": {
      "available": 350,
      "rented": 100,
      "hidden": 30,
      "archived": 20
    },
    "thisMonth": 45
  }
}
```

### GET /rentals

**Query Parameters:**
| Param | Type | Mô tả |
|-------|------|-------|
| page | number | Trang |
| limit | number | Số items/trang |
| status | string | AVAILABLE, RENTED, HIDDEN, ARCHIVED |
| ownerId | string | Filter theo chủ trọ |
| search | string | Tìm theo title, description |
| city | string | Filter theo thành phố |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Phòng trọ cao cấp Cầu Giấy",
      "description": "Phòng rộng 25m2...",
      "status": "AVAILABLE",
      "createdAt": "2026-02-20T08:00:00Z",
      "owner": {
        "id": "uuid",
        "fullName": "Trần Văn B",
        "email": "b@example.com",
        "phone": "0912345678"
      },
      "location": {
        "id": "uuid",
        "address": "123 Xuân Thủy",
        "district": "Cầu Giấy",
        "city": "Hà Nội"
      },
      "roomCount": 3,
      "rooms": [
        {
          "id": "uuid",
          "room_name": "Phòng 101",
          "price": 3500000,
          "room_type": "PRIVATE"
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 500,
    "totalPages": 50
  }
}
```

### GET /rentals/:id

Trả về chi tiết bài đăng bao gồm:
- Thông tin chủ trọ (owner)
- Địa điểm (location)
- Danh sách phòng (rooms) với:
  - Ảnh (images)
  - Tiện ích (amenities)
  - Đơn đặt cọc gần nhất (preorders)

### PATCH /rentals/:id/status

**Request Body:**
```json
{
  "status": "HIDDEN",
  "reason": "Vi phạm quy định về nội dung"
}
```

**Valid Statuses:** `AVAILABLE`, `RENTED`, `HIDDEN`, `ARCHIVED`

### DELETE /rentals/:id

⚠️ **Chỉ ADMIN** - Xóa vĩnh viễn bài đăng.

**Lưu ý:** Không thể xóa nếu có đơn đặt cọc đang hoạt động (PENDING hoặc CONFIRMED).

---

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Dữ liệu không hợp lệ",
  "errors": { ... }
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Thiếu hoặc sai định dạng header Authorization"
}
```

### 403 Forbidden
```json
{
  "success": false,
  "message": "Bạn không có quyền truy cập. Yêu cầu role: ADMIN"
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Không tìm thấy người dùng"
}
```

### 409 Conflict
```json
{
  "success": false,
  "message": "Email đã được sử dụng"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Đã xảy ra lỗi",
  "error": "Error details..."
}
```

---

## Tổng kết API Routes

```
/auth
  POST   /register          - Đăng ký
  POST   /login             - Đăng nhập  
  POST   /register-oauth    - Đăng ký qua OAuth
  GET    /me                - Thông tin user hiện tại
  PATCH  /profile           - Cập nhật profile
  ...

/admin (ADMIN only)
  GET    /stats             - Dashboard stats
  GET    /users             - List users
  GET    /users/:id         - User detail
  PATCH  /users/:id/role    - Change role
  PATCH  /users/:id/status  - Ban/Unban

/amenities
  GET    /                  - List (public)
  GET    /:id               - Detail (public)
  POST   /                  - Create (ADMIN)
  PATCH  /:id               - Update (ADMIN)
  DELETE /:id               - Delete (ADMIN)

/locations
  GET    /                  - List (public)
  GET    /cities            - Cities (public)
  GET    /districts         - Districts (public)
  GET    /:id               - Detail (public)
  POST   /                  - Create (ADMIN)
  PATCH  /:id               - Update (ADMIN)
  DELETE /:id               - Delete (ADMIN)

/rentals (ADMIN + MODERATOR)
  GET    /stats             - Rental stats
  GET    /                  - List rentals
  GET    /:id               - Rental detail
  PATCH  /:id/status        - Hide/Show rental
  DELETE /:id               - Delete (ADMIN only)

/upload
  POST   /image             - Upload image (authenticated)
```

---

## Dashboard UI Suggestions

### 1. Sidebar Menu
```
📊 Dashboard (stats)
👥 Quản lý Users
🏠 Quản lý Bài đăng
📍 Quản lý Địa điểm
🛋️ Quản lý Tiện ích
📋 Đơn đặt cọc (TODO)
💰 Ví & Giao dịch (TODO)
📝 Feedback & Reports (TODO)
```

### 2. Dashboard Cards
- Tổng số users / users mới tháng này
- Tổng số bài đăng / bài đăng mới
- Số bài đăng bị ẩn (cần xử lý)
- Doanh thu tháng (TODO)

### 3. Data Tables
- Users table với filter role/status, search
- Rentals table với filter status, city
- Quick actions: Edit role, Ban user, Hide rental

---

## Pending Features (TODO)

1. **Feedback/Reports** - Quản lý đánh giá và báo cáo vi phạm
2. **Preorders** - Quản lý đơn đặt cọc, xử lý tranh chấp
3. **Wallet** - Quản lý ví, giao dịch, nạp/rút tiền
4. **Notifications** - Gửi thông báo hệ thống
5. **Audit Log** - Lịch sử thao tác admin/mod
