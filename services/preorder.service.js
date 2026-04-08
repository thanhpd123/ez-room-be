const prisma = require('../config/prisma');
const { getPayOSClient } = require('../config/payos');
const vipService = require('./vip.service');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const PREORDER_DEFAULT_DEPOSIT_PERCENT = Number(process.env.PREORDER_DEFAULT_DEPOSIT_PERCENT || 30);
const PREORDER_MIN_DEPOSIT_PERCENT = Number(process.env.PREORDER_MIN_DEPOSIT_PERCENT || 5);
const PREORDER_MAX_DEPOSIT_PERCENT = Number(process.env.PREORDER_MAX_DEPOSIT_PERCENT || 80);
const PREORDER_DEPOSIT_PERCENT_BASE_MONTHS = Number(process.env.PREORDER_DEPOSIT_PERCENT_BASE_MONTHS || 12);

const SYSTEM_SETTING_PREORDER_DEPOSIT_KEY = 'preorder.deposit';
const SYSTEM_SETTING_PLATFORM_COMMISSION_KEY = 'platform.commission';

function toNumber(value) {
    if (value == null) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function parseDepositAmount(rawAmount) {
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (!Number.isInteger(amount)) return null;
    return amount;
}

function parseDepositPercent(rawPercent) {
    const percent = Number(rawPercent);
    if (!Number.isFinite(percent) || percent <= 0) return null;
    if (percent >= 100) return null;
    return Math.round(percent * 100) / 100;
}

function clampDepositPercentConfig(overrides = null) {
    const minOverride = overrides && Number.isFinite(Number(overrides.minPercent))
        ? Number(overrides.minPercent)
        : null;
    const maxOverride = overrides && Number.isFinite(Number(overrides.maxPercent))
        ? Number(overrides.maxPercent)
        : null;
    const defaultOverride = overrides && Number.isFinite(Number(overrides.defaultPercent))
        ? Number(overrides.defaultPercent)
        : null;

    const min = minOverride != null
        ? minOverride
        : (Number.isFinite(PREORDER_MIN_DEPOSIT_PERCENT) ? PREORDER_MIN_DEPOSIT_PERCENT : 5);
    const max = maxOverride != null
        ? maxOverride
        : (Number.isFinite(PREORDER_MAX_DEPOSIT_PERCENT) ? PREORDER_MAX_DEPOSIT_PERCENT : 80);
    const safeMin = Math.max(0.01, Math.min(min, 99.99));
    const safeMax = Math.max(safeMin, Math.min(max, 99.99));
    const safeDefault = defaultOverride != null
        ? defaultOverride
        : (Number.isFinite(PREORDER_DEFAULT_DEPOSIT_PERCENT) ? PREORDER_DEFAULT_DEPOSIT_PERCENT : 30);
    const defaultPercent = Math.max(safeMin, Math.min(safeDefault, safeMax));
    return { min: safeMin, max: safeMax, defaultPercent };
}

function computeDepositAmountByPercent(roomPrice, depositPercent) {
    const computed = Math.round((roomPrice * depositPercent) / 100);
    return Number.isFinite(computed) && computed > 0 ? computed : 0;
}

function parseDepositMonths(rawMonths) {
    const months = Number(rawMonths);
    if (!Number.isFinite(months) || months <= 0) return null;
    return Math.round(months * 100) / 100;
}

function convertMonthsToPercent(months, baseMonthsOverride) {
    const baseMonths = Number.isFinite(Number(baseMonthsOverride))
        ? Number(baseMonthsOverride)
        : (Number.isFinite(PREORDER_DEPOSIT_PERCENT_BASE_MONTHS)
            ? PREORDER_DEPOSIT_PERCENT_BASE_MONTHS
            : 12);
    const safeBaseMonths = Math.max(1, baseMonths);
    return Math.round(((months / safeBaseMonths) * 100) * 100) / 100;
}

async function getPreorderDepositSettings() {
    try {
        const row = await prisma.systemSetting.findUnique({
            where: { key: SYSTEM_SETTING_PREORDER_DEPOSIT_KEY },
            select: { value_json: true },
        });
        const cfg = row?.value_json;
        if (!cfg || typeof cfg !== 'object') return null;

        const minPercent = Number(cfg.minPercent);
        const maxPercent = Number(cfg.maxPercent);
        const defaultPercent = Number(cfg.defaultPercent);
        const baseMonths = Number(cfg.baseMonths);

        if (!Number.isFinite(minPercent) || !Number.isFinite(maxPercent) || !Number.isFinite(defaultPercent)) {
            return null;
        }

        return {
            minPercent,
            maxPercent,
            defaultPercent,
            baseMonths: Number.isFinite(baseMonths) ? baseMonths : null,
        };
    } catch (err) {
        // Fallback to env-driven settings if DB settings are not available.
        return null;
    }
}

async function getPlatformPreorderFeeBps(txClient) {
    const fallback = Math.max(0, Math.min(10000, Math.round(Number(process.env.PLATFORM_PREORDER_FEE_BPS || 0))));
    try {
        const row = await txClient.systemSetting.findUnique({
            where: { key: SYSTEM_SETTING_PLATFORM_COMMISSION_KEY },
            select: { value_json: true },
        });
        const bps = Number(row?.value_json?.preorderFeeBps);
        if (!Number.isFinite(bps)) return fallback;
        return Math.max(0, Math.min(10000, Math.round(bps)));
    } catch {
        return fallback;
    }
}

function computeFeeAndPayout(amountVnd, feeBps) {
    const amount = Math.max(0, Math.round(Number(amountVnd) || 0));
    const bps = Math.max(0, Math.min(10000, Math.round(Number(feeBps) || 0)));
    const fee = Math.max(0, Math.min(amount, Math.round((amount * bps) / 10000)));
    const payout = Math.max(0, amount - fee);
    return { feeAmount: fee, payoutAmount: payout, feeBps: bps };
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

/**
 * Refund a PAID PENDING preorder to the tenant wallet (must run inside prisma.$transaction).
 */
async function refundPaidPreorderToTenantInTx(tx, preorderId, options) {
    const {
        actingUserId,
        paymentRefundReason,
        cancelReasonNote = null,
        notificationTitle,
        notificationBody,
    } = options;

    const latest = await tx.preorder.findUnique({ where: { id: preorderId } });
    if (!latest || latest.status !== 'PENDING' || latest.payment_status !== 'PAID') {
        throw Object.assign(new Error('Không thể hoàn tiền cho trạng thái preorder này'), {
            statusCode: 400,
        });
    }

    const refundAmount = toNumber(latest.deposit_amount);
    if (refundAmount <= 0) {
        throw Object.assign(new Error('Không tìm thấy số tiền cọc hợp lệ để hoàn'), {
            statusCode: 400,
        });
    }

    const tenantWallet = await ensureWallet(latest.userId, tx);

    await tx.wallet.update({
        where: { id: tenantWallet.id },
        data: { balance: { increment: refundAmount } },
    });

    await tx.walletTransaction.create({
        data: {
            walletId: tenantWallet.id,
            transaction_type: 'REFUND',
            status: 'SUCCESS',
            amount: refundAmount,
            description: `Hoàn cọc preorder ${latest.id}${cancelReasonNote ? ` - ${cancelReasonNote}` : ''}`,
            ref_type: 'PREORDER_REFUND',
            ref_id: latest.id,
        },
    });

    await tx.payment_orders.updateMany({
        where: {
            purpose: 'PREORDER_DEPOSIT',
            ref_type: 'PREORDER',
            ref_id: latest.id,
            status: 'SUCCESS',
        },
        data: {
            vnp_refund_status: 'SUCCESS',
            refund_amount: refundAmount,
            refund_reason: paymentRefundReason,
            refund_requested_at: new Date(),
            refund_completed_at: new Date(),
            refund_requested_by: actingUserId,
        },
    });

    await tx.preorder.update({
        where: { id: latest.id },
        data: {
            status: 'CANCELLED',
            payment_status: 'REFUNDED',
            refund_status: 'REFUNDED',
            refund_amount: refundAmount,
            refunded_at: new Date(),
            cancel_reason: cancelReasonNote,
        },
    });

    await tx.notification.create({
        data: {
            userId: latest.userId,
            type: 'PAYMENT',
            status: 'UNREAD',
            title: notificationTitle,
            body: notificationBody,
        },
    });
}

/**
 * Cancel an UNPAID PENDING preorder when another tenant wins (inside transaction).
 */
async function cancelUnpaidCompetitorPreorderInTx(tx, preorderId, cancelReason) {
    const p = await tx.preorder.findUnique({ where: { id: preorderId } });
    if (!p || p.status !== 'PENDING' || p.payment_status !== 'UNPAID') {
        return;
    }

    await tx.preorder.update({
        where: { id: preorderId },
        data: {
            status: 'CANCELLED',
            payment_status: 'UNPAID',
            refund_status: 'NOT_APPLICABLE',
            cancel_reason: cancelReason,
        },
    });

    await tx.payment_orders.updateMany({
        where: {
            ref_type: 'PREORDER',
            ref_id: preorderId,
            purpose: 'PREORDER_DEPOSIT',
            status: 'PENDING',
        },
        data: {
            status: 'CANCELLED',
        },
    });

    await tx.notification.create({
        data: {
            userId: p.userId,
            type: 'PREORDER',
            status: 'UNREAD',
            title: 'Yêu cầu đặt cọc đã đóng',
            body: 'Chủ trọ đã chọn người thuê khác; yêu cầu chưa thanh toán của bạn đã được đóng.',
        },
    });
}

function buildPayOSRedirectUrl(type, preorderId) {
    const base = (type === 'cancel' ? process.env.PAYOS_CANCEL_URL : process.env.PAYOS_RETURN_URL)
        || `${FRONTEND_URL.replace(/\/$/, '')}/payment/payos-result`;
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}preorderId=${encodeURIComponent(preorderId)}&type=${type}`;
}

function buildPayOSDescription(preorderId) {
    const suffix = String(preorderId || '').replace(/-/g, '').slice(-8).toUpperCase();
    return `EZROOM DC ${suffix}`.slice(0, 25);
}

function generateOrderCode() {
    return Number(`${Date.now()}${Math.floor(Math.random() * 90) + 10}`);
}

function mapPreorderItem(p) {
    return {
        id: p.id,
        userId: p.userId,
        roomId: p.roomId,
        status: p.status,
        paymentStatus: p.payment_status,
        depositAmount: toNumber(p.deposit_amount),
        refundStatus: p.refund_status,
        createdAt: p.createdAt,
        cancelReason: p.cancel_reason || null,
        user: p.user || null,
        room: p.room
            ? {
                id: p.room.id,
                room_name: p.room.room_name,
                price: toNumber(p.room.price),
            }
            : null,
        rental: p.room?.rentals
            ? {
                id: p.room.rentals.id,
                title: p.room.rentals.title,
            }
            : null,
    };
}

function mapPaymentOrderStatus(webhookData) {
    const code = String(webhookData?.data?.code || webhookData?.code || '').toUpperCase();
    const success = webhookData?.success === true || code === '00';

    if (success) return 'SUCCESS';

    const desc = String(webhookData?.desc || webhookData?.data?.desc || '').toLowerCase();
    if (desc.includes('cancel')) return 'CANCELLED';
    if (desc.includes('expire')) return 'EXPIRED';
    return 'FAILED';
}

function mapPayOSOrderStatusToInternal(payosStatus) {
    const normalized = String(payosStatus || '').toUpperCase();
    if (normalized === 'PAID' || normalized === 'SUCCESS') return 'SUCCESS';
    if (normalized === 'CANCELLED' || normalized === 'CANCELED') return 'CANCELLED';
    if (normalized === 'EXPIRED') return 'EXPIRED';
    if (normalized === 'PENDING' || normalized === 'PROCESSING') return 'PENDING';
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
function mapWalletTxnStatus(orderStatus) {
    if (orderStatus === 'SUCCESS') return 'SUCCESS';
    if (orderStatus === 'CANCELLED' || orderStatus === 'EXPIRED') return 'CANCELLED';
    return 'FAILED';
}

function mapPayOSPaymentLinkStatusToOrderStatus(linkStatusRaw) {
    const s = String(linkStatusRaw || '').toUpperCase();
    if (s === 'PAID' || s === 'SUCCESS') return 'SUCCESS';
    if (s === 'CANCELLED' || s === 'CANCELED') return 'CANCELLED';
    if (s === 'EXPIRED') return 'EXPIRED';
    if (s === 'PENDING' || s === 'PROCESSING') return 'PENDING';
    return 'FAILED';
}

/**
 * Tenant tạo yêu cầu đặt cọc và link thanh toán PayOS
 */
async function createDepositPayment(userId, body) {
    const roomId = String(body?.roomId || '').trim();
    const rawDepositMonths = body?.depositMonths;
    const rawDepositPercent = body?.depositPercent;
    const rawDepositAmount = body?.depositAmount;

    if (!roomId) {
        throw Object.assign(new Error('Thiếu roomId'), { statusCode: 400 });
    }

    const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: { rentals: { select: { owner_id: true, title: true } } },
    });

    if (!room) {
        throw Object.assign(new Error('Phòng không tồn tại'), { statusCode: 404 });
    }

    if (room.status !== 'AVAILABLE') {
        throw Object.assign(new Error('Phòng hiện không khả dụng để đặt cọc'), { statusCode: 400 });
    }

    if (room.rentals?.owner_id === userId) {
        throw Object.assign(new Error('Không thể tự đặt cọc phòng của chính bạn'), { statusCode: 400 });
    }

    const roomPrice = toNumber(room.price);
    if (roomPrice <= 0) {
        throw Object.assign(new Error('Giá phòng không hợp lệ để tính tiền đặt cọc'), {
            statusCode: 400,
        });
    }

    const depositSettings = await getPreorderDepositSettings();
    const { min, max, defaultPercent } = clampDepositPercentConfig(depositSettings);

    let depositPercent;
    let depositMonths = null;
    if (rawDepositAmount != null && String(rawDepositAmount).trim() !== '') {
        const requestedAmount = parseDepositAmount(rawDepositAmount);
        if (!requestedAmount) {
            throw Object.assign(new Error('Số tiền đặt cọc phải là số nguyên dương (VND)'), {
                statusCode: 400,
            });
        }
        depositPercent = Math.round(((requestedAmount / roomPrice) * 100) * 100) / 100;
    } else if (rawDepositMonths != null && String(rawDepositMonths).trim() !== '') {
        depositMonths = parseDepositMonths(rawDepositMonths);
        if (!depositMonths) {
            throw Object.assign(new Error('Số tháng đặt cọc phải là số dương'), {
                statusCode: 400,
            });
        }
        depositPercent = convertMonthsToPercent(depositMonths, depositSettings?.baseMonths);
    } else if (rawDepositPercent != null && String(rawDepositPercent).trim() !== '') {
        depositPercent = parseDepositPercent(rawDepositPercent);
        if (!depositPercent) {
            throw Object.assign(
                new Error('Phần trăm đặt cọc phải là số dương và nhỏ hơn 100%'),
                { statusCode: 400 }
            );
        }
    } else {
        depositPercent = defaultPercent;
    }

    if (!Number.isFinite(depositPercent) || depositPercent <= 0) {
        throw Object.assign(new Error('Không thể xác định phần trăm đặt cọc hợp lệ'), {
            statusCode: 400,
        });
    }

    if (depositPercent >= 100) {
        throw Object.assign(new Error('Tiền đặt cọc không được bằng hoặc vượt 100% giá phòng'), {
            statusCode: 400,
        });
    }

    if (depositPercent < min || depositPercent > max) {
        throw Object.assign(
            new Error(`Phần trăm đặt cọc phải nằm trong khoảng ${min}% - ${max}%`),
            { statusCode: 400 }
        );
    }

    const depositAmount = computeDepositAmountByPercent(roomPrice, depositPercent);
    if (depositAmount <= 0 || depositAmount >= roomPrice) {
        throw Object.assign(new Error('Số tiền đặt cọc sau khi tính theo phần trăm không hợp lệ'), {
            statusCode: 400,
        });
    }

    const payos = getPayOSClient();
    const orderCode = generateOrderCode();

    const created = await prisma.$transaction(async (tx) => {
        const depositLockKey = `${userId}:${roomId}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${depositLockKey}))`;

        const existing = await tx.preorder.findFirst({
            where: {
                userId,
                roomId,
                status: { in: ['PENDING', 'CONFIRMED'] },
                payment_status: { in: ['UNPAID', 'PAID'] },
            },
        });

        if (existing) {
            throw Object.assign(new Error('Bạn đã có yêu cầu đặt cọc đang hoạt động cho phòng này'), {
                statusCode: 409,
            });
        }

        const roomNow = await tx.rooms.findUnique({
            where: { id: roomId },
            select: {
                id: true,
                status: true,
                rentals: { select: { owner_id: true } },
            },
        });

        if (!roomNow || roomNow.status !== 'AVAILABLE') {
            throw Object.assign(new Error('Phòng hiện không khả dụng để đặt cọc'), {
                statusCode: 400,
            });
        }

        if (roomNow.rentals?.owner_id === userId) {
            throw Object.assign(new Error('Không thể tự đặt cọc phòng của chính bạn'), {
                statusCode: 400,
            });
        }

        const preorder = await tx.preorder.create({
            data: {
                userId,
                roomId,
                status: 'PENDING',
                payment_status: 'UNPAID',
                deposit_amount: depositAmount,
                refund_status: 'NOT_APPLICABLE',
            },
        });

        const paymentOrder = await tx.payment_orders.create({
            data: {
                user_id: userId,
                vnp_txn_ref: String(orderCode),
                amount: depositAmount,
                purpose: 'PREORDER_DEPOSIT',
                status: 'PENDING',
                ref_type: 'PREORDER',
                ref_id: preorder.id,
            },
        });

        return { preorder, paymentOrder };
    });

    try {
        const paymentLink = await payos.paymentRequests.create({
            orderCode,
            amount: depositAmount,
            description: buildPayOSDescription(created.preorder.id),
            returnUrl: buildPayOSRedirectUrl('return', created.preorder.id),
            cancelUrl: buildPayOSRedirectUrl('cancel', created.preorder.id),
            buyerName: body?.buyerName || undefined,
            buyerEmail: body?.buyerEmail || undefined,
            buyerPhone: body?.buyerPhone || undefined,
        });

        // Persist checkoutUrl + paymentLinkId so "resume payment" can retrieve them later
        await prisma.payment_orders.update({
            where: { id: created.paymentOrder.id },
            data: {
                raw_ipn_payload: {
                    step: 'created',
                    checkoutUrl: paymentLink?.checkoutUrl || null,
                    paymentLinkId: paymentLink?.paymentLinkId || null,
                    qrCode: paymentLink?.qrCode || null,
                },
            },
        });

        return {
            message: 'Tạo link thanh toán đặt cọc thành công',
            data: {
                preorderId: created.preorder.id,
                roomId,
                depositAmount,
                depositPercent,
                ...(depositMonths != null ? { depositMonths } : {}),
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
                where: { id: created.paymentOrder.id },
                data: {
                    status: 'FAILED',
                    raw_ipn_payload: {
                        step: 'create_payment_link',
                        error: err?.message || 'Unknown error',
                    },
                },
            });

            await tx.preorder.update({
                where: { id: created.preorder.id },
                data: {
                    status: 'CANCELLED',
                    cancel_reason: 'PAYOS_CREATE_LINK_FAILED',
                },
            });
        });

        throw Object.assign(new Error(`Không thể tạo link thanh toán PayOS: ${err.message}`), {
            statusCode: 502,
        });
    }
}

/**
 * Tenant xem danh sách preorder của mình
 */
async function getMyPreorders(userId, params) {
    const { status, paymentStatus, page = 1, limit = 20 } = params;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
    const where = { userId };

    if (status && status !== 'ALL' && status !== 'all') {
        where.status = status;
    }

    if (paymentStatus && paymentStatus !== 'ALL' && paymentStatus !== 'all') {
        where.payment_status = paymentStatus;
    }

    const [preorders, total] = await Promise.all([
        prisma.preorder.findMany({
            where,
            include: {
                room: {
                    select: {
                        id: true,
                        room_name: true,
                        price: true,
                        rentals: {
                            select: { id: true, title: true },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            skip: (pageNum - 1) * limitNum,
            take: limitNum,
        }),
        prisma.preorder.count({ where }),
    ]);

    return {
        data: preorders.map(mapPreorderItem),
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
        },
    };
}

/**
 * Webhook PayOS cập nhật trạng thái thanh toán (đặt cọc + nạp ví)
 */
async function handlePayOSWebhook(payload) {
    const payos = getPayOSClient();
    const verifiedPayload = await payos.webhooks.verify(payload);
    const eventData = verifiedPayload?.data || {};
    const orderCode = String(eventData?.orderCode || '').trim();

    if (!orderCode) {
        throw Object.assign(new Error('Webhook thiếu orderCode'), { statusCode: 400 });
    }

    const order = await prisma.payment_orders.findUnique({
        where: { vnp_txn_ref: orderCode },
    });

    if (!order) {
        return {
            acknowledged: true,
            updated: false,
            message: 'Order không tồn tại trong hệ thống',
        };
    }

    const nextStatus = mapPaymentOrderStatus(verifiedPayload);

    await prisma.$transaction(async (tx) => {
        const latestOrder = await tx.payment_orders.findUnique({
            where: { id: order.id },
        });

        if (!latestOrder) return;

        // Idempotency: once order SUCCESS, do not downgrade status on duplicated callbacks.
        const finalOrderStatus = latestOrder.status === 'SUCCESS' ? 'SUCCESS' : nextStatus;

        await tx.payment_orders.update({
            where: { id: latestOrder.id },
            data: {
                status: finalOrderStatus,
                vnp_transaction_no: eventData?.reference ? String(eventData.reference) : latestOrder.vnp_transaction_no,
                vnp_bank_code: eventData?.counterAccountBankId || latestOrder.vnp_bank_code,
                vnp_pay_date: eventData?.transactionDateTime || latestOrder.vnp_pay_date,
                vnp_response_code: eventData?.code || verifiedPayload?.code || latestOrder.vnp_response_code,
                raw_ipn_payload: payload,
            },
        });

        if (latestOrder.purpose === 'PREORDER_DEPOSIT' && latestOrder.ref_id) {
            if (finalOrderStatus === 'SUCCESS') {
                const preorder = await tx.preorder.findUnique({
                    where: { id: latestOrder.ref_id },
                    select: { payment_status: true },
                });

                if (preorder && preorder.payment_status !== 'PAID') {
                    await tx.preorder.update({
                        where: { id: latestOrder.ref_id },
                        data: {
                            payment_status: 'PAID',
                            status: 'PENDING',
                        },
                    });

                    await tx.notification.create({
                        data: {
                            userId: latestOrder.user_id,
                            type: 'PREORDER',
                            status: 'UNREAD',
                            title: 'Đặt cọc thành công',
                            body: 'Thanh toán đặt cọc của bạn đã được ghi nhận. Chờ chủ trọ xác nhận yêu cầu.',
                        },
                    });
                }
            } else if (finalOrderStatus !== 'PENDING') {
                await tx.preorder.update({
                    where: { id: latestOrder.ref_id },
                    data: {
                        payment_status: 'UNPAID',
                        status: 'CANCELLED',
                        cancel_reason: `PAYOS_${finalOrderStatus}`,
                    },
                });
            }
        }

        if (latestOrder.purpose === 'WALLET_TOPUP' && latestOrder.ref_id) {
            const walletTx = await tx.walletTransaction.findFirst({
                where: {
                    ref_type: 'WALLET_TOPUP',
                    ref_id: latestOrder.id,
                },
            });

            if (walletTx) {
                if (finalOrderStatus === 'SUCCESS') {
                    const markedSuccess = await tx.walletTransaction.updateMany({
                        where: {
                            id: walletTx.id,
                            status: { not: 'SUCCESS' },
                        },
                        data: {
                            status: 'SUCCESS',
                            description: walletTx.description || 'Nạp tiền ví qua PayOS',
                        },
                    });

                    if (markedSuccess.count > 0) {
                        await tx.wallet.update({
                            where: { id: latestOrder.ref_id },
                            data: { balance: { increment: latestOrder.amount } },
                        });

                        await tx.notification.create({
                            data: {
                                userId: latestOrder.user_id,
                                type: 'PAYMENT',
                                status: 'UNREAD',
                                title: 'Nạp ví thành công',
                                body: `Ví của bạn đã được cộng ${toNumber(latestOrder.amount).toLocaleString('vi-VN')} VND.`,
                            },
                        });
                    }
                } else if (walletTx.status !== 'SUCCESS' && finalOrderStatus !== 'PENDING') {
                    await tx.walletTransaction.update({
                        where: { id: walletTx.id },
                        data: {
                            status: mapWalletTxnStatus(finalOrderStatus),
                        },
                    });
                }
            }
        }

        if (latestOrder.purpose === 'VIP_PURCHASE') {
            const wasSuccess = latestOrder.status === 'SUCCESS';
            if (!wasSuccess && finalOrderStatus === 'SUCCESS') {
                await vipService.activateVipFromPaymentOrder(tx, latestOrder);
            }
        }
    });

    return {
        acknowledged: true,
        updated: true,
        status: nextStatus,
        orderCode,
    };
}

/**
 * Lấy danh sách yêu cầu thuê cho landlord
 */
async function getLandlordRequests(landlordId, params) {
    const { status, search, page = 1, limit = 20 } = params;

    const whereClause = {
        room: {
            rentals: {
                owner_id: landlordId,
            },
        },
    };

    if (status && status !== 'ALL' && status !== 'all') {
        whereClause.status = status;
    }

    if (search) {
        whereClause.OR = [
            { user: { fullName: { contains: search, mode: 'insensitive' } } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { room: { room_name: { contains: search, mode: 'insensitive' } } },
            { room: { rentals: { title: { contains: search, mode: 'insensitive' } } } },
        ];
    }

    const preorders = await prisma.preorder.findMany({
        where: whereClause,
        select: {
            id: true,
            userId: true,
            roomId: true,
            status: true,
            payment_status: true,
            deposit_amount: true,
            refund_status: true,
            cancel_reason: true,
            createdAt: true,
            user: {
                select: {
                    id: true,
                    fullName: true,
                    email: true,
                    phone: true,
                    avatarUrl: true,
                },
            },
            room: {
                select: {
                    id: true,
                    room_name: true,
                    price: true,
                    rentals: {
                        select: { id: true, title: true },
                    },
                },
            },
        },
        orderBy: { createdAt: 'desc' },
        skip: Math.max(0, (Math.max(1, parseInt(String(page), 10) || 1) - 1) * Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20))),
        take: Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20)),
    });

    return {
        data: preorders.map(mapPreorderItem),
    };
}

/**
 * Landlord xác nhận yêu cầu thuê
 */
async function confirmRequest(preorderId, landlordId) {
    const updated = await prisma.$transaction(async (tx) => {
        // Lock theo preorder để tránh race-condition khi confirm đồng thời.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${preorderId}))`;

        let preorder = await tx.preorder.findUnique({
            where: { id: preorderId },
            include: {
                room: { include: { rentals: true } },
            },
        });

        if (!preorder) {
            throw Object.assign(new Error('Yêu cầu không tồn tại'), { statusCode: 404 });
        }

        if (!preorder.room?.rentals) {
            throw Object.assign(new Error('Dữ liệu phòng không hợp lệ'), { statusCode: 400 });
        }
        if (preorder.room.rentals.owner_id !== landlordId) {
            throw Object.assign(new Error('Bạn không có quyền xác nhận yêu cầu này'), {
                statusCode: 403,
            });
        }

        // Serialize confirms for the same room (competing preorders).
        await tx.$executeRawUnsafe(
            'SELECT pg_advisory_xact_lock(hashtext($1::text))',
            preorder.roomId
        );

        preorder = await tx.preorder.findUnique({
            where: { id: preorderId },
            include: {
                room: { include: { rentals: true } },
            },
        });
        if (!preorder) {
            throw Object.assign(new Error('Yêu cầu không tồn tại'), { statusCode: 404 });
        }
        if (!preorder.room?.rentals) {
            throw Object.assign(new Error('Dữ liệu phòng không hợp lệ'), { statusCode: 400 });
        }
        if (preorder.room.rentals.owner_id !== landlordId) {
            throw Object.assign(new Error('Bạn không có quyền xác nhận yêu cầu này'), {
                statusCode: 403,
            });
        }

        const feeBps = await getPlatformPreorderFeeBps(tx);
        const grossDepositAmount = toNumber(preorder.deposit_amount);
        const computed = computeFeeAndPayout(grossDepositAmount, feeBps);

        if (preorder.status === 'CONFIRMED') {
            // Backfill commission fields + ledger entry if missing (idempotent).
            if (preorder.commission_rate_bps == null || preorder.platform_fee_amount == null || preorder.landlord_payout_amount == null || preorder.payout_at == null) {
                await tx.preorder.update({
                    where: { id: preorder.id },
                    data: {
                        commission_rate_bps: preorder.commission_rate_bps ?? computed.feeBps,
                        platform_fee_amount: preorder.platform_fee_amount ?? computed.feeAmount,
                        landlord_payout_amount: preorder.landlord_payout_amount ?? computed.payoutAmount,
                        payout_at: preorder.payout_at ?? new Date(),
                    },
                });
            }

            if (computed.feeAmount > 0) {
                const existingFee = await tx.platformLedgerEntry.findFirst({
                    where: {
                        entry_type: 'PREORDER_FEE',
                        ref_type: 'PREORDER',
                        ref_id: preorder.id,
                    },
                    select: { id: true },
                });
                if (!existingFee) {
                    await tx.platformLedgerEntry.create({
                        data: {
                            entry_type: 'PREORDER_FEE',
                            amount: computed.feeAmount,
                            ref_type: 'PREORDER',
                            ref_id: preorder.id,
                            created_by: landlordId,
                        },
                    });
                }
            }

            return preorder;
        }

        if (preorder.status !== 'PENDING') {
            throw Object.assign(new Error('Chỉ có thể xác nhận yêu cầu đang chờ'), { statusCode: 400 });
        }

        if (preorder.payment_status !== 'PAID') {
            throw Object.assign(new Error('Chỉ có thể xác nhận yêu cầu đã thanh toán đặt cọc'), {
                statusCode: 400,
            });
        }

        if (preorder.room.status !== 'AVAILABLE') {
            throw Object.assign(
                new Error('Phòng không còn ở trạng thái cho phép xác nhận đặt cọc'),
                { statusCode: 400 }
            );
        }

        if (grossDepositAmount <= 0) {
            throw Object.assign(new Error('Không tìm thấy tiền cọc hợp lệ để chuyển cho chủ trọ'), {
                statusCode: 400,
            });
        }

        const landlordWallet = await ensureWallet(landlordId, tx);

        const existingPayoutTxn = await tx.walletTransaction.findFirst({
            where: {
                walletId: landlordWallet.id,
                transaction_type: 'PREORDER',
                status: 'SUCCESS',
                ref_type: 'PREORDER_PAYOUT',
                ref_id: preorder.id,
            },
            select: { id: true },
        });

        if (!existingPayoutTxn) {
            await tx.wallet.update({
                where: { id: landlordWallet.id },
                data: { balance: { increment: computed.payoutAmount } },
            });

            await tx.walletTransaction.create({
                data: {
                    walletId: landlordWallet.id,
                    transaction_type: 'PREORDER',
                    status: 'SUCCESS',
                    amount: computed.payoutAmount,
                    description: `Nhận tiền đặt cọc preorder ${preorder.id} (phí ${computed.feeAmount.toLocaleString('vi-VN')} VND)`,
                    ref_type: 'PREORDER_PAYOUT',
                    ref_id: preorder.id,
                },
            });

            if (computed.feeAmount > 0) {
                const existingFee = await tx.platformLedgerEntry.findFirst({
                    where: {
                        entry_type: 'PREORDER_FEE',
                        ref_type: 'PREORDER',
                        ref_id: preorder.id,
                    },
                    select: { id: true },
                });
                if (!existingFee) {
                    await tx.platformLedgerEntry.create({
                        data: {
                            entry_type: 'PREORDER_FEE',
                            amount: computed.feeAmount,
                            ref_type: 'PREORDER',
                            ref_id: preorder.id,
                            created_by: landlordId,
                        },
                    });
                }
            }

            await tx.notification.create({
                data: {
                    userId: landlordId,
                    type: 'PAYMENT',
                    status: 'UNREAD',
                    title: 'Bạn nhận được tiền đặt cọc',
                    body: `Ví của bạn đã được cộng ${computed.payoutAmount.toLocaleString('vi-VN')} VND từ yêu cầu thuê ${preorder.id}.`,
                },
            });
        }

        const confirmed = await tx.preorder.update({
            where: { id: preorderId },
            data: {
                status: 'CONFIRMED',
                refund_status: 'NOT_APPLICABLE',
                commission_rate_bps: computed.feeBps,
                platform_fee_amount: computed.feeAmount,
                landlord_payout_amount: computed.payoutAmount,
                payout_at: new Date(),
            },
        });

        await tx.notification.create({
            data: {
                userId: preorder.userId,
                type: 'PREORDER',
                status: 'UNREAD',
                title: 'Yêu cầu đặt cọc đã được xác nhận',
                body: 'Chủ trọ đã xác nhận yêu cầu của bạn. Tiền đặt cọc đã được ghi nhận cho chủ trọ.',
            },
        });

        const competitors = await tx.preorder.findMany({
            where: {
                roomId: preorder.roomId,
                status: 'PENDING',
                id: { not: preorderId },
            },
            select: { id: true, payment_status: true },
        });

        for (const row of competitors) {
            if (row.payment_status === 'PAID') {
                const comp = await tx.preorder.findUnique({
                    where: { id: row.id },
                    select: { deposit_amount: true },
                });
                const refundAmt = toNumber(comp?.deposit_amount);
                await refundPaidPreorderToTenantInTx(tx, row.id, {
                    actingUserId: landlordId,
                    paymentRefundReason: 'ROOM_AWARDED_TO_OTHER_TENANT',
                    cancelReasonNote: 'ROOM_AWARDED_TO_OTHER_TENANT',
                    notificationTitle: 'Da hoan coc — chu tro chon nguoi thue khac',
                    notificationBody: `Chu tro da xac nhan nguoi thue khac. Ban da duoc hoan ${refundAmt.toLocaleString('vi-VN')} VND vao vi noi bo.`,
                });
            } else if (row.payment_status === 'UNPAID') {
                await cancelUnpaidCompetitorPreorderInTx(
                    tx,
                    row.id,
                    'ROOM_AWARDED_TO_OTHER_TENANT'
                );
            }
        }

        return confirmed;
    });

    return { data: updated };
}

