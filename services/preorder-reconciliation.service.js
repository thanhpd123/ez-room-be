const prisma = require('../config/prisma');

const DEFAULT_INTERVAL_MS = Number(process.env.PREORDER_PAYOUT_RECONCILE_INTERVAL_MS || 3 * 60 * 1000);
const DEFAULT_BATCH_SIZE = Number(process.env.PREORDER_PAYOUT_RECONCILE_BATCH_SIZE || 100);

function toNumber(value) {
    if (value == null) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

async function ensureWallet(userId, txClient) {
    const wallet = await txClient.wallet.findUnique({ where: { userId } });
    if (wallet) return wallet;
    return txClient.wallet.create({
        data: {
            userId,
            balance: 0,
        },
    });
}

async function reconcilePreorderPayoutsOnce(options = {}) {
    const logger = options.logger || console;
    const batchSize = Math.max(1, Number(options.batchSize || DEFAULT_BATCH_SIZE));

    const successfulDepositOrders = await prisma.payment_orders.findMany({
        where: {
            purpose: 'PREORDER_DEPOSIT',
            status: 'SUCCESS',
            ref_type: 'PREORDER',
            ref_id: { not: null },
        },
        orderBy: { created_at: 'desc' },
        take: batchSize,
    });

    const summary = {
        scanned: successfulDepositOrders.length,
        fixed: 0,
        skipped: 0,
        errors: 0,
    };

    for (const order of successfulDepositOrders) {
        const preorderId = order.ref_id;
        if (!preorderId) {
            summary.skipped += 1;
            continue;
        }

        try {
            const result = await prisma.$transaction(async (tx) => {
                // Lock per preorder to avoid double-fix when multiple workers run in parallel.
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${preorderId}))`;

                const freshOrder = await tx.payment_orders.findUnique({ where: { id: order.id } });
                if (!freshOrder || freshOrder.status !== 'SUCCESS') {
                    return { fixed: false, reason: 'order_not_success' };
                }

                const preorder = await tx.preorder.findUnique({
                    where: { id: preorderId },
                    include: {
                        room: {
                            include: {
                                rentals: {
                                    select: {
                                        owner_id: true,
                                    },
                                },
                            },
                        },
                    },
                });

                if (!preorder) {
                    return { fixed: false, reason: 'preorder_not_found' };
                }

                if (preorder.status !== 'CONFIRMED' || preorder.payment_status !== 'PAID') {
                    return { fixed: false, reason: 'preorder_not_ready' };
                }

                const ownerId = preorder.room?.rentals?.owner_id;
                if (!ownerId) {
                    return { fixed: false, reason: 'landlord_not_found' };
                }

                const payoutAmount = toNumber(preorder.deposit_amount);
                if (payoutAmount <= 0) {
                    return { fixed: false, reason: 'invalid_payout_amount' };
                }

                const landlordWallet = await ensureWallet(ownerId, tx);

                const existingPayout = await tx.walletTransaction.findFirst({
                    where: {
                        walletId: landlordWallet.id,
                        transaction_type: 'PREORDER',
                        status: 'SUCCESS',
                        ref_type: 'PREORDER_PAYOUT',
                        ref_id: preorder.id,
                    },
                    select: { id: true },
                });

                if (existingPayout) {
                    return { fixed: false, reason: 'already_reconciled' };
                }

                await tx.wallet.update({
                    where: { id: landlordWallet.id },
                    data: {
                        balance: {
                            increment: payoutAmount,
                        },
                    },
                });

                await tx.walletTransaction.create({
                    data: {
                        walletId: landlordWallet.id,
                        transaction_type: 'PREORDER',
                        status: 'SUCCESS',
                        amount: payoutAmount,
                        description: `Reconcile payout preorder ${preorder.id}`,
                        ref_type: 'PREORDER_PAYOUT',
                        ref_id: preorder.id,
                    },
                });

                await tx.notification.create({
                    data: {
                        userId: ownerId,
                        type: 'PAYMENT',
                        status: 'UNREAD',
                        title: 'Đối soát tiền đặt cọc',
                        body: `Hệ thống đã đối soát và cộng ${payoutAmount.toLocaleString('vi-VN')} VND cho preorder ${preorder.id}.`,
                    },
                });

                return { fixed: true, reason: 'fixed' };
            });

            if (result.fixed) summary.fixed += 1;
            else summary.skipped += 1;
        } catch (error) {
            summary.errors += 1;
            logger.error('[preorder-reconcile] failed preorder payout reconcile', {
                preorderId,
                paymentOrderId: order.id,
                error: error?.message || String(error),
            });
        }
    }

    if (summary.fixed > 0 || summary.errors > 0) {
        logger.info('[preorder-reconcile] run summary', summary);
    }

    return summary;
}

function startPreorderPayoutReconciliationJob() {
    const enabled = String(process.env.PREORDER_PAYOUT_RECONCILE_ENABLED || 'true').toLowerCase() !== 'false';
    if (!enabled) {
        console.info('[preorder-reconcile] disabled via PREORDER_PAYOUT_RECONCILE_ENABLED=false');
        return null;
    }

    const intervalMs = Math.max(30000, Number(DEFAULT_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
    let running = false;

    const run = async () => {
        if (running) return;
        running = true;
        try {
            await reconcilePreorderPayoutsOnce();
        } catch (error) {
            console.error('[preorder-reconcile] run failed', error);
        } finally {
            running = false;
        }
    };

    setTimeout(() => {
        void run();
    }, 5000);

    const timer = setInterval(() => {
        void run();
    }, intervalMs);

    if (typeof timer.unref === 'function') timer.unref();

    console.info(`[preorder-reconcile] started, interval=${intervalMs}ms`);

    return {
        stop: () => clearInterval(timer),
        runNow: run,
    };
}

module.exports = {
    reconcilePreorderPayoutsOnce,
    startPreorderPayoutReconciliationJob,
};
