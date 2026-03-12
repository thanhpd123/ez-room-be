/**
 * Cấu hình feedback - thời gian thuê tối thiểu trước khi đánh giá
 * Demo: 1 phút | Production: 1 ngày
 */
module.exports = {
    MIN_RENTAL_DURATION_MS: 1 * 60 * 1000, // 1 phút (demo)
    // MIN_RENTAL_DURATION_MS: 1 * 24 * 60 * 60 * 1000,  // 1 ngày (production)
};