/**
 * Landlord từ chối yêu cầu thuê
 */
async function rejectRequest(preorderId, landlordId, body) {
    const { reason } = body;

    const preorder = await prisma.preorder.findUnique({
        where: { id: preorderId },
        include: {
            room: { include: { rentals: true } },
        },
    });

    if (!preorder) {
        throw Object.assign(new Error('Yêu cầu không tồn tại'), { statusCode: 404 });
    }

    if (preorder.room.rentals.owner_id !== landlordId) {
        throw Object.assign(new Error('Bạn không có quyền từ chối yêu cầu này'), {
            statusCode: 403,
        });
    }

    if (preorder.status !== 'PENDING') {
        throw Object.assign(new Error('Chỉ có thể từ chối yêu cầu đang chờ'), { statusCode: 400 });
    }

    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    const cancelReason = normalizedReason || null;

    const updated = await prisma.$transaction(async (tx) => {
        const latest = await tx.preorder.findUnique({ where: { id: preorderId } });
        if (!latest) {
            throw Object.assign(new Error('Yêu cầu không tồn tại'), { statusCode: 404 });
        }

        if (latest.status !== 'PENDING') {
            throw Object.assign(new Error('Yêu cầu đã được xử lý trước đó'), { statusCode: 409 });
        }

        if (latest.payment_status === 'PAID') {
            const refundAmount = toNumber(latest.deposit_amount);
            await refundPaidPreorderToTenantInTx(tx, latest.id, {
                actingUserId: landlordId,
                paymentRefundReason: cancelReason || 'LANDLORD_REJECTED',
                cancelReasonNote: cancelReason,
                notificationTitle: 'Yêu cầu đặt cọc bị từ chối',
                notificationBody: `Bạn đã được hoàn ${refundAmount.toLocaleString('vi-VN')} VND vào ví nội bộ.${cancelReason ? ` Lý do: ${cancelReason}` : ''}`,
            });
            return tx.preorder.findUnique({ where: { id: latest.id } });
        }

        return tx.preorder.update({
            where: { id: latest.id },
            data: {
                status: 'CANCELLED',
                refund_status: 'NOT_APPLICABLE',
                cancel_reason: cancelReason,
            },
        });
    });

    return { data: updated };
}

