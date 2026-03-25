const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'EZ-Room API',
      version: '1.0.0',
      description: 'API documentation cho ứng dụng EZ-Room - tìm kiếm và quản lý phòng trọ',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Nhập JWT token sau khi đăng nhập',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: process.env.REFRESH_TOKEN_COOKIE_NAME || 'ezroom_refresh_token',
          description: 'Refresh token HttpOnly cookie dùng cho endpoint /auth/refresh',
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Xác thực và đăng ký' },
      { name: 'Admin', description: 'Quản trị hệ thống (ADMIN)' },
      { name: 'Amenities', description: 'Tiện ích phòng trọ' },
      { name: 'Locations', description: 'Địa điểm' },
      { name: 'Rentals', description: 'Nhà cho thuê' },
      { name: 'Rooms', description: 'Phòng trọ' },
      { name: 'Public', description: 'API công khai (browse, search)' },
      { name: 'Favorites', description: 'Phòng yêu thích' },
      { name: 'Search', description: 'Tìm kiếm' },
      { name: 'Roommate', description: 'Tìm bạn ở ghép' },
      { name: 'Messages', description: 'Tin nhắn' },
      { name: 'Wallet', description: 'Ví tiền' },
      { name: 'Moderator', description: 'Kiểm duyệt (MODERATOR/ADMIN)' },
      { name: 'Reports', description: 'Báo cáo vi phạm' },
      { name: 'Preorders', description: 'Đơn đặt trước' },
      { name: 'Feedback', description: 'Đánh giá phòng' },
      { name: 'Upload', description: 'Tải ảnh lên' },
    ],
  },
  apis: ['./routes/*.js', './server.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
