const prisma = require('../config/prisma');
const { getPayOSClient } = require('../config/payos');

const DEFAULT_CURRENCY = 'VND';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function toNumber(v) {
    if (v == null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function parsePositiveAmount(raw) {
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (!Number.isInteger(amount)) return null;
    return amount;
}

function generateOrderCode() {
    return Number(`${Date.now()}${Math.floor(Math.random() * 90) + 10}`);
}

function buildWalletPayOSRedirectUrl(type, walletId) {
    const base = (type === 'cancel' ? process.env.PAYOS_WALLET_CANCEL_URL : process.env.PAYOS_WALLET_RETURN_URL)
        || `${FRONTEND_URL.replace(/\/$/, '')}/wallet`;
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}walletId=${encodeURIComponent(walletId)}&source=payos&type=${type}`;
}

function buildWalletTopupDescription(walletId) {
    const suffix = String(walletId || '').replace(/-/g, '').slice(-8).toUpperCase();
    return `EZROOM TOPUP ${suffix}`.slice(0, 25);
}

function formatWallet(wallet) {
    return {
        id: wallet.id,
        userId: wallet.userId,
        balance: toNumber(wallet.balance),
        currency: DEFAULT_CURRENCY,
        createdAt: wallet.created_at,
    };
}

function formatTransaction(tx) {
    return {
        id: tx.id,
        walletId: tx.walletId,
        type: tx.transaction_type,
        status: tx.status,
        amount: toNumber(tx.amount),
        description: tx.description || '',
        createdAt: tx.createdAt,
    };
}

async function ensureWallet(userId, txClient = prisma) {
    const existing = await txClient.wallet.findUnique({ where: { userId } });
    if (existing) return existing;
    return txClient.wallet.create({
        data: {
            userId,
            balance: 0,
        },
    });
}

/**
 * Lấy ví của user
 */
async function getMyWallet(userId) {
    const wallet = await ensureWallet(userId);
    return { data: formatWallet(wallet) };
}

/**
 * Lấy lịch sử giao dịch ví
 */
async function getMyWalletTransactions(userId, params) {
    const { page = 1, limit = 20, type } = params;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
    const typeFilter =
        typeof type === 'string' ? type.trim().toUpperCase() : '';

    const wallet = await ensureWallet(userId);
    const where = { walletId: wallet.id };
    if (typeFilter) where.transaction_type = typeFilter;

    const [rows, total] = await Promise.all([
        prisma.walletTransaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (pageNum - 1) * limitNum,
            take: limitNum,
        }),
        prisma.walletTransaction.count({ where }),
    ]);

    return {
        data: rows.map(formatTransaction),
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
        },
    };
}

/**
 * Tạo link nạp tiền ví qua PayOS
 */
async function depositToWallet(userId, body) {
    const amount = parsePositiveAmount(body?.amount);
    const description =
        typeof body?.description === 'string' ? body.description.trim() : '';

    if (!amount) {
        throw Object.assign(new Error('Số tiền nạp không hợp lệ'), { statusCode: 400 });
    }

    const payos = getPayOSClient();
    const orderCode = generateOrderCode();

    const result = await prisma.$transaction(async (tx) => {
        const wallet = await ensureWallet(userId, tx);

        const paymentOrder = await tx.payment_orders.create({
            data: {
                user_id: userId,
                vnp_txn_ref: String(orderCode),
                amount,
                purpose: 'WALLET_TOPUP',
                status: 'PENDING',
                ref_type: 'WALLET',
                ref_id: wallet.id,
            },
        });

        const transaction = await tx.walletTransaction.create({
            data: {
                walletId: wallet.id,
                transaction_type: 'DEPOSIT',
                status: 'PENDING',
                amount,
                description: description || 'Nạp tiền ví qua PayOS',
                ref_type: 'WALLET_TOPUP',
                ref_id: paymentOrder.id,
            },
        });

        return { wallet, paymentOrder, transaction };
    });

    try {
        const paymentLink = await payos.paymentRequests.create({
            orderCode,
            amount,
            description: buildWalletTopupDescription(result.wallet.id),
            returnUrl: buildWalletPayOSRedirectUrl('return', result.wallet.id),
            cancelUrl: buildWalletPayOSRedirectUrl('cancel', result.wallet.id),
        });

        return {
            message: 'Tạo link nạp tiền thành công',
            data: {
                wallet: formatWallet(result.wallet),
                transaction: formatTransaction(result.transaction),
                payment: {
                    provider: 'PAYOS',
                    orderCode: String(orderCode),
                    checkoutUrl: paymentLink?.checkoutUrl || null,
                    qrCode: paymentLink?.qrCode || null,
                    paymentLinkId: paymentLink?.paymentLinkId || null,
                    status: paymentLink?.status || 'PENDING',
                },
            },
        };
    } catch (err) {
        await prisma.$transaction(async (tx) => {
            await tx.payment_orders.update({
                where: { id: result.paymentOrder.id },
                data: {
                    status: 'FAILED',
                    raw_ipn_payload: {
                        step: 'create_wallet_topup_link',
                        error: err?.message || 'Unknown error',
                    },
                },
            });

            await tx.walletTransaction.update({
                where: { id: result.transaction.id },
                data: {
                    status: 'FAILED',
                },
            });
        });

        throw Object.assign(new Error(`Không thể tạo link nạp tiền PayOS: ${err.message}`), {
            statusCode: 502,
        });
    }
}

/**
 * Rút tiền từ ví
 */
async function withdrawFromWallet(userId, body) {
    const amount = parsePositiveAmount(body?.amount);
    const description =
        typeof body?.description === 'string' ? body.description.trim() : '';

    if (!amount) {
        throw Object.assign(new Error('Số tiền rút không hợp lệ'), { statusCode: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
        const wallet = await ensureWallet(userId, tx);

        // Khóa theo ví trong phạm vi transaction để tránh 2 request rút chạy đồng thời.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${wallet.id}))`;

        const currentBalance = toNumber(wallet.balance);
        const pendingWithdrawAgg = await tx.walletTransaction.aggregate({
            where: {
                walletId: wallet.id,
                transaction_type: 'WITHDRAW',
                status: 'PENDING',
            },
            _sum: { amount: true },
        });

        const pendingWithdrawAmount = toNumber(pendingWithdrawAgg?._sum?.amount);
        const availableBalance = currentBalance - pendingWithdrawAmount;

        if (availableBalance < amount) {
            const err = new Error('Số dư không đủ');
            err.statusCode = 400;
            throw err;
        }

        const transaction = await tx.walletTransaction.create({
            data: {
                walletId: wallet.id,
                transaction_type: 'WITHDRAW',
                status: 'PENDING',
                amount,
                description: description || 'Yêu cầu rút tiền từ ví',
            },
        });
        return { wallet, transaction };
    });

    return {
        message: 'Đã tạo yêu cầu rút tiền, chờ duyệt',
        data: {
            wallet: formatWallet(result.wallet),
            transaction: formatTransaction(result.transaction),
        },
    };
}

module.exports = {
    getMyWallet,
    getMyWalletTransactions,
    depositToWallet,
    withdrawFromWallet,
};
