# Unit Tests — EZ-Room Backend

## Cấu trúc

```
test/
├── README.md                       # Hướng dẫn này
├── helpers.js                      # Hàm mock chung (req, res, prisma)
├── validators.test.js              # Test validators (auth + rental)
├── middleware.test.js              # Test middleware (verifyJWT, requireRole, optionalJWT)
├── auth.controller.test.js         # Test auth controller (register, login, OTP, profile...)
├── admin.controller.test.js        # Test admin controller (users CRUD, role, status)
└── rental.controller.test.js       # Test rental controller (CRUD, status update)
```

## Cách chạy

```bash
# Chạy tất cả test
node --test test/

# Chạy 1 file cụ thể
node --test test/validators.test.js

# Chạy với output chi tiết
node --test --test-reporter spec test/
```

## Công nghệ

- **node:test** — Module test built-in của Node.js (không cần cài thêm)
- **node:assert** — Module assert built-in
- **Mock objects** — Tự tạo mock cho req, res, prisma (không cần thư viện bên ngoài)

## Lưu ý

- Tất cả test đều là **unit test** (mock database, không gọi DB thật)
- Comment bằng **tiếng Việt** để dễ hiểu
- Mỗi file test tương ứng với 1 module trong `controllers/`, `validators/`, `middleware/`
