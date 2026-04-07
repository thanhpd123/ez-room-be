const prisma = require('../config/prisma');
const { getPayOSClient } = require('../config/payos');

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

function isUuid(value) {
    if (typeof value !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.trim()
    );
}

function generateOrderCode() {
    return Number(`${Date.now()}${Math.floor(Math.random() * 90) + 10}`);
}

function buildVipPayOSRedirectUrl(type, packageId) {
    const base = (type === 'cancel' ? process.env.PAYOS_VIP_CANCEL_URL : process.env.PAYOS_VIP_RETURN_URL)
        || `${FRONTEND_URL.replace(/\/$/, '')}/vip-plans`;
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}packageId=${encodeURIComponent(packageId)}&source=payos&type=${type}`;
}

function buildVipPayOSDescription(packageId) {
    const suffix = String(packageId || '').replace(/-/g, '').slice(-8).toUpperCase();
    return `EZROOM VIP ${suffix}`.slice(0, 25);
}

function normalizeRole(role) {
    if (!role) return null;
    const value = String(role).trim().toUpperCase();
    return value || null;
}

function mapPackage(item) {
    return {
        id: item.id,
        name: item.name,
        description: item.description || null,
        durationDays: item.duration_days,
        price: toNumber(item.price),
        targetRole: item.target_role,
        isActive: item.is_active !== false,
        createdAt: item.created_at || null,
    };
}

function getPayOSStatus(payment) {
    return String(payment?.status || '').toUpperCase();
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

async function ensurePackageForRole(packageId, userRole) {
    const vipPackage = await prisma.vip_packages.findUnique({
        where: { id: packageId },
    });

    if (!vipPackage || vipPackage.is_active === false) {
        throw Object.assign(new Error('Gói VIP không tồn tại hoặc đã ngừng bán'), {
            statusCode: 404,
        });
    }

    if (vipPackage.target_role !== userRole) {
        throw Object.assign(
            new Error(`Gói VIP này chỉ áp dụng cho role ${vipPackage.target_role}`),
            { statusCode: 403 }
        );
    }

    return vipPackage;
}

function computeVipPeriod(currentExpiresAt, durationDays) {
    const now = new Date();
    const current = currentExpiresAt ? new Date(currentExpiresAt) : null;
    const startDate = current && current.getTime() > now.getTime() ? current : now;
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
    return { startDate, endDate };
}

async function activateVipFromPaymentOrder(tx, paymentOrder) {
    if (!paymentOrder || paymentOrder.purpose !== 'VIP_PURCHASE') {
        return { activated: false };
    }

    const packageId = paymentOrder.ref_id;
    if (!packageId) {
        throw Object.assign(new Error('Order VIP thiếu package reference'), {
            statusCode: 500,
        });
    }

    const [vipPackage, user] = await Promise.all([
        tx.vip_packages.findUnique({ where: { id: packageId } }),
        tx.user.findUnique({ where: { id: paymentOrder.user_id } }),
    ]);

    if (!vipPackage) {
        throw Object.assign(new Error('Không tìm thấy gói VIP của giao dịch'), {
            statusCode: 404,
        });
    }

    if (!user) {
        throw Object.assign(new Error('Không tìm thấy user của giao dịch VIP'), {
            statusCode: 404,
        });
    }

    const durationDays = Number(vipPackage.duration_days);
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
        throw Object.assign(new Error('Gói VIP có thời hạn không hợp lệ'), {
            statusCode: 500,
        });
    }

    const { startDate, endDate } = computeVipPeriod(user.vip_expires_at, durationDays);

    await tx.user_vip_purchases.create({
        data: {
            user_id: user.id,
            package_id: vipPackage.id,
            start_date: startDate,
            end_date: endDate,
            price_paid: vipPackage.price,
        },
    });

    await tx.user.update({
        where: { id: user.id },
        data: {
            isVip: true,
            vip_expires_at: endDate,
        },
    });

    return {
        activated: true,
        userId: user.id,
        packageId: vipPackage.id,
        packageName: vipPackage.name,
        vipExpiresAt: endDate,
    };
}

async function getVipPackages(params = {}) {
    const role = normalizeRole(params.targetRole);
    const where = { is_active: true };
    if (role) {
        where.target_role = role;
    }

    const rows = await prisma.vip_packages.findMany({
        where,
        orderBy: [
            { target_role: 'asc' },
            { duration_days: 'asc' },
            { price: 'asc' },
        ],
    });

    return {
        data: rows.map(mapPackage),
    };
}

async function createVipPurchase(authUser, body) {
    const userId = authUser?.id;
    const userRole = normalizeRole(authUser?.role);
    const packageId = String(body?.packageId || '').trim();

    if (!userId) {
        throw Object.assign(new Error('Thiếu thông tin user đăng nhập'), { statusCode: 401 });
    }

    if (!packageId) {
        throw Object.assign(new Error('Thiếu packageId'), { statusCode: 400 });
    }

    if (!isUuid(packageId)) {
        throw Object.assign(new Error('packageId không hợp lệ'), { statusCode: 400 });
    }

    if (!userRole || !['TENANT', 'LANDLORD'].includes(userRole)) {
        throw Object.assign(new Error('Role hiện tại không hỗ trợ mua gói VIP'), {
            statusCode: 403,
        });
    }

    const vipPackage = await ensurePackageForRole(packageId, userRole);
    const amount = parsePositiveAmount(vipPackage.price);
    if (!amount) {
        throw Object.assign(new Error('Giá gói VIP không hợp lệ'), { statusCode: 500 });
    }

    const payos = getPayOSClient();
    const orderCode = generateOrderCode();

    const paymentOrder = await prisma.payment_orders.create({
        data: {
            user_id: userId,
            vnp_txn_ref: String(orderCode),
            amount,
            purpose: 'VIP_PURCHASE',
            status: 'PENDING',
            ref_type: 'VIP_PACKAGE',
            ref_id: vipPackage.id,
        },
    });

    try {
        const paymentLink = await payos.paymentRequests.create({
            orderCode,
            amount,
            description: buildVipPayOSDescription(vipPackage.id),
            returnUrl: buildVipPayOSRedirectUrl('return', vipPackage.id),
            cancelUrl: buildVipPayOSRedirectUrl('cancel', vipPackage.id),
        });

        return {
            message: 'Tạo link thanh toán VIP thành công',
            data: {
                package: mapPackage(vipPackage),
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
        await prisma.payment_orders.update({
            where: { id: paymentOrder.id },
            data: {
                status: 'FAILED',
                raw_ipn_payload: {
                    step: 'create_vip_payment_link',
                    error: err?.message || 'Unknown error',
                },
            },
        });

        throw Object.assign(new Error(`Không thể tạo link thanh toán VIP: ${err.message}`), {
            statusCode: 502,
        });
    }
}

async function verifyVipPurchase(userId, orderCode) {
    if (!orderCode) {
        throw Object.assign(new Error('Thiếu orderCode'), { statusCode: 400 });
    }

    const orderCodeText = String(orderCode).trim();
    const orderCodeNumber = Number(orderCodeText);
    if (!Number.isFinite(orderCodeNumber) || orderCodeNumber <= 0) {
        throw Object.assign(new Error('orderCode không hợp lệ'), { statusCode: 400 });
    }

    const order = await prisma.payment_orders.findUnique({
        where: { vnp_txn_ref: orderCodeText },
    });

    if (!order) {
        throw Object.assign(new Error('Không tìm thấy giao dịch VIP'), { statusCode: 404 });
    }

    if (order.user_id !== userId) {
        throw Object.assign(new Error('Không có quyền xác minh giao dịch này'), { statusCode: 403 });
    }

    if (order.purpose !== 'VIP_PURCHASE') {
        throw Object.assign(new Error('Giao dịch không phải mua VIP'), { statusCode: 400 });
    }

    if (order.status === 'SUCCESS') {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { isVip: true, vip_expires_at: true },
        });
        return {
            message: 'Giao dịch VIP đã được xác nhận trước đó',
            data: {
                alreadyConfirmed: true,
                isVip: user?.isVip === true,
                vipExpiresAt: user?.vip_expires_at || null,
            },
        };
    }

    const payos = getPayOSClient();
    let payosPayment;
    try {
        payosPayment = await getPayOSPaymentByOrderCode(payos, orderCodeNumber);
    } catch (err) {
        throw Object.assign(
            new Error(`Không thể xác minh giao dịch với PayOS: ${err.message}`),
            { statusCode: 502 }
        );
    }

    const payosStatus = getPayOSStatus(payosPayment);
    if (payosStatus !== 'PAID') {
        return {
            message: 'Giao dịch VIP chưa được thanh toán',
            data: {
                confirmed: false,
                payosStatus,
            },
        };
    }

    let activationResult = null;
    await prisma.$transaction(async (tx) => {
        const updated = await tx.payment_orders.updateMany({
            where: {
                id: order.id,
                status: { not: 'SUCCESS' },
            },
            data: {
                status: 'SUCCESS',
            },
        });

        if (updated.count > 0) {
            activationResult = await activateVipFromPaymentOrder(tx, order);
            return;
        }

        const user = await tx.user.findUnique({
            where: { id: userId },
            select: { isVip: true, vip_expires_at: true },
        });
        activationResult = {
            activated: false,
            isVip: user?.isVip === true,
            vipExpiresAt: user?.vip_expires_at || null,
        };
    });

    if (activationResult?.activated && activationResult?.userId) {
        prisma.notification.create({
            data: {
                userId: activationResult.userId,
                type: 'PAYMENT',
                status: 'UNREAD',
                title: 'Kích hoạt VIP thành công',
                body: `Gói ${activationResult.packageName} đã được kích hoạt đến ${new Date(activationResult.vipExpiresAt).toLocaleDateString('vi-VN')}.`,
            },
        }).catch((err) => {
            console.error('Không thể gửi notification VIP sau khi kích hoạt:', err);
        });
    }

    return {
        message: 'Mua VIP thành công',
        data: {
            confirmed: true,
            ...activationResult,
        },
    };
}

async function getMyVipStatus(userId) {
    if (!userId) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isVip: true, vip_expires_at: true },
    });

    const purchases = await prisma.user_vip_purchases.findMany({
        where: { user_id: userId },
        orderBy: { start_date: 'desc' },
        take: 10,
        include: { vip_packages: { select: { name: true, duration_days: true, target_role: true } } },
    });

    const now = new Date();
    const isActive = user?.isVip === true && user?.vip_expires_at && new Date(user.vip_expires_at) > now;
    const daysRemaining = isActive
        ? Math.ceil((new Date(user.vip_expires_at) - now) / (1000 * 60 * 60 * 24))
        : 0;

    return {
        data: {
            isVip: isActive === true,
            vipExpiresAt: user?.vip_expires_at || null,
            daysRemaining,
            purchases: purchases.map((p) => ({
                id: p.id,
                packageName: p.vip_packages?.name || 'Gói VIP',
                durationDays: p.vip_packages?.duration_days || 0,
                targetRole: p.vip_packages?.target_role || null,
                startDate: p.start_date,
                endDate: p.end_date,
                pricePaid: Number(p.price_paid),
                createdAt: p.created_at,
            })),
        },
    };
}

module.exports = {
    getVipPackages,
    createVipPurchase,
    verifyVipPurchase,
    activateVipFromPaymentOrder,
    getMyVipStatus,
};