/**
 * Tenant resumes an unpaid PENDING preorder — fetches fresh PayOS checkout URL
 */
async function resumePayment(userId, preorderId) {
    const preorder = await prisma.preorder.findUnique({
        where: { id: preorderId },
        include: {
            room: {
                select: { id: true, room_name: true, price: true, rentals: { select: { id: true, title: true } } },
            },
        },
    });

    if (!preorder) {
        throw Object.assign(new Error('Yêu cầu đặt cọc không tồn tại'), { statusCode: 404 });
    }
    if (preorder.userId !== userId) {
        throw Object.assign(new Error('Bạn không có quyền truy cập yêu cầu này'), { statusCode: 403 });
    }
    if (preorder.status !== 'PENDING' || preorder.payment_status !== 'UNPAID') {
        throw Object.assign(
            new Error('Chỉ có thể tiếp tục thanh toán cho yêu cầu chưa thanh toán'),
            { statusCode: 400 }
        );
    }

    // Find the most recent payment order for this preorder
    const paymentOrder = await prisma.payment_orders.findFirst({
        where: {
            ref_id: preorderId,
            purpose: 'PREORDER_DEPOSIT',
            status: { in: ['PENDING', 'FAILED', 'CANCELLED', 'EXPIRED'] },
        },
        orderBy: { created_at: 'desc' },
    });
    let orderCode = paymentOrder?.vnp_txn_ref || null;
    let checkoutUrl = null;

    if (paymentOrder) {
        // 1. Try the URL we persisted when the link was first created
        const stored = paymentOrder.raw_ipn_payload || {};
        checkoutUrl = stored.checkoutUrl || null;

        // 2. If we have the paymentLinkId we can build the URL ourselves (PayOS format)
        if (!checkoutUrl && stored.paymentLinkId) {
            checkoutUrl = `https://pay.payos.vn/web/${stored.paymentLinkId}`;
        }

        // 3. Fall back to asking PayOS – response includes `id` (the payment link ID)
        if (!checkoutUrl) {
            const payos = getPayOSClient();
            try {
            const info = await getPayOSPaymentByOrderCode(payos, Number(paymentOrder.vnp_txn_ref));
                // SDK may return data directly or nested; id / paymentLinkId both tried
                const linkId = info?.id || info?.paymentLinkId || info?.data?.id || info?.data?.paymentLinkId;
                if (linkId) {
                    checkoutUrl = `https://pay.payos.vn/web/${linkId}`;
                } else if (info?.checkoutUrl || info?.data?.checkoutUrl) {
                    checkoutUrl = info?.checkoutUrl || info?.data?.checkoutUrl;
                }
            } catch {
                // PayOS query failed – checkoutUrl stays null
            }
        }
    }

    // 4. If no valid link is found, generate a fresh payment order + payment link.
    if (!checkoutUrl) {
        const orderCodeNum = generateOrderCode();
        orderCode = String(orderCodeNum);
        const payos = getPayOSClient();

        const createdOrder = await prisma.payment_orders.create({
            data: {
                user_id: userId,
                vnp_txn_ref: orderCode,
                amount: toNumber(preorder.deposit_amount),
                purpose: 'PREORDER_DEPOSIT',
                status: 'PENDING',
                ref_type: 'PREORDER',
                ref_id: preorder.id,
            },
        });

        try {
            const paymentLink = await payos.paymentRequests.create({
                orderCode: orderCodeNum,
                amount: toNumber(preorder.deposit_amount),
                description: buildPayOSDescription(preorder.id),
                returnUrl: buildPayOSRedirectUrl('return', preorder.id),
                cancelUrl: buildPayOSRedirectUrl('cancel', preorder.id),
            });

            checkoutUrl = paymentLink?.checkoutUrl || null;

            await prisma.payment_orders.update({
                where: { id: createdOrder.id },
                data: {
                    raw_ipn_payload: {
                        step: 'resume_created',
                        checkoutUrl: paymentLink?.checkoutUrl || null,
                        paymentLinkId: paymentLink?.paymentLinkId || null,
                        qrCode: paymentLink?.qrCode || null,
                    },
                },
            });
        } catch (err) {
            await prisma.payment_orders.update({
                where: { id: createdOrder.id },
                data: {
                    status: 'FAILED',
                    raw_ipn_payload: {
                        step: 'resume_create_payment_link',
                        error: err?.message || 'Unknown error',
                    },
                },
            });
            throw Object.assign(
                new Error('Không thể tạo lại link thanh toán, vui lòng thử lại sau'),
                { statusCode: 502 }
            );
        }
    }

    return {
        data: {
            preorderId: preorder.id,
            roomId: preorder.roomId,
            depositAmount: toNumber(preorder.deposit_amount),
            room: preorder.room ? {
                id: preorder.room.id,
                room_name: preorder.room.room_name,
                price: toNumber(preorder.room.price),
            } : null,
            payment: {
                provider: 'PAYOS',
                orderCode,
                checkoutUrl,
                status: 'PENDING',
            },
        },
    };
}

