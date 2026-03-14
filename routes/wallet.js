const express = require('express');
const { verifyJWT } = require('../middleware/auth');
const {
    getMyWallet,
    getMyWalletTransactions,
    depositToWallet,
    withdrawFromWallet,
} = require('../controllers/wallet.controller');

const router = express.Router();

router.use(verifyJWT);

/**
 * @openapi
 * /wallet:
 *   get:
 *     tags: [Wallet]
 *     summary: Số dư ví của user
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Thông tin ví
 */
router.get('/', getMyWallet);

/**
 * @openapi
 * /wallet/transactions:
 *   get:
 *     tags: [Wallet]
 *     summary: Lịch sử giao dịch ví
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách giao dịch
 */
router.get('/transactions', getMyWalletTransactions);

/**
 * @openapi
 * /wallet/deposit:
 *   post:
 *     tags: [Wallet]
 *     summary: Tạo link nạp tiền ví qua PayOS
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount: { type: number }
 *     responses:
 *       200:
 *         description: Tạo link nạp ví thành công
 */
router.post('/deposit', depositToWallet);

/**
 * @openapi
 * /wallet/withdraw:
 *   post:
 *     tags: [Wallet]
 *     summary: Rút tiền từ ví nội bộ
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount: { type: number }
 *     responses:
 *       200:
 *         description: Rút thành công
 */
router.post('/withdraw', withdrawFromWallet);

module.exports = router;
