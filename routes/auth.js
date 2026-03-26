const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const { register, registerOAuth, getCitizenCard, upsertCitizenCard, registerLandlord, login, forgotPassword, resetPassword, changePassword, updateProfile, getLifestyle, upsertLifestyle, getPreference, upsertPreference, suggestPassword } = require('../controllers/auth.controller');

const router = express.Router();

/**
 * @openapi
 * /auth/suggest-password:
 *   get:
 *     tags: [Auth]
 *     summary: Gợi ý mật khẩu mạnh
 *     responses:
 *       200:
 *         description: Mật khẩu gợi ý (8+ ký tự, hoa, số, đặc biệt)
 */
router.get('/suggest-password', suggestPassword);

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Đăng ký tài khoản mới
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, password, confirmPassword]
 *             properties:
 *               fullName: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               password: { type: string }
 *               confirmPassword: { type: string }
 *     responses:
 *       201:
 *         description: Đăng ký thành công
 *       400:
 *         description: Dữ liệu không hợp lệ
 */
router.post('/register', register);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Đăng nhập
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Đăng nhập thành công, trả về JWT token
 *       401:
 *         description: Sai email hoặc mật khẩu
 */
router.post('/login', login);

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Gửi email đặt lại mật khẩu
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Email đã được gửi
 */
router.post('/forgot-password', forgotPassword);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Đặt lại mật khẩu với token
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword, confirmPassword]
 *             properties:
 *               token: { type: string }
 *               newPassword: { type: string }
 *               confirmPassword: { type: string }
 *     responses:
 *       200:
 *         description: Đặt mật khẩu thành công
 */
router.post('/reset-password', resetPassword);

/**
 * @openapi
 * /auth/register-oauth:
 *   post:
 *     tags: [Auth]
 *     summary: Đăng ký qua OAuth (Google, etc.)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, fullName, role]
 *             properties:
 *               email: { type: string }
 *               fullName: { type: string }
 *               phone: { type: string }
 *               role: { type: string, enum: [TENANT, LANDLORD] }
 *     responses:
 *       201:
 *         description: Đăng ký thành công
 */
router.post('/register-oauth', registerOAuth);

/**
 * GET /auth/citizen-card
 */
router.get('/citizen-card', verifyJWT, getCitizenCard);

/**
 * PUT /auth/citizen-card
 * Body: { citizenCardNumber, citizenCardFrontImageUrl, citizenCardBackImageUrl }
 */
router.put('/citizen-card', verifyJWT, upsertCitizenCard);

/**
 * POST /auth/register-landlord
 * Requires CCCD verification status = VERIFIED
 */
router.post('/register-landlord', verifyJWT, registerLandlord);

/**
 * PATCH /auth/change-password
 * Body: { currentPassword, newPassword, confirmNewPassword }
 */
router.patch('/change-password', verifyJWT, changePassword);

/**
 * @openapi
 * /auth/profile:
 *   patch:
 *     tags: [Auth]
 *     summary: Cập nhật profile
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName: { type: string }
 *               phone: { type: string }
 *               avatarUrl: { type: string }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.patch('/profile', verifyJWT, updateProfile);

/**
 * @openapi
 * /auth/lifestyle:
 *   get:
 *     tags: [Auth]
 *     summary: Lấy thông tin lifestyle
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Thông tin lifestyle
 *   put:
 *     tags: [Auth]
 *     summary: Cập nhật lifestyle
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               wakeTime: { type: string }
 *               sleepTime: { type: string }
 *               smoking: { type: boolean }
 *               pets: { type: boolean }
 *               cleanliness: { type: string }
 *               noiseLevel: { type: string }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.get('/lifestyle', verifyJWT, getLifestyle);
router.put('/lifestyle', verifyJWT, upsertLifestyle);

/**
 * @openapi
 * /auth/preference:
 *   get:
 *     tags: [Auth]
 *     summary: Lấy preference tìm phòng
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Thông tin preference
 *   put:
 *     tags: [Auth]
 *     summary: Cập nhật preference tìm phòng
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               district: { type: string }
 *               city: { type: string }
 *               minPrice: { type: number }
 *               maxPrice: { type: number }
 *               roomType: { type: string }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.get('/preference', verifyJWT, getPreference);
router.put('/preference', verifyJWT, upsertPreference);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Lấy thông tin user hiện tại
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Thông tin user
 *       401:
 *         description: Chưa xác thực
 */
router.get('/me', verifyJWT, (req, res) => {
    try {
        const { user } = req.auth || {};
        if (!user) {
            return res.status(401).json({ success: false, message: 'Chưa xác thực' });
        }
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                avatar_url: user.avatar_url ?? null,
                created_at: user.created_at,
                role: user.role,
                phone: user.phone ?? null,
                isVip: user.isVip === true,
                gender: user.gender ?? null,
            },
        });
    } catch (err) {
        console.error('GET /auth/me error:', err);
        res.status(500).json({
            success: false,
            message: err.message || 'Lỗi máy chủ',
        });
    }
});


module.exports = router;