/**
 * Tenant hủy preorder chưa thanh toán
 */
async function cancelUnpaidPreorder(userId, preorderId, body = {}) {
    const preorder = await prisma.preorder.findUnique({
        where: { id: preorderId },
    });

    if (!preorder) {
        throw Object.assign(new Error('Yêu cầu đặt cọc không tồn tại'), { statusCode: 404 });
    }
    if (preorder.userId !== userId) {
        throw Object.assign(new Error('Bạn không có quyền hủy yêu cầu này'), { statusCode: 403 });
    }
    if (preorder.status !== 'PENDING' || preorder.payment_status !== 'UNPAID') {
        throw Object.assign(
            new Error('Chỉ có thể hủy yêu cầu đang chờ và chưa thanh toán'),
            { statusCode: 400 }
        );
    }

    const normalizedReason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const cancelReason = normalizedReason || 'TENANT_CANCELLED_UNPAID';

    const updated = await prisma.$transaction(async (tx) => {
        const cancelled = await tx.preorder.update({
            where: { id: preorderId },
            data: {
                status: 'CANCELLED',
                payment_status: 'UNPAID',
                refund_status: 'NOT_APPLICABLE',
                cancel_reason: cancelReason,
            },
        });

        await tx.payment_orders.updateMany({
            where: {
                ref_type: 'PREORDER',
                ref_id: preorderId,
                purpose: 'PREORDER_DEPOSIT',
                status: 'PENDING',
            },
            data: {
                status: 'CANCELLED',
            },
        });

        return cancelled;
    });

    return { data: mapPreorderItem(updated) };
}

