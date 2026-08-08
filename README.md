# EZ-Room Backend

Backend cho hệ thống EZ-Room, một nền tảng tìm nhà, quản lý phòng trọ, đặt cọc thuê nhà, chat, thanh toán và gợi ý thông minh. Đây là phần API chính, chịu trách nhiệm xử lý nghiệp vụ, xác thực người dùng, kết nối cơ sở dữ liệu, tích hợp AI, và đồng bộ dữ liệu realtime giữa frontend và các dịch vụ bên ngoài.

Dự án này không chỉ là một API CRUD đơn giản. Nó có tính chất của một hệ thống marketplace bất động sản/nhà trọ với các lớp nghiệp vụ như:
- Quản lý người dùng và vai trò
- Tạo và quản lý phòng trọ / căn hộ cho thuê
- Theo dõi lịch thuê, đặt cọc, xác nhận chủ nhà
- Thanh toán online qua PayOS
- Chat real-time, thông báo, trạng thái online/offline
- Tìm kiếm nâng cao, gợi ý, đánh giá, roommate matching
- Xử lý hình ảnh và tài liệu thuê nhà
- AI search, embedding, và image search

---

## 1. Mục tiêu dự án

EZ-Room hướng tới giải quyết bài toán tìm phòng và thuê phòng trong môi trường hiện đại:
- Người thuê có thể tìm phòng theo vị trí, giá, tiện nghi, khu vực, loại phòng
- Chủ nhà có thể đăng tin, quản lý phòng, xem yêu cầu thuê, xác nhận hợp đồng
- Hệ thống hỗ trợ đặt cọc và thanh toán an toàn
- Người dùng có thể chat và trao đổi với nhau
- Hệ thống tích hợp AI để nâng cao độ phù hợp và trải nghiệm tìm kiếm

Nói ngắn gọn: đây là backend của một ứng dụng thuê phòng “full-stack marketplace” có đủ nghiệp vụ thật, không chỉ demo.

---

## 2. Kiến trúc tổng thể

Dự án xây dựng theo mô hình backend REST API theo cấu trúc module rõ ràng:

- `server.js`: điểm khởi động ứng dụng, cấu hình Express, Socket.io, middleware, route registration, cron job và preload AI models
- `routes/`: định nghĩa endpoint API theo từng module chức năng
- `controllers/`: xử lý request, gọi service logic, trả response
- `middleware/`: xác thực JWT, kiểm tra vai trò, xử lý auth
- `config/`: cấu hình database, Supabase, Swagger, PayOS, Cloudinary, email
- `prisma/schema.prisma`: schema dữ liệu chính của hệ thống
- `services/`: xử lý nghiệp vụ chuyên biệt, reconciliation payment, cron logic
- `utils/`: helper cho socket, embedding, AI, validation, email
- `cron/`: task tự động chạy theo lịch
- `test/`: test cases cho các phần logic quan trọng

Architecture có thể hiểu như sau:

Client (Frontend/Mobile) -> Express REST API -> Prisma ORM -> PostgreSQL
                                  \-> Supabase (storage / auth / data)
                                  \-> PayOS (payment gateway)
                                  \-> Socket.io (realtime chat / presence)
                                  \-> AI models (embedding / CLIP / Gemini / OpenAI)

---

## 3. Công nghệ chính

### 3.1 Backend runtime
- Node.js
- Express v5
- Prisma ORM

### 3.2 Database & storage
- PostgreSQL qua Prisma
- Supabase cho dữ liệu phụ trợ và storage
- Redis/ioredis cho cache / rate limiting / session-like usage

### 3.3 Realtime & communication
- Socket.io: online status, typing indicator, chat events, notification push
- Nodemailer: gửi email xác thực / reset mật khẩu / thông báo

### 3.4 Payment & file media
- PayOS: thanh toán đặt cọc / wallet transactions
- Cloudinary: lưu trữ hình ảnh
- Multer + busboy: upload file multipart

