# EZ-Room Backend ⚙️

Dự án Backend nền tảng cho hệ thống EZ-Room, đóng vai trò như một RESTful API cung cấp xử lý nghiệp vụ phong phú từ quản lý đặt phòng, thanh toán, đến các tính năng AI.

## 🛠️ Công Nghệ Sử Dụng

### Lõi Nền Tảng & Framework
- **[Node.js](https://nodejs.org/)**: Môi trường runtime mạnh mẽ.
- **[Express v5](https://expressjs.com/)**: Framework web phổ biến, gọn nhẹ để xây dựng RESTful API.
- **[Prisma ORM](https://www.prisma.io/)**: Kết nối và tương tác với cơ sở dữ liệu mượt mà, type-safe (PostgreSQL).

### Cơ Sở Dữ Liệu & Bộ Đệm
- **PostgreSQL / [Supabase](https://supabase.com/)**: Cơ sở dữ liệu chính và lưu trữ file/images (Supabase Storage).
- **[Redis](https://redis.io/) (ioredis)**: In-memory cache nhằm tăng hiệu suất, giới hạn tốc độ và quản lý phiên.

### AI & Xử Lý Dữ Liệu
- **[OpenAI](https://openai.com/)**: Tích hợp các AI models (Xử lý prompt, Search Prompt,...).
- **[Google Generative AI](https://ai.google.dev/)**: Tích hợp thêm các model Gemini hỗ trợ.
- **[HuggingFace Transformers](https://huggingface.co/docs/transformers.js/index)**: Trích xuất vectơ nhúng (ClipVector, Feature extraction) dùng để phân tích và đánh giá dữ liệu ngay trên backend.

### Dịch Vụ Mở Rộng
- **[PayOS](https://payos.vn/)**: Tích hợp cổng thanh toán trực tuyến nội địa/quốc tế cho các giao dịch (Preorder, nạp/rút từ ví).
- **[Cloudinary](https://cloudinary.com/)**: Lưu trữ và quản lý hình ảnh tối ưu.
- **[Socket.io](https://socket.io/)**: Phản hồi real-time về tin nhắn, trạng thái phòng và notifycation.
- **[Nodemailer](https://nodemailer.com/)**: Tích hợp gửi email thông báo, xác thực.

### Bảo Mật & Tiện Ích
- **Bảo mật / Auth**: `jsonwebtoken` để mã hóa và phân phối phiên giao dịch, `bcryptjs` để hash password mã hóa an toàn bảo mật.
- **Upload File**: Tích hợp `multer` và `busboy` (dành cho multi-part data).
- **Lập lịch tự động (Cron-job)**: `node-cron` thiết lập các tác vụ định kỳ tự động.
- **API Spec**: `swagger-jsdoc` và `swagger-ui-express` dùng để tự động thiết kế và trình bày trang Document API.

## 🚦 Cài Đặt và Khởi Chạy

1. **Cài đặt thư viện:**
   ```bash
   npm install
   ```

2. **Cấu hình Database:**
   Hãy chắc chắn bạn có file `.env` chứa URL cấu hình Postgres và các Key dịch vụ bên thứ 3 tương ứng (Supabase, PayOS, Cloudinary...).

3. **Khởi tạo và Seed Database (Prisma):**
   ```bash
   npx prisma generate
   npx prisma db push
   # (Tùy chọn) Chạy seed dữ liệu mẫu
   npm run db:seed
   ```

4. **Chạy Server phát triển:**
   ```bash
   npm run dev
   ```

5. **Chạy Server cho Production:**
   ```bash
   npm start
   ```

## 📁 Cấu Trúc Dự Án
* `routes/`: Định tuyến các API.
* `controllers/`: Chức năng xử lý trực tiếp request/response.
* `models/`: Chứa các object liên kết với Prisma Schema và xử lý nghiệp vụ core.
* `middleware/`: Tầng lọc và xử lý Request độc lập (Auth, Error handler).
* `prisma/`: Định nghĩa Database Scheme và công cụ ORM.
* `cron/`: Các tác vụ lên lịch tự động.
* `config/`: Cấu hình hệ thống, dịch vụ (PayOS, Swagger, Database).