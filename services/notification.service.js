const prisma = require('../config/prisma');

/**
 * Helper: parse roomId from body if embedded as ||ROOM_ID:xxx||
 */
function parseRoomIdFromBody(body) {
    if (!body) return null;
    const match = body.match(/\|\|ROOM_ID:([a-f0-9-]+)\|\|/i);
    return match ? match[1] : null;
}

/**
 * Helper: strip the roomId tag from body for display
 */
function cleanBody(body) {
    if (!body) return body;
    return body.replace(/\|\|ROOM_ID:[a-f0-9-]+\|\|/gi, '').trim();
}

/**
 * Lấy danh sách notification của user
 */
async function getMyNotifications(userId, params = {}) {
    const limit = Math.min(50, Math.max(1, parseInt(params.limit) || 20));
    const page = Math.max(1, parseInt(params.page) || 1);
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
            select: {
                id: true,
                userId: true,
                type: true,
                status: true,
                title: true,
                body: true,
                createdAt: true,
            },
        }),
        prisma.notification.count({ where: { userId } }),
    ]);

    return {
        data: notifications.map((n) => ({
            id: n.id,
            type: n.type,
            status: n.status,
            title: n.title,
            body: cleanBody(n.body),
            roomId: parseRoomIdFromBody(n.body),
            createdAt: n.createdAt,
        })),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

/**
 * Đếm notification chưa đọc
 */
async function getUnreadCount(userId) {
    const count = await prisma.notification.count({
        where: { userId, status: 'UNREAD' },
    });
    return { unreadCount: count };
}

/**
 * Đánh dấu 1 notification đã đọc
 */
async function markAsRead(userId, notificationId) {
    const notif = await prisma.notification.findUnique({
        where: { id: notificationId },
        select: { id: true, userId: true, status: true },
    });
    if (!notif || notif.userId !== userId) {
        throw Object.assign(new Error('Không tìm thấy notification'), { statusCode: 404 });
    }
    if (notif.status === 'READ') {
        return { message: 'Đã đọc rồi' };
    }
    await prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'READ' },
    });
    return { message: 'Đã đánh dấu đã đọc' };
}

/**
 * Đánh dấu tất cả notification đã đọc
 */
async function markAllAsRead(userId) {
    const result = await prisma.notification.updateMany({
        where: { userId, status: 'UNREAD' },
        data: { status: 'READ' },
    });
    return { message: `Đã đánh dấu ${result.count} notification đã đọc` };
}

module.exports = {
    getMyNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
};
