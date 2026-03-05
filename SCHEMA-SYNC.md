# Đồng bộ schema Prisma với database

Khi gặp lỗi 500 trên các route như `/auth/profile`, `/auth/lifestyle`, `/auth/preference`, `/favorites` hoặc thông báo **Unknown argument `gender`** / **column "gender" does not exist**, thường do schema Prisma hoặc database chưa đồng bộ.

## Supabase: lỗi "prepared statement already exists" hoặc db push treo

Khi dùng **connection pooler** (port 6543), `prisma db push` có thể treo hoặc báo lỗi prepared statement. Cần dùng **direct connection** (port 5432) cho db push/migrate.

1. Vào **Supabase Dashboard** → project → **Settings** → **Database**.
2. Phần **Connection string**, chọn **URI**.
3. Lấy chuỗi **Session mode** / **Direct** (port **5432**, host dạng `db.xxx.supabase.co` hoặc direct).
4. Thêm vào file `.env` (cùng thư mục với `DATABASE_URL`):
   ```env
   DIRECT_URL="postgresql://postgres.[ref]:[PASSWORD]@db.[ref].supabase.co:5432/postgres"
   ```
   (Thay `[ref]` và `[PASSWORD]` bằng giá trị thật từ Supabase.)

5. Chạy lại:
   ```bash
   npx prisma db push
   ```
   Prisma sẽ dùng `DIRECT_URL` cho schema push, tránh lỗi pooler.

## Cách xử lý đồng bộ schema thông thường

1. **Dừng server backend** (Ctrl+C trong terminal đang chạy `npm run dev`).

2. Trong thư mục `ez-room-be`, chạy:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

3. **Chạy lại server** (`npm run dev`).

- `prisma generate`: tạo lại Prisma Client theo file `prisma/schema.prisma`.
- `prisma db push`: áp dụng thay đổi schema xuống database (dùng `DIRECT_URL` nếu có).

Nếu vẫn lỗi, mở tab Network trong DevTools, chọn request bị 500, xem phần Response để đọc `error` hoặc `message` chi tiết.
