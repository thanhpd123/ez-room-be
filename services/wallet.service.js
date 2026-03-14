const prisma = require('../config/prisma');
const { getPayOSClient } = require('../config/payos');

const DEFAULT_CURRENCY = 'VND';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const WALLET_TOPUP_RECONCILE_WINDOW_MINUTES = 30;
const WALLET_TOPUP_RECONCILE_COOLDOWN_SECONDS = 60;

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

function mapPayOSOrderStatusToInternal(payosStatus) {
    const normalized = String(payosStatus || '').toUpperCase();
    if (normalized === 'PAID') return 'SUCCESS';
    if (normalized === 'CANCELLED' || normalized === 'CANCELED') return 'CANCELLED';
    if (normalized === 'EXPIRED') return 'EXPIRED';
    if (normalized === 'PENDING' || normalized === 'PROCESSING') return 'PENDING';
    return 'FAILED';
}

function mapOrderStatusToWalletTxStatus(orderStatus) {
    if (orderStatus === 'SUCCESS') return 'SUCCESS';
    if (orderStatus === 'CANCELLED' || orderStatus === 'EXPIRED') return 'CANCELLED';
    if (orderStatus === 'PENDING') return 'PENDING';
    return 'FAILED';
}

async function getPayOSPaymentByOrderCode(payos, orderCode) {
    if (payos?.paymentRequests?.get) {
        return payos.paymentRequests.get(orderCode);
    }

    if (payos?.paymentRequests?.getByOrderCode) {
        return payos.paymentRequests.getByOrderCode(orderCode);
    }

    throw new Error('SDK PayOS không hỗ trợ truy vấn theo orderCode');
}