### 3.5 AI & semantic search
- OpenAI
- Google Generative AI
- HuggingFace Transformers
- CLIP / embedding model để hỗ trợ tìm kiếm hình ảnh và semantic search

### 3.6 Security & documentation
- JWT + bcryptjs
- Swagger + swagger-ui-express
- CORS, rate limiting logic, role-based access

---

## 4. Tính năng chính của hệ thống

### 4.1 Xác thực & quản lý người dùng
- Đăng ký tài khoản
- Đăng nhập / refresh token / logout
- Quên mật khẩu / reset mật khẩu
- Cập nhật profile, avatar, thông tin cá nhân
- Phân quyền theo role: `TENANT`, `LANDLORD`, `GUEST`, `MODERATOR`, ...
- OAuth registration support

### 4.2 Quản lý nhà trọ / phòng trọ
- Tạo phòng trọ / căn hộ cho thuê
- Cập nhật thông tin phòng
- Quản lý tiện ích (amenities)
- Lưu hình ảnh và tài liệu thuê
- Ánh xạ vị trí, khu vực, quận huyện
- Tìm phòng theo điều kiện lọc như giá, diện tích, loại phòng, vị trí

### 4.3 Thuê phòng & hợp đồng
- Tenant đặt cọc phòng qua preorder
- Landlord xác nhận / từ chối yêu cầu
- Tạo hợp đồng thuê
- Quản lý kỳ thuê và các giai đoạn thanh toán
- Theo dõi lịch sử thuê, booking, yêu cầu đã xử lý

### 4.4 Thanh toán & ví điện tử
- Tạo đơn thanh toán với PayOS
- Xác minh trạng thái thanh toán
- Hệ thống wallet và transaction ledger
- Hỗ trợ refund / reconcile payout
- Tự động chạy cron để reconcile preorder payout

### 4.5 Tin nhắn & thông báo realtime
- Chat 1-1 giữa tenant và landlord
- Presence status: online/offline
- Typing indicator
- Thông báo ưu tiên theo user
- Gửi notification khi có sự kiện mới

### 4.6 Tìm kiếm nâng cao & AI
- Tìm phòng bằng điều kiện lọc
- Gợi ý theo preference của user
- Search prompt / AI search
- Embedding vector và CLIP image search
- Tính năng matching người ở ghép / roommate recommendation

### 4.7 Đánh giá & moderation
- Tenant review / landlord review
- User warnings, moderation queue
- Report system
- Document access logs
- Luồng kiểm duyệt/hiệu chỉnh hợp đồng hoặc tài liệu nhà trọ

### 4.8 Quản trị hệ thống
- Admin / moderator dashboard logic
- Review report, quản lý user, kiểm duyệt nội dung
- Cấu hình hệ thống và site settings

---

## 5. Các module chính trong project

### Auth
- `routes/auth.js`
- `controllers/auth.controller.js`
- `middleware/auth.js`

Chịu trách nhiệm cho login, register, OAuth, refresh token, profile update, forgot password, reset password.

### Rooms / Rental
- `routes/room.js`
- `controllers/room.controller.js`
- `models/Room.js`, `Rental.js`

Chứa nghiệp vụ liên quan đến:
- danh sách phòng trọ
- chi tiết phòng
- tạo hợp đồng
- management rental periods
- room amenities
- tìm tenant theo landlord

### Preorders / Payment
- `routes/preorder.js`
- `controllers/preorder.controller.js`
- `services/preorder-reconciliation.service.js`

Đây là một trong những module quan trọng nhất của dự án:
- tenant tạo preorder và thanh toán cọc
- landlord xác nhận hoặc từ chối
- verify trạng thái thanh toán qua PayOS
- reconcile payout / xử lý cron

### Messaging & Presence
- `routes/message.js`
- `utils/socket-manager.js`

Hỗ trợ đời sống realtime của hệ thống:
- online status
- typing
- socket room / broadcast events
- notifications

