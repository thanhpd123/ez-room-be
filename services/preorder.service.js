const prisma = require('../config/prisma');
const { getPayOSClient } = require('../config/payos');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

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

function mapWalletTxnStatus(orderStatus) {
    if (orderStatus === 'SUCCESS') return 'SUCCESS';
    if (orderStatus === 'CANCELLED' || orderStatus === 'EXPIRED') return 'CANCELLED';
    return 'FAILED';
}

/**
 * Tenant tạo yêu cầu đặt cọc và link thanh toán PayOS
 */
async function createDepositPayment(userId, body) {
    const roomId = String(body?.roomId || '').trim();
    const depositAmount = parseDepositAmount(body?.depositAmount);

    if (!roomId) {
        throw Object.assign(new Error('Thiếu roomId'), { statusCode: 400 });
    }

    if (!depositAmount) {
        throw Object.assign(new Error('Số tiền đặt cọc phải là số nguyên dương (VND)'), { statusCode: 400 });
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

    const existing = await prisma.preorder.findFirst({
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

    const payos = getPayOSClient();
    const orderCode = generateOrderCode();

    const created = await prisma.$transaction(async (tx) => {
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

        return {
            message: 'Tạo link thanh toán đặt cọc thành công',
            data: {
                preorderId: created.preorder.id,
                roomId,
                depositAmount,
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
        skip: Math.max(0, (parseInt(page) - 1) * parseInt(limit)),
        take: parseInt(limit),
    });

    return {
        data: preorders.map(mapPreorderItem),
    };
}

/**
 * Landlord xác nhận yêu cầu thuê
 */
async function confirmRequest(preorderId, landlordId) {
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
        throw Object.assign(new Error('Bạn không có quyền xác nhận yêu cầu này'), {
            statusCode: 403,
        });
    }

    if (preorder.status !== 'PENDING') {
        throw Object.assign(new Error('Chỉ có thể xác nhận yêu cầu đang chờ'), { statusCode: 400 });
    }

    if (preorder.payment_status !== 'PAID') {
        throw Object.assign(new Error('Chỉ có thể xác nhận yêu cầu đã thanh toán đặt cọc'), {
            statusCode: 400,
        });
    }

    const updated = await prisma.preorder.update({
        where: { id: preorderId },
        data: { status: 'CONFIRMED' },
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

        // Nếu tenant đã thanh toán cọc, hoàn về ví nội bộ ngay khi landlord từ chối.
        if (latest.payment_status === 'PAID') {
            const refundAmount = toNumber(latest.deposit_amount);
            if (refundAmount <= 0) {
                throw Object.assign(new Error('Không tìm thấy số tiền cọc hợp lệ để hoàn'), {
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
                    description: `Hoàn cọc preorder ${latest.id}${cancelReason ? ` - ${cancelReason}` : ''}`,
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
                    title: 'Yêu cầu đặt cọc bị từ chối',
                    body: `Bạn đã được hoàn ${refundAmount.toLocaleString('vi-VN')} VND vào ví nội bộ.${cancelReason ? ` Lý do: ${cancelReason}` : ''}`,
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

module.exports = {
    createDepositPayment,
    getMyPreorders,
    handlePayOSWebhook,
    getLandlordRequests,
    confirmRequest,
    rejectRequest,
};