async function syncPendingWalletTopups(userId, walletId) {
    const now = new Date();
    const pendingWindowStart = new Date(
        now.getTime() - WALLET_TOPUP_RECONCILE_WINDOW_MINUTES * 60 * 1000
    );
    const cooldownBefore = new Date(
        now.getTime() - WALLET_TOPUP_RECONCILE_COOLDOWN_SECONDS * 1000
    );

    let payos;
    try {
        payos = getPayOSClient();
    } catch (_) {
        // Không chặn API ví nếu thiếu cấu hình PayOS.
        return;
    }

    const pendingOrders = await prisma.payment_orders.findMany({
        where: {
            user_id: userId,
            purpose: 'WALLET_TOPUP',
            ref_id: walletId,
            status: 'PENDING',
            created_at: { gte: pendingWindowStart },
        },
        orderBy: { created_at: 'desc' },
        take: 10,
    });

    for (const order of pendingOrders) {
        // Claim lượt check để chống spam gọi PayOS khi user F5 liên tục.
        const claimed = await prisma.$executeRaw`
            UPDATE payment_orders po
            SET raw_ipn_payload = (
                COALESCE(po.raw_ipn_payload::jsonb, '{}'::jsonb)
                || jsonb_build_object(
                    '_reconcile',
                    jsonb_build_object(
                        'lastCheckedAt', ${now.toISOString()},
                        'source', 'wallet_reconcile_poll'
                    )
                )
            )::json
            WHERE po.id = ${order.id}::uuid
              AND po.status = 'PENDING'
              AND po.created_at >= ${pendingWindowStart}
              AND (
                    (po.raw_ipn_payload -> '_reconcile' ->> 'lastCheckedAt') IS NULL
                 OR ((po.raw_ipn_payload -> '_reconcile' ->> 'lastCheckedAt')::timestamptz <= ${cooldownBefore})
              )
        `;

        if (!claimed) continue;

        const orderCode = Number(order.vnp_txn_ref);
        if (!Number.isFinite(orderCode)) continue;

        let payosPayment;
        try {
            payosPayment = await getPayOSPaymentByOrderCode(payos, orderCode);
        } catch (_) {
            continue;
        }

        const internalStatus = mapPayOSOrderStatusToInternal(payosPayment?.status);
        if (internalStatus === 'PENDING') continue;

        try {
            await prisma.$transaction(async (tx) => {
                const orderUpdate = await tx.payment_orders.updateMany({
                    where: {
                        id: order.id,
                        status: 'PENDING',
                    },
                    data: {
                        status: internalStatus,
                    },
                });

                // Nếu order đã được webhook xử lý trước đó thì bỏ qua để tránh xử lý lặp.
                if (orderUpdate.count === 0) return;

                if (internalStatus === 'SUCCESS') {
                    const markedSuccess = await tx.walletTransaction.updateMany({
                        where: {
                            ref_type: 'WALLET_TOPUP',
                            ref_id: order.id,
                            status: 'PENDING',
                        },
                        data: {
                            status: 'SUCCESS',
                        },
                    });

                    if (markedSuccess.count > 0) {
                        await tx.wallet.update({
                            where: { id: walletId },
                            data: { balance: { increment: order.amount } },
                        });

                        await tx.notification.create({
                            data: {
                                userId: userId,
                                type: 'PAYMENT',
                                status: 'UNREAD',
                                title: 'Nạp ví thành công',
                                body: `Ví của bạn đã được cộng ${toNumber(order.amount).toLocaleString('vi-VN')} VND.`,
                            },
                        });
                    }
                } else {
                    await tx.walletTransaction.updateMany({
                        where: {
                            ref_type: 'WALLET_TOPUP',
                            ref_id: order.id,
                            status: 'PENDING',
                        },
                        data: {
                            status: mapOrderStatusToWalletTxStatus(internalStatus),
                        },
                    });
                }
            });
        } catch (_) {
            // Best-effort sync: lỗi 1 order không làm API ví thất bại.
            continue;
        }
    }
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
    await syncPendingWalletTopups(userId, wallet.id);
    const refreshedWallet = await prisma.wallet.findUnique({ where: { id: wallet.id } });
    return { data: formatWallet(refreshedWallet || wallet) };
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
    await syncPendingWalletTopups(userId, wallet.id);
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

/**
 * Xác minh nạp tiền ví từ return URL PayOS (dùng khi webhook không đến được localhost)
 */
async function verifyWalletDeposit(userId, orderCode) {
    if (!orderCode) {
        throw Object.assign(new Error('Thiếu orderCode'), { statusCode: 400 });
    }

    const order = await prisma.payment_orders.findUnique({
        where: { vnp_txn_ref: String(orderCode) },
    });

    if (!order) {
        throw Object.assign(new Error('Không tìm thấy giao dịch'), { statusCode: 404 });
    }

    if (order.user_id !== userId) {
        throw Object.assign(new Error('Không có quyền xác minh giao dịch này'), { statusCode: 403 });
    }

    if (order.purpose !== 'WALLET_TOPUP') {
        throw Object.assign(new Error('Giao dịch không phải nạp ví'), { statusCode: 400 });
    }

    // Idempotent: nếu đã SUCCESS thì trả về ngay
    if (order.status === 'SUCCESS') {
        const wallet = await prisma.wallet.findUnique({ where: { id: order.ref_id } });
        return {
            message: 'Giao dịch đã được xác nhận trước đó',
            data: { alreadyConfirmed: true, wallet: wallet ? formatWallet(wallet) : null },
        };
    }

    // Query PayOS để kiểm tra trạng thái thực tế
    const payos = getPayOSClient();
    let payosPayment;
    try {
        payosPayment = await getPayOSPaymentByOrderCode(payos, Number(orderCode));
    } catch (err) {
        throw Object.assign(
            new Error(`Không thể xác minh với PayOS: ${err.message}`),
            { statusCode: 502 }
        );
    }

    const payosStatus = String(payosPayment?.status || '').toUpperCase();
    const isPaid = payosStatus === 'PAID';

    if (!isPaid) {
        return {
            message: 'Giao dịch chưa được thanh toán',
            data: { confirmed: false, payosStatus },
        };
    }

    // Cập nhật DB trong transaction
    let updatedWallet = null;
    await prisma.$transaction(async (tx) => {
        // Kiểm tra lại để tránh race condition
        const latestOrder = await tx.payment_orders.findUnique({ where: { id: order.id } });
        if (!latestOrder || latestOrder.status === 'SUCCESS') {
            updatedWallet = await tx.wallet.findUnique({ where: { id: order.ref_id } });
            return;
        }

        await tx.payment_orders.update({
            where: { id: order.id },
            data: { status: 'SUCCESS' },
        });

        const walletTx = await tx.walletTransaction.findFirst({
            where: { ref_type: 'WALLET_TOPUP', ref_id: order.id },
        });

        if (walletTx && walletTx.status !== 'SUCCESS') {
            await tx.walletTransaction.update({
                where: { id: walletTx.id },
                data: { status: 'SUCCESS' },
            });

            const wallet = await tx.wallet.update({
                where: { id: order.ref_id },
                data: { balance: { increment: order.amount } },
            });
            updatedWallet = wallet;

            await tx.notification.create({
                data: {
                    userId: order.user_id,
                    type: 'PAYMENT',
                    status: 'UNREAD',
                    title: 'Nạp ví thành công',
                    body: `Ví của bạn đã được cộng ${toNumber(order.amount).toLocaleString('vi-VN')} VND.`,
                },
            });
        } else {
            updatedWallet = await tx.wallet.findUnique({ where: { id: order.ref_id } });
        }
    });

    return {
        message: 'Nạp tiền thành công',
        data: {
            confirmed: true,
            wallet: updatedWallet ? formatWallet(updatedWallet) : null,
        },
    };
}

module.exports = {
    getMyWallet,
    getMyWalletTransactions,
    depositToWallet,
    withdrawFromWallet,
    verifyWalletDeposit,
};
