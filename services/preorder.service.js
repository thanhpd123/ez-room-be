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

function resolveRequestSourceType(preorder) {
    return preorder?.cancel_reason === 'AUTO_FROM_FAVORITE' ? 'FAVORITE' : 'PREORDER';
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
        sourceType: resolveRequestSourceType(p),
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
    const rawStatus = String(webhookData?.data?.status || webhookData?.status || '').toUpperCase();
    const code = String(webhookData?.data?.code || webhookData?.code || '').toUpperCase();
    const success = webhookData?.success === true || code === '00' || rawStatus === 'PAID' || rawStatus === 'SUCCESS';

    if (rawStatus === 'CANCELLED' || rawStatus === 'CANCELED') return 'CANCELLED';
    if (rawStatus === 'EXPIRED') return 'EXPIRED';

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

    throw new Error('SDK PayOS khÃ´ng há»— trá»£ truy váº¥n theo orderCode');
}

function mapWalletTxnStatus(orderStatus) {
    if (orderStatus === 'SUCCESS') return 'SUCCESS';
    if (orderStatus === 'CANCELLED' || orderStatus === 'EXPIRED') return 'CANCELLED';
    return 'FAILED';
}

async function getPayOSPaymentByOrderCode(payos, orderCode) {
    if (payos?.paymentRequests?.get) {
        return payos.paymentRequests.get(orderCode);
    }

    if (payos?.paymentRequests?.getByOrderCode) {
        return payos.paymentRequests.getByOrderCode(orderCode);
    }

    throw new Error('SDK PayOS khÃ´ng há»— trá»£ truy váº¥n theo orderCode');
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
 * Tenant táº¡o yÃªu cáº§u Ä‘áº·t cá»c vÃ  link thanh toÃ¡n PayOS
 */
async function createDepositPayment(userId, body) {
    const roomId = String(body?.roomId || '').trim();
    const rawDepositMonths = body?.depositMonths;
    const rawDepositPercent = body?.depositPercent;
    const rawDepositAmount = body?.depositAmount;

    if (!roomId) {
        throw Object.assign(new Error('Thiáº¿u roomId'), { statusCode: 400 });
    }

    const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: { rentals: { select: { owner_id: true, title: true } } },
    });

    if (!room) {
        throw Object.assign(new Error('PhÃ²ng khÃ´ng tá»“n táº¡i'), { statusCode: 404 });
    }

    if (room.status !== 'AVAILABLE') {
        throw Object.assign(new Error('PhÃ²ng hiá»‡n khÃ´ng kháº£ dá»¥ng Ä‘á»ƒ Ä‘áº·t cá»c'), { statusCode: 400 });
    }

    if (room.rentals?.owner_id === userId) {
        throw Object.assign(new Error('KhÃ´ng thá»ƒ tá»± Ä‘áº·t cá»c phÃ²ng cá»§a chÃ­nh báº¡n'), { statusCode: 400 });
    }

    const roomPrice = toNumber(room.price);
    if (roomPrice <= 0) {
        throw Object.assign(new Error('GiÃ¡ phÃ²ng khÃ´ng há»£p lá»‡ Ä‘á»ƒ tÃ­nh tiá»n Ä‘áº·t cá»c'), {
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
            throw Object.assign(new Error('Sá»‘ tiá»n Ä‘áº·t cá»c pháº£i lÃ  sá»‘ nguyÃªn dÆ°Æ¡ng (VND)'), {
                statusCode: 400,
            });
        }
        depositPercent = Math.round(((requestedAmount / roomPrice) * 100) * 100) / 100;
    } else if (rawDepositMonths != null && String(rawDepositMonths).trim() !== '') {
        depositMonths = parseDepositMonths(rawDepositMonths);
        if (!depositMonths) {
            throw Object.assign(new Error('Sá»‘ thÃ¡ng Ä‘áº·t cá»c pháº£i lÃ  sá»‘ dÆ°Æ¡ng'), {
                statusCode: 400,
            });
        }
        depositPercent = convertMonthsToPercent(depositMonths, depositSettings?.baseMonths);
    } else if (rawDepositPercent != null && String(rawDepositPercent).trim() !== '') {
        depositPercent = parseDepositPercent(rawDepositPercent);
        if (!depositPercent) {
            throw Object.assign(
                new Error('Pháº§n trÄƒm Ä‘áº·t cá»c pháº£i lÃ  sá»‘ dÆ°Æ¡ng vÃ  nhá» hÆ¡n 100%'),
                { statusCode: 400 }
            );
        }
    } else {
        depositPercent = defaultPercent;
    }

    if (!Number.isFinite(depositPercent) || depositPercent <= 0) {
        throw Object.assign(new Error('KhÃ´ng thá»ƒ xÃ¡c Ä‘á»‹nh pháº§n trÄƒm Ä‘áº·t cá»c há»£p lá»‡'), {
            statusCode: 400,
        });
    }

    if (depositPercent >= 100) {
        throw Object.assign(new Error('Tiá»n Ä‘áº·t cá»c khÃ´ng Ä‘Æ°á»£c báº±ng hoáº·c vÆ°á»£t 100% giÃ¡ phÃ²ng'), {
            statusCode: 400,
        });
    }

    if (depositPercent < min || depositPercent > max) {
        throw Object.assign(
            new Error(`Pháº§n trÄƒm Ä‘áº·t cá»c pháº£i náº±m trong khoáº£ng ${min}% - ${max}%`),
            { statusCode: 400 }
        );
    }

    const depositAmount = computeDepositAmountByPercent(roomPrice, depositPercent);
    if (depositAmount <= 0 || depositAmount >= roomPrice) {
        throw Object.assign(new Error('Sá»‘ tiá»n Ä‘áº·t cá»c sau khi tÃ­nh theo pháº§n trÄƒm khÃ´ng há»£p lá»‡'), {
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

        const canReuseFavoritePlaceholder = Boolean(
            existing
            && existing.status === 'PENDING'
            && existing.payment_status === 'UNPAID'
            && (
                toNumber(existing.deposit_amount) <= 0
                || existing.cancel_reason === 'AUTO_FROM_FAVORITE'
            )
        );

        if (existing && !canReuseFavoritePlaceholder) {
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

        const preorder = canReuseFavoritePlaceholder
            ? await tx.preorder.update({
                where: { id: existing.id },
                data: {
                    status: 'PENDING',
                    payment_status: 'UNPAID',
                    deposit_amount: depositAmount,
                    refund_status: 'NOT_APPLICABLE',
                    // Keep origin marker so landlord can identify favorite-origin requests.
                    cancel_reason: existing.cancel_reason || 'AUTO_FROM_FAVORITE',
                },
            })
            : await tx.preorder.create({
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
            message: 'Táº¡o link thanh toÃ¡n Ä‘áº·t cá»c thÃ nh cÃ´ng',
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

        throw Object.assign(new Error(`KhÃ´ng thá»ƒ táº¡o link thanh toÃ¡n PayOS: ${err.message}`), {
            statusCode: 502,
        });
    }
}

/**
 * Tenant xem danh sÃ¡ch preorder cá»§a mÃ¬nh
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
 * Webhook PayOS cáº­p nháº­t tráº¡ng thÃ¡i thanh toÃ¡n (Ä‘áº·t cá»c + náº¡p vÃ­)
 */
async function handlePayOSWebhook(payload) {
    const payos = getPayOSClient();
    const verifiedPayload = await payos.webhooks.verify(payload);
    const eventData = verifiedPayload?.data || {};
    const orderCode = String(eventData?.orderCode || '').trim();

    if (!orderCode) {
        throw Object.assign(new Error('Webhook thiáº¿u orderCode'), { statusCode: 400 });
    }

    const order = await prisma.payment_orders.findUnique({
        where: { vnp_txn_ref: orderCode },
    });

    if (!order) {
        return {
            acknowledged: true,
            updated: false,
            message: 'Order khÃ´ng tá»“n táº¡i trong há»‡ thá»‘ng',
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
                            title: 'Äáº·t cá»c thÃ nh cÃ´ng',
                            body: 'Thanh toÃ¡n Ä‘áº·t cá»c cá»§a báº¡n Ä‘Ã£ Ä‘Æ°á»£c ghi nháº­n. Chá» chá»§ trá» xÃ¡c nháº­n yÃªu cáº§u.',
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
                            description: walletTx.description || 'Náº¡p tiá»n vÃ­ qua PayOS',
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
                                title: 'Náº¡p vÃ­ thÃ nh cÃ´ng',
                                body: `VÃ­ cá»§a báº¡n Ä‘Ã£ Ä‘Æ°á»£c cá»™ng ${toNumber(latestOrder.amount).toLocaleString('vi-VN')} VND.`,
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
 * Láº¥y danh sÃ¡ch yÃªu cáº§u thuÃª cho landlord
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
        skip: Math.max(0, (parseInt(page) - 1) * parseInt(limit)),
        take: parseInt(limit),
    });

    const favoritePairs = preorders
        .filter((p) => resolveRequestSourceType(p) === 'FAVORITE')
        .map((p) => ({ userId: p.userId, roomId: p.roomId }));

    const activeFavoriteKeySet = new Set();
    if (favoritePairs.length > 0) {
        const favoriteRows = await prisma.favoriteRoom.findMany({
            where: {
                OR: favoritePairs.map((pair) => ({
                    userId: pair.userId,
                    roomId: pair.roomId,
                })),
            },
            select: { userId: true, roomId: true },
        });
        for (const row of favoriteRows) {
            activeFavoriteKeySet.add(`${row.userId}:${row.roomId}`);
        }
    }

    const filtered = preorders.filter((p) => {
        if (resolveRequestSourceType(p) !== 'FAVORITE') return true;

        // Keep favorite-origin request visible when user still favorites the room
        // or once they already started/finished deposit flow.
        const key = `${p.userId}:${p.roomId}`;
        const stillFavorited = activeFavoriteKeySet.has(key);
        const hasDepositIntent = toNumber(p.deposit_amount) > 0 || p.payment_status === 'PAID';
        return stillFavorited || hasDepositIntent;
    });

    const statusPriority = {
        PENDING: 0,
        CONFIRMED: 1,
        EXPIRED: 2,
        CANCELLED: 3,
    };

    const prioritized = [...filtered].sort((a, b) => {
        const aStatusRank = statusPriority[a.status] ?? 99;
        const bStatusRank = statusPriority[b.status] ?? 99;
        if (aStatusRank !== bStatusRank) {
            return aStatusRank - bStatusRank;
        }

        const aHasPreorderIntent = toNumber(a.deposit_amount) > 0 || a.payment_status === 'PAID';
        const bHasPreorderIntent = toNumber(b.deposit_amount) > 0 || b.payment_status === 'PAID';
        if (aHasPreorderIntent !== bHasPreorderIntent) {
            return aHasPreorderIntent ? -1 : 1;
        }

        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return {
        data: prioritized.map(mapPreorderItem),
    };
}

/**
 * Landlord xÃ¡c nháº­n yÃªu cáº§u thuÃª
 */
async function confirmRequest(preorderId, landlordId) {
    const updated = await prisma.$transaction(async (tx) => {
        // Lock theo preorder Ä‘á»ƒ trÃ¡nh race-condition khi confirm Ä‘á»“ng thá»i.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${preorderId}))`;

        const preorder = await tx.preorder.findUnique({
            where: { id: preorderId },
            include: {
                room: { include: { rentals: true } },
            },
        });

        if (!preorder) {
            throw Object.assign(new Error('YÃªu cáº§u khÃ´ng tá»“n táº¡i'), { statusCode: 404 });
        }

        if (preorder.room.rentals.owner_id !== landlordId) {
            throw Object.assign(new Error('Báº¡n khÃ´ng cÃ³ quyá»n xÃ¡c nháº­n yÃªu cáº§u nÃ y'), {
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
            throw Object.assign(new Error('Chá»‰ cÃ³ thá»ƒ xÃ¡c nháº­n yÃªu cáº§u Ä‘ang chá»'), { statusCode: 400 });
        }

        const hasPaidDeposit = preorder.payment_status === 'PAID' && grossDepositAmount > 0;
        if (hasPaidDeposit) {
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
                        description: `Nháº­n tiá»n Ä‘áº·t cá»c preorder ${preorder.id} (phÃ­ ${computed.feeAmount.toLocaleString('vi-VN')} VND)`,
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
                        title: 'Báº¡n nháº­n Ä‘Æ°á»£c tiá»n Ä‘áº·t cá»c',
                        body: `VÃ­ cá»§a báº¡n Ä‘Ã£ Ä‘Æ°á»£c cá»™ng ${computed.payoutAmount.toLocaleString('vi-VN')} VND tá»« yÃªu cáº§u thuÃª ${preorder.id}.`,
                    },
                });
            }
        }

        const confirmed = await tx.preorder.update({
            where: { id: preorderId },
            data: {
                status: 'CONFIRMED',
                refund_status: 'NOT_APPLICABLE',
                commission_rate_bps: hasPaidDeposit ? computed.feeBps : 0,
                platform_fee_amount: hasPaidDeposit ? computed.feeAmount : 0,
                landlord_payout_amount: hasPaidDeposit ? computed.payoutAmount : 0,
                payout_at: hasPaidDeposit ? new Date() : null,
            },
        });

        await tx.notification.create({
            data: {
                userId: preorder.userId,
                type: 'PREORDER',
                status: 'UNREAD',
                title: 'YÃªu cáº§u Ä‘áº·t cá»c Ä‘Ã£ Ä‘Æ°á»£c xÃ¡c nháº­n',
                body: 'Chá»§ trá» Ä‘Ã£ xÃ¡c nháº­n yÃªu cáº§u cá»§a báº¡n. Tiá»n Ä‘áº·t cá»c Ä‘Ã£ Ä‘Æ°á»£c ghi nháº­n cho chá»§ trá».',
            },
        });

        return confirmed;
    });

    return { data: updated };
}

/**
 * Landlord tá»« chá»‘i yÃªu cáº§u thuÃª
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
        throw Object.assign(new Error('YÃªu cáº§u khÃ´ng tá»“n táº¡i'), { statusCode: 404 });
    }

    if (preorder.room.rentals.owner_id !== landlordId) {
        throw Object.assign(new Error('Báº¡n khÃ´ng cÃ³ quyá»n tá»« chá»‘i yÃªu cáº§u nÃ y'), {
            statusCode: 403,
        });
    }

    if (preorder.status !== 'PENDING') {
        throw Object.assign(new Error('Chá»‰ cÃ³ thá»ƒ tá»« chá»‘i yÃªu cáº§u Ä‘ang chá»'), { statusCode: 400 });
    }

    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    const cancelReason = normalizedReason || null;

    const updated = await prisma.$transaction(async (tx) => {
        const latest = await tx.preorder.findUnique({ where: { id: preorderId } });
        if (!latest) {
            throw Object.assign(new Error('YÃªu cáº§u khÃ´ng tá»“n táº¡i'), { statusCode: 404 });
        }

        if (latest.status !== 'PENDING') {
            throw Object.assign(new Error('YÃªu cáº§u Ä‘Ã£ Ä‘Æ°á»£c xá»­ lÃ½ trÆ°á»›c Ä‘Ã³'), { statusCode: 409 });
        }

        // Náº¿u tenant Ä‘Ã£ thanh toÃ¡n cá»c, hoÃ n vá» vÃ­ ná»™i bá»™ ngay khi landlord tá»« chá»‘i.
        if (latest.payment_status === 'PAID') {
            const refundAmount = toNumber(latest.deposit_amount);
            if (refundAmount <= 0) {
                throw Object.assign(new Error('KhÃ´ng tÃ¬m tháº¥y sá»‘ tiá»n cá»c há»£p lá»‡ Ä‘á»ƒ hoÃ n'), {
                    statusCode: 400,
                });
            }

            const tenantWallet = await tx.wallet.findUnique({ where: { userId: latest.userId } })
                || await tx.wallet.create({
                    data: {
                        userId: latest.userId,
                        balance: 0,
                    },
                });

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
                    description: `HoÃ n cá»c preorder ${latest.id}${cancelReason ? ` - ${cancelReason}` : ''}`,
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
                    refund_reason: cancelReason || 'LANDLORD_REJECTED',
                    refund_requested_at: new Date(),
                    refund_completed_at: new Date(),
                    refund_requested_by: landlordId,
                },
            });

            const cancelledAndRefunded = await tx.preorder.update({
                where: { id: latest.id },
                data: {
                    status: 'CANCELLED',
                    payment_status: 'REFUNDED',
                    refund_status: 'REFUNDED',
                    refund_amount: refundAmount,
                    refunded_at: new Date(),
                    cancel_reason: cancelReason,
                },
            });

            await tx.notification.create({
                data: {
                    userId: latest.userId,
                    type: 'PAYMENT',
                    status: 'UNREAD',
                    title: 'YÃªu cáº§u Ä‘áº·t cá»c bá»‹ tá»« chá»‘i',
                    body: `Báº¡n Ä‘Ã£ Ä‘Æ°á»£c hoÃ n ${refundAmount.toLocaleString('vi-VN')} VND vÃ o vÃ­ ná»™i bá»™.${cancelReason ? ` LÃ½ do: ${cancelReason}` : ''}`,
                },
            });

            return cancelledAndRefunded;
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
 * Tenant resumes an unpaid PENDING preorder - fetches fresh PayOS checkout URL
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
        throw Object.assign(new Error('Yeu cau dat coc khong ton tai'), { statusCode: 404 });
    }
    if (preorder.userId !== userId) {
        throw Object.assign(new Error('Ban khong co quyen truy cap yeu cau nay'), { statusCode: 403 });
    }
    if (preorder.status !== 'PENDING' || preorder.payment_status !== 'UNPAID') {
        throw Object.assign(
            new Error('Chi co the tiep tuc thanh toan cho yeu cau chua thanh toan'),
            { statusCode: 400 }
        );
    }

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
        const stored = paymentOrder.raw_ipn_payload || {};
        checkoutUrl = stored.checkoutUrl || null;

        if (!checkoutUrl && stored.paymentLinkId) {
            checkoutUrl = `https://pay.payos.vn/web/${stored.paymentLinkId}`;
        }

        if (!checkoutUrl) {
            const payos = getPayOSClient();
            try {
                const orderCodeNumber = Number(paymentOrder.vnp_txn_ref);
                const info = await getPayOSPaymentByOrderCode(
                    payos,
                    Number.isFinite(orderCodeNumber) ? orderCodeNumber : paymentOrder.vnp_txn_ref
                );
                const linkId = info?.id || info?.paymentLinkId || info?.data?.id || info?.data?.paymentLinkId;
                if (linkId) {
                    checkoutUrl = `https://pay.payos.vn/web/${linkId}`;
                } else if (info?.checkoutUrl || info?.data?.checkoutUrl) {
                    checkoutUrl = info?.checkoutUrl || info?.data?.checkoutUrl;
                }
            } catch {
                // Keep fallback path below
            }
        }
    }

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
                new Error('Khong the tao lai link thanh toan, vui long thu lai sau'),
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
 * Tenant huy preorder chua thanh toan
 */
async function cancelUnpaidPreorder(userId, preorderId, body = {}) {
    const preorder = await prisma.preorder.findUnique({
        where: { id: preorderId },
    });

    if (!preorder) {
        throw Object.assign(new Error('Yeu cau dat coc khong ton tai'), { statusCode: 404 });
    }
    if (preorder.userId !== userId) {
        throw Object.assign(new Error('Ban khong co quyen huy yeu cau nay'), { statusCode: 403 });
    }
    if (preorder.status !== 'PENDING' || preorder.payment_status !== 'UNPAID') {
        throw Object.assign(
            new Error('Chi co the huy yeu cau dang cho va chua thanh toan'),
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
 * Tenant chu dong verify trang thai thanh toan preorder (tuong thich route cu va moi)
 */
async function verifyPreorderPayment(userId, input = {}, orderCodeRaw) {
    const normalizedInput = (typeof input === 'object' && input !== null)
        ? input
        : { preorderId: input, orderCode: orderCodeRaw };
    const preorderIdInput = String(normalizedInput.preorderId || '').trim();
    const orderCodeInput = String(normalizedInput.orderCode || '').trim();

    if (!orderCodeInput && !preorderIdInput) {
        throw Object.assign(new Error('Thieu orderCode hoac preorderId'), { statusCode: 400 });
    }

    let paymentOrder = null;
    if (orderCodeInput) {
        paymentOrder = await prisma.payment_orders.findUnique({
            where: { vnp_txn_ref: orderCodeInput },
        });
    }

    if (!paymentOrder && preorderIdInput) {
        paymentOrder = await prisma.payment_orders.findFirst({
            where: {
                purpose: 'PREORDER_DEPOSIT',
                ref_type: 'PREORDER',
                ref_id: preorderIdInput,
                user_id: userId,
            },
            orderBy: { created_at: 'desc' },
        });
    }

    if (!paymentOrder) {
        throw Object.assign(new Error('Khong tim thay giao dich preorder'), { statusCode: 404 });
    }
    if (paymentOrder.user_id !== userId) {
        throw Object.assign(new Error('Khong co quyen xac minh giao dich nay'), { statusCode: 403 });
    }
    if (paymentOrder.purpose !== 'PREORDER_DEPOSIT' || paymentOrder.ref_type !== 'PREORDER' || !paymentOrder.ref_id) {
        throw Object.assign(new Error('Giao dich khong phai thanh toan dat coc preorder'), { statusCode: 400 });
    }

    const preorderId = preorderIdInput || String(paymentOrder.ref_id);
    let preorder = await prisma.preorder.findUnique({
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

    if (!preorder) {
        throw Object.assign(new Error('Yeu cau dat coc khong ton tai'), { statusCode: 404 });
    }
    if (preorder.userId !== userId) {
        throw Object.assign(new Error('Ban khong co quyen truy cap yeu cau nay'), { statusCode: 403 });
    }

    const finalFromCurrent = String(paymentOrder.status || 'PENDING').toUpperCase();
    if (finalFromCurrent === 'SUCCESS' && preorder.payment_status === 'PAID') {
        return {
            message: 'Thanh toan dat coc da duoc xac nhan',
            data: {
                status: 'success',
                confirmed: true,
                preorderId: preorder.id,
                orderCode: paymentOrder.vnp_txn_ref,
                paymentOrderStatus: finalFromCurrent,
                preorderStatus: preorder.status,
                preorderPaymentStatus: preorder.payment_status,
                depositAmount: toNumber(preorder.deposit_amount),
                preorder: mapPreorderItem(preorder),
                payment: {
                    orderCode: paymentOrder.vnp_txn_ref,
                    status: finalFromCurrent,
                    payosStatus: null,
                    skippedExternal: true,
                },
            },
        };
    }

    const VERIFY_COOLDOWN_SECONDS = Math.max(10, Number(process.env.PREORDER_VERIFY_COOLDOWN_SECONDS || 20));
    const cooldownMs = VERIFY_COOLDOWN_SECONDS * 1000;
    const lastCheckedAtRaw = paymentOrder?.raw_ipn_payload?._verify?.lastCheckedAt;
    const lastCheckedAtMs = lastCheckedAtRaw ? new Date(lastCheckedAtRaw).getTime() : NaN;
    const withinCooldown = Number.isFinite(lastCheckedAtMs) && (Date.now() - lastCheckedAtMs) < cooldownMs;

    if (withinCooldown) {
        const isSuccess = finalFromCurrent === 'SUCCESS' && preorder.payment_status === 'PAID';
        const isCancelled = finalFromCurrent === 'CANCELLED' || finalFromCurrent === 'EXPIRED';
        return {
            message: isSuccess
                ? 'Thanh toan dat coc thanh cong'
                : isCancelled
                    ? 'Thanh toan dat coc da bi huy hoac het han'
                    : 'Thanh toan dat coc dang cho xu ly',
            data: {
                status: isSuccess ? 'success' : (isCancelled ? 'cancel' : 'pending'),
                confirmed: isSuccess,
                preorderId: preorder.id,
                orderCode: paymentOrder.vnp_txn_ref,
                paymentOrderStatus: finalFromCurrent,
                preorderStatus: preorder.status,
                preorderPaymentStatus: preorder.payment_status,
                depositAmount: toNumber(preorder.deposit_amount),
                preorder: mapPreorderItem(preorder),
                payment: {
                    orderCode: paymentOrder.vnp_txn_ref,
                    status: finalFromCurrent,
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
        const orderCodeNumber = Number(paymentOrder.vnp_txn_ref);
        info = await getPayOSPaymentByOrderCode(
            payos,
            Number.isFinite(orderCodeNumber) ? orderCodeNumber : paymentOrder.vnp_txn_ref
        );
    } catch (err) {
        throw Object.assign(
            new Error(`Khong the xac minh trang thai thanh toan: ${err?.message || 'PayOS error'}`),
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

    const latestOrder = await prisma.payment_orders.findUnique({ where: { id: paymentOrder.id } });
    const finalOrderStatus = String(latestOrder?.status || nextStatus).toUpperCase();

    preorder = await prisma.preorder.findUnique({
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

    const isSuccess = finalOrderStatus === 'SUCCESS' && preorder?.payment_status === 'PAID';
    const isCancelled = finalOrderStatus === 'CANCELLED' || finalOrderStatus === 'EXPIRED';

    return {
        message: isSuccess
            ? 'Thanh toan dat coc thanh cong'
            : isCancelled
                ? 'Thanh toan dat coc da bi huy hoac het han'
                : 'Thanh toan dat coc dang cho xu ly',
        data: {
            status: isSuccess ? 'success' : (isCancelled ? 'cancel' : 'pending'),
            confirmed: isSuccess,
            preorderId: preorder?.id || preorderId,
            orderCode: latestOrder?.vnp_txn_ref || paymentOrder.vnp_txn_ref || orderCodeInput,
            paymentOrderStatus: finalOrderStatus,
            preorderStatus: preorder?.status || null,
            preorderPaymentStatus: preorder?.payment_status || null,
            depositAmount: toNumber(preorder?.deposit_amount),
            preorder: preorder ? mapPreorderItem(preorder) : null,
            payment: {
                orderCode: latestOrder?.vnp_txn_ref || paymentOrder.vnp_txn_ref || orderCodeInput,
                status: finalOrderStatus,
                payosStatus: linkStatus || null,
                skippedExternal: false,
                cooldownSeconds: VERIFY_COOLDOWN_SECONDS,
            },
        },
    };
}

module.exports = {
    getMyPreorders,
    createDepositPayment,
    resumePayment,
    cancelUnpaidPreorder,
    verifyPreorderPayment,
    handlePayOSWebhook,
    getLandlordRequests,
    confirmRequest,
    rejectRequest,
};
