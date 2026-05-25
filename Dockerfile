FROM node:20-alpine

WORKDIR /app

# Prisma cần OpenSSL trên môi trường Alpine Linux
RUN apk add --no-cache openssl

# Copy package và thư mục prisma trước để tận dụng Docker cache
COPY package*.json ./
COPY prisma ./prisma/

# Cài đặt thư viện Nodejs
RUN npm install

# Copy toàn bộ code vào
COPY . .

# Build Prisma Client
RUN npx prisma generate

# Port mặc định của Back-end bạn đang là 3000
EXPOSE 3000

CMD ["npm", "start"]