/**
 * Tenant chủ động verify trạng thái thanh toán preorder (fallback khi webhook không về)
 */
async function verifyPreorderPayment(userId, preorderId, orderCodeRaw) {
    const VERIFY_COOLDOWN_SECONDS = Math.max(
        10,
        Number(process.env.PREORDER_VERIFY_COOLDOWN_SECONDS || 20)
    );
    const cooldownMs = VERIFY_COOLDOWN_SECONDS * 1000;
    const preorder = await prisma.preorder.findUnique({
        where: { id: preorderId },
        select: { id: true, userId: true },
    });

    if (!preorder) {
        throw Object.assign(new Error('Yêu cầu đặt cọc không tồn tại'), { statusCode: 404 });
    }
    if (preorder.userId !== userId) {
        throw Object.assign(new Error('Bạn không có quyền truy cập yêu cầu này'), { statusCode: 403 });
    }

    const orderCode = String(orderCodeRaw || '').trim();
    if (!orderCode) {
        throw Object.assign(new Error('Thiếu orderCode để xác minh thanh toán'), { statusCode: 400 });
    }

    const paymentOrder = await prisma.payment_orders.findFirst({
        where: {
            vnp_txn_ref: orderCode,
            purpose: 'PREORDER_DEPOSIT',
            ref_type: 'PREORDER',
            ref_id: preorderId,
            user_id: userId,
        },
        orderBy: { created_at: 'desc' },
    });
    if (!paymentOrder) {
        throw Object.assign(new Error('Không tìm thấy đơn thanh toán tương ứng'), { statusCode: 404 });
    }

    const lastCheckedAtRaw = paymentOrder?.raw_ipn_payload?._verify?.lastCheckedAt;
    const lastCheckedAtMs = lastCheckedAtRaw ? new Date(lastCheckedAtRaw).getTime() : NaN;
    const withinCooldown = Number.isFinite(lastCheckedAtMs) && (Date.now() - lastCheckedAtMs) < cooldownMs;
    if (withinCooldown) {
        return {
            data: {
                preorder: null,
                payment: {
                    orderCode,
                    status: String(paymentOrder.status || 'PENDING'),
                    payosStatus: paymentOrder?.raw_ipn_payload?._verify?.lastPayosStatus || null,
                    skippedExternal: true,
                    cooldownSeconds: VERIFY_COOLDOWN_SECONDS,
                },
            },
        };
    }

    const payos = getPayOSClient();
    let info;
    try {
        info = await getPayOSPaymentByOrderCode(payos, Number(orderCode));
    } catch (err) {
        throw Object.assign(
            new Error(`Không thể xác minh trạng thái thanh toán: ${err?.message || 'PayOS error'}`),
            { statusCode: 502 }
        );
    }

    const linkStatus = info?.status || info?.data?.status;
    const nextStatus = mapPayOSPaymentLinkStatusToOrderStatus(linkStatus);

    await prisma.$transaction(async (tx) => {
        const latestOrder = await tx.payment_orders.findUnique({ where: { id: paymentOrder.id } });
        if (!latestOrder) return;

        const finalOrderStatus = latestOrder.status === 'SUCCESS' ? 'SUCCESS' : nextStatus;

        await tx.payment_orders.update({
            where: { id: latestOrder.id },
            data: {
                status: finalOrderStatus,
                raw_ipn_payload: {
                    ...(latestOrder.raw_ipn_payload || {}),
                    _verify: {
                        lastCheckedAt: new Date().toISOString(),
                        lastPayosStatus: linkStatus || null,
                    },
                    payosInfo: info || null,
                },
            },
        });

        if (finalOrderStatus === 'SUCCESS') {
            await tx.preorder.update({
                where: { id: preorderId },
                data: {
                    payment_status: 'PAID',
                    status: 'PENDING',
                },
            });
        } else if (finalOrderStatus !== 'PENDING') {
            await tx.preorder.update({
                where: { id: preorderId },
                data: {
                    payment_status: 'UNPAID',
                    status: 'CANCELLED',
                    cancel_reason: `PAYOS_${finalOrderStatus}`,
                },
            });
        }
    });

    const updated = await prisma.preorder.findUnique({
        where: { id: preorderId },
        include: {
            room: {
                select: {
                    id: true,
                    room_name: true,
                    price: true,
                    rentals: { select: { id: true, title: true } },
                },
            },
        },
    });

    return {
        data: {
            preorder: updated ? mapPreorderItem(updated) : null,
            payment: {
                orderCode,
                status: nextStatus,
                payosStatus: linkStatus || null,
                skippedExternal: false,
                cooldownSeconds: VERIFY_COOLDOWN_SECONDS,
            },
        },
    };
}

module.exports = {
    createDepositPayment,
    resumePayment,
    cancelUnpaidPreorder,
    verifyPreorderPayment,
    getMyPreorders,
    handlePayOSWebhook,
    getLandlordRequests,
    confirmRequest,
    rejectRequest,
};
