const express = require('express');
const { verifyJWT, requireRole } = require('../middleware/auth');
const {
    getAllUsers,
    getUserById,
    updateUserRole,
    updateUserStatus,
    getDashboardStats,
    getAllWallets,
    getWalletTransactions,
    getWalletStats,
    approveWalletWithdrawal,
    rejectWalletWithdrawal,
} = require('../controllers/admin.controller');

const router = express.Router();

// Tất cả routes trong file này yêu cầu: đăng nhập + role ADMIN
router.use(verifyJWT);
router.use(requireRole('ADMIN'));

/**
 * @openapi
 * /admin/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Thống kê tổng quan dashboard
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Thống kê tổng quan
 */
router.get('/stats', getDashboardStats);

/**
 * @openapi
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: Lấy danh sách users
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [TENANT, LANDLORD, MODERATOR, ADMIN] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ACTIVE, BANNED, SUSPENDED] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách users
 */
router.get('/users', getAllUsers);

/**
 * @openapi
 * /admin/users/{userId}:
 *   get:
 *     tags: [Admin]
 *     summary: Chi tiết user (rentals, wallet, preferences)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết user
 */
router.get('/users/:userId', getUserById);

/**
 * @openapi
 * /admin/users/{userId}/role:
 *   patch:
 *     tags: [Admin]
 *     summary: Thay đổi role của user
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [LANDLORD, MODERATOR, ADMIN] }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.patch('/users/:userId/role', updateUserRole);

/**
 * @openapi
 * /admin/users/{userId}/status:
 *   patch:
 *     tags: [Admin]
 *     summary: Thay đổi status user (khóa/mở khóa)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [ACTIVE, BANNED, SUSPENDED] }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.patch('/users/:userId/status', updateUserStatus);

/**
 * @openapi
 * /admin/wallets/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Thống kê tổng quan ví
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Thống kê ví
 */
router.get('/wallets/stats', getWalletStats);

/**
 * @openapi
 * /admin/wallets:
 *   get:
 *     tags: [Admin]
 *     summary: Lấy danh sách ví
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: minBalance
 *         schema: { type: number }
 *       - in: query
 *         name: maxBalance
 *         schema: { type: number }
 *     responses:
 *       200:
 *         description: Danh sách ví
 */
router.get('/wallets', getAllWallets);

/**
 * @openapi
 * /admin/wallets/{walletId}/transactions:
 *   get:
 *     tags: [Admin]
 *     summary: Lịch sử giao dịch của ví
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: walletId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [DEPOSIT, WITHDRAW, PAYMENT] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, SUCCESS, FAILED] }
 *     responses:
 *       200:
 *         description: Lịch sử giao dịch
 */
router.get('/wallets/:walletId/transactions', getWalletTransactions);

/**
 * @openapi
 * /admin/wallets/withdrawals/{transactionId}/approve:
 *   patch:
 *     tags: [Admin]
 *     summary: Duyệt yêu cầu rút tiền ví
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Duyệt thành công
 */
router.patch('/wallets/withdrawals/:transactionId/approve', approveWalletWithdrawal);

/**
 * @openapi
 * /admin/wallets/withdrawals/{transactionId}/reject:
 *   patch:
 *     tags: [Admin]
 *     summary: Từ chối yêu cầu rút tiền ví
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Từ chối thành công
 */
router.patch('/wallets/withdrawals/:transactionId/reject', rejectWalletWithdrawal);

module.exports = router;