### Search / AI / Preference
- `routes/search.js`
- `controllers/advanced-search.controller.js`
- `utils/embedding.js`, `utils/clip.js`

Tích hợp AI để tìm kiếm phong phú hơn và phù hợp hơn với user intent.

### Wallet & Finance
- `routes/wallet.js`
- `models/Wallet.js`, `WalletTransaction.js`

Quản lý số dư, giao dịch, refund, ledger, payment flow.

### Moderation & Reports
- `routes/report.js`
- `routes/moderator.js`
- `controllers/moderator.controller.js`

Là phần kiểm tra, cảnh báo và xử lý cộng đồng.

---

## 6. Cấu trúc dữ liệu cốt lõi

Schema Prisma đã cho thấy project này là hệ thống có rất nhiều thực thể. Một số model quan trọng nhất:

- `User`: người dùng hệ thống, có role và thông tin cá nhân
- `RefreshToken`: lưu phiên đăng nhập
- `LifestyleProfile`: hồ sơ phong cách sống của user
- `UserPreference`: sở thích, ngân sách, vùng ưu tiên, tiêu chí tìm phòng
- `Wallet` và `WalletTransaction`: quản lý tài chính người dùng
- `Location`: địa điểm, tọa độ, quận huyện
- `Rental`: tin cho thuê / bất động sản
- `Room`: phòng trong rental, thuộc từng căn nhà/chung cư
- `RoomImage`: hình ảnh phòng
- `Preorder`: đơn đặt cọc / yêu cầu thuê
- `Message`: tin nhắn giữa người dùng
- `Notification`: thông báo hộp thư
- `Report`: báo cáo vi phạm / nội dung không phù hợp
- `tenant_review`: đánh giá sau khi thuê

Nói cách khác, đây không phải chỉ là app “đăng phòng cho thuê” mà là hệ thống full-funnel từ tìm phòng -> đặt cọc -> thuê -> giao dịch -> đánh giá.

---

## 7. Setup môi trường

### 7.1 Cài đặt dependency

```bash
npm install
```

### 7.2 Tạo file .env

Project này dùng các biến môi trường để kết nối DB, auth, storage, payment, email và AI. Ví dụ cấu hình cần có:

```env
PORT=3000
DATABASE_URL=postgresql://user:password@host:5432/ezroom
DIRECT_URL=postgresql://user:password@host:5432/ezroom
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d

SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

PAYOS_CLIENT_ID=...
PAYOS_API_KEY=...
PAYOS_CHECKSUM_KEY=...

CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your_email
MAIL_PASS=your_password

OPENAI_API_KEY=...
GOOGLE_API_KEY=...

ENABLE_AI_MODELS=true
```

### 7.3 Khởi tạo Prisma

```bash
npx prisma generate
npx prisma db push
```

Nếu cần seed dữ liệu mẫu:

```bash
npm run db:seed
```

---

## 8. Chạy dự án

### Development mode

```bash
npm run dev
```

### Production mode

```bash
npm start
```

Ứng dụng sẽ chạy mặc định trên port `3000` nếu không cấu hình `PORT`.

---

## 9. Scripts có sẵn

Trong `package.json` có các script chính như:

```bash
npm run dev
npm start
npm run lint
npm test
npm run db:generate
npm run db:migrate
npm run db:push
npm run db:studio
npm run db:seed
npm run diagnose:clip
```

Các script này giúp:
- chạy server ở dev/prod
- kiểm tra lint
- chạy test
- sinh Prisma client
- migrate database
- seed dữ liệu
- debug AI model / CLIP embedding

---

## 10. API docs

Project có tích hợp Swagger để xem tài liệu API trực tiếp.

Sau khi server chạy:

- Swagger UI: `http://localhost:3000/api-docs`
- JSON spec: `http://localhost:3000/api-docs.json`

Điểm mạnh của dự án là phần API docs được viết khá chặt, với mô tả route cho auth, rooms, preorders, wallets, messages, reports, ...

