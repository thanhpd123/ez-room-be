const prisma = require('../config/prisma');

const DEFAULT_CURRENCY = 'VND';

function toNumber(v) {
    if (v == null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function parsePositiveAmount(raw) {
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return Math.round(amount * 100) / 100;
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

async function getMyWallet(req, res) {
    try {
        const userId = req.auth.user.id;
        const wallet = await ensureWallet(userId);
        return res.json({
            success: true,
            data: formatWallet(wallet),
        });
    } catch (err) {
        console.error('Get wallet error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi tải ví',
            error: err.message,
        });
    }
}

async function getMyWalletTransactions(req, res) {
    try {
        const userId = req.auth.user.id;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 20), 100);
        const type = typeof req.query.type === 'string' ? req.query.type.trim().toUpperCase() : '';

        const wallet = await ensureWallet(userId);
        const where = { walletId: wallet.id };
        if (type) where.transaction_type = type;

        const [rows, total] = await Promise.all([
            prisma.walletTransaction.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma.walletTransaction.count({ where }),
        ]);

        return res.json({
            success: true,
            data: rows.map(formatTransaction),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('Get wallet transactions error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi tải lịch sử giao dịch',
            error: err.message,
        });
    }
}

async function depositToWallet(req, res) {
    try {
        const userId = req.auth.user.id;
        const amount = parsePositiveAmount(req.body?.amount);
        const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
        if (!amount) {
            return res.status(400).json({
                success: false,
                message: 'Số tiền nạp không hợp lệ',
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            const wallet = await ensureWallet(userId, tx);
            const updatedWallet = await tx.wallet.update({
                where: { id: wallet.id },
                data: {
                    balance: { increment: amount },
                },
            });
            const transaction = await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    transaction_type: 'DEPOSIT',
                    status: 'SUCCESS',
                    amount,
                    description: description || 'Nạp tiền ví (giả lập)',
                },
            });
            return { updatedWallet, transaction };
        });

        return res.json({
            success: true,
            message: 'Nạp tiền thành công (mô phỏng)',
            data: {
                wallet: formatWallet(result.updatedWallet),
                transaction: formatTransaction(result.transaction),
            },
        });
    } catch (err) {
        console.error('Wallet deposit error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi nạp tiền',
            error: err.message,
        });
    }
}

async function withdrawFromWallet(req, res) {
    try {
        const userId = req.auth.user.id;
        const amount = parsePositiveAmount(req.body?.amount);
        const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
        if (!amount) {
            return res.status(400).json({
                success: false,
                message: 'Số tiền rút không hợp lệ',
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            const wallet = await ensureWallet(userId, tx);
            const currentBalance = toNumber(wallet.balance);
            if (currentBalance < amount) {
                const err = new Error('Số dư không đủ');
                err.statusCode = 400;
                throw err;
            }

            const updatedWallet = await tx.wallet.update({
                where: { id: wallet.id },
                data: {
                    balance: { decrement: amount },
                },
            });
            const transaction = await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    transaction_type: 'WITHDRAW',
                    status: 'SUCCESS',
                    amount,
                    description: description || 'Rút tiền ví (giả lập)',
                },
            });
            return { updatedWallet, transaction };
        });

        return res.json({
            success: true,
            message: 'Rút tiền thành công (mô phỏng)',
            data: {
                wallet: formatWallet(result.updatedWallet),
                transaction: formatTransaction(result.transaction),
            },
        });
    } catch (err) {
        if (err.statusCode === 400) {
            return res.status(400).json({
                success: false,
                message: err.message || 'Yêu cầu không hợp lệ',
            });
        }
        console.error('Wallet withdraw error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi rút tiền',
            error: err.message,
        });
    }
}

module.exports = {
    getMyWallet,
    getMyWalletTransactions,
    depositToWallet,
    withdrawFromWallet,
};