---

## 11. Luồng nghiệp vụ chính

### 11.1 Luồng người thuê tìm nhà
1. Người dùng đăng ký / đăng nhập
2. Cập nhật preference, lifestyle profile
3. Gọi API tìm phòng / lọc theo vị trí và giá
4. Xem chi tiết phòng và hình ảnh
5. Tạo preorder đặt cọc
6. Thanh toán qua PayOS
7. Landlord xác nhận hoặc từ chối
8. Hệ thống tạo hợp đồng / billing flow

### 11.2 Luồng chủ nhà đăng tin cho thuê
1. Tạo rental / room listing
2. Upload hình ảnh, tài liệu
3. Cấu hình amenities, giá, vị trí, mô tả
4. Người thuê gửi preorder
5. Chủ nhà duyệt yêu cầu
6. Chốt kỳ thuê và tạo hợp đồng

### 11.3 Luồng realtime chat
1. User mở chat với người dùng khác
2. Socket.io kết nối và xác thực token
3. Event `typing`, `stop_typing`, `presence` chạy realtime
4. Notification được emit tới người liên quan

---

## 12. Đặc điểm nổi bật của dự án

Đây là một backend rất “đầy đủ” vì có nhiều phần mà nhiều project demo thường thiếu:

- Role-based authorization
- Database schema lớn và có tính nghiệp vụ cao
- Tích hợp payment real-world
- Realtime system với Socket.io
- AI & embedding search
- Cơ chế cron worker
- Wallet/ledger transaction
- Reports/moderation workflow
- Swagger API documentation

Về mặt chất lượng, dự án này hướng tới tính thực tế hơn là chỉ là demo học tập.

---

## 13. Lưu ý khi phát triển tiếp

- Luôn sync `.env` với môi trường chạy thật, tránh commit secret
- Khi thay đổi Prisma schema, chạy `npx prisma generate` và migrate phù hợp
- Nếu chạy AI model trên máy yếu, có thể tắt preload bằng `ENABLE_AI_MODELS=false`
- Với upload file nên kiểm tra Cloudinary/Supabase storage configuration
- Với PayOS, webhook và return URL cần cấu hình đúng trong môi trường production

---

## 14. Kết luận

EZ-Room Backend là một dự án backend khá toàn diện cho hệ thống cho thuê phòng và bất động sản. Nó không chỉ là một REST API đơn giản mà là một hệ thống có đầy đủ các thành phần cốt lõi của một nền tảng thuê nhà hiện đại:

- Người dùng
- Phòng trọ
- Hợp đồng / thuê phòng
- Thanh toán
- Chat realtime
- AI tìm kiếm
- Moderation / báo cáo
- Admin tools

Nếu bạn đã làm được phần này, bạn đã xây dựng một backend tương đương với một sản phẩm thực tế, chứ không còn là demo học tập đơn thuần.

---

## 15. Một số lệnh nhanh dùng trong dự án

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run dev
```

Nếu cần kiểm tra kết nối DB:

```bash
curl http://localhost:3000/test-prisma
curl http://localhost:3000/test-db
```

---

## 16. Tóm tắt ngắn cho người mới đọc project

EZ-Room backend là nơi xử lý toàn bộ logic của ứng dụng thuê phòng: từ đăng nhập, quản lý tài khoản, đăng tin cho thuê, tìm phòng, tạo đặt cọc, thanh toán online, chat realtime, đến AI recommendation và moderation. Nó tập trung vào yếu tố thực tế, khả năng mở rộng và hỗ trợ đầy đủ quy trình từ đầu đến cuối của hệ thống thuê nhà.

Nếu cần, mình có thể tiếp tục viết thêm một README theo dạng:
- version dành cho team/dev
- version dành cho người xem công khai
- version dành cho portfolio / GitHub showcase
- hoặc viết một phần "Project architecture diagram" dưới dạng Mermaid.