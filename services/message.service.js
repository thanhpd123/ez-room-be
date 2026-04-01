const prisma = require('../config/prisma');
const { emitToUser } = require('../utils/socket-manager');

/**
 * Lấy danh sách hội thoại dùng raw SQL với DISTINCT ON để tránh load toàn bộ tin nhắn.
 * Một query thay thế hai findMany() không giới hạn.
 * NOTE: userId is embedded directly (not as $1) because Prisma passes params as text,
 * which breaks UUID column comparisons. userId is a trusted value from JWT auth.
 */
async function getConversations(userId) {
    // Validate UUID format to prevent any injection risk before embedding
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        throw Object.assign(new Error('Invalid userId'), { statusCode: 400 });
    }

    // Single SQL: latest message per (user pair) + unread count in one pass
    const rows = await prisma.$queryRawUnsafe(`
        WITH pairs AS (
            SELECT
                CASE WHEN sender_id = '${userId}'::uuid THEN receiver_id ELSE sender_id END AS peer_id,
                id, content, created_at, sender_id, status
            FROM messages
            WHERE sender_id = '${userId}'::uuid OR receiver_id = '${userId}'::uuid
        ),
        latest AS (
            SELECT DISTINCT ON (peer_id)
                peer_id, id, content, created_at,
                (sender_id = '${userId}'::uuid) AS is_from_me
            FROM pairs
            ORDER BY peer_id, created_at DESC
        ),
        unread AS (
            SELECT sender_id AS peer_id, COUNT(*)::int AS cnt
            FROM messages
            WHERE receiver_id = '${userId}'::uuid AND status::text <> 'READ'
            GROUP BY sender_id
        )
        SELECT l.peer_id::text, l.id::text, l.content, l.created_at, l.is_from_me,
               COALESCE(u.cnt, 0) AS unread_count
        FROM latest l
        LEFT JOIN unread u ON u.peer_id = l.peer_id
        ORDER BY l.created_at DESC
    `);

    if (!rows.length) return { data: [] };

    const peerIds = rows.map((r) => r.peer_id).filter(Boolean);
    const users = await prisma.user.findMany({
        where: { id: { in: peerIds } },
        select: { id: true, fullName: true, avatarUrl: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const list = rows.map((r) => {
        const user = userMap.get(r.peer_id);
        return {
            peer: user
                ? { id: user.id, fullName: user.fullName, avatarUrl: user.avatarUrl }
                : { id: r.peer_id, fullName: '—', avatarUrl: null },
            lastMessage: {
                id: r.id,
                content: r.content,
                created_at: r.created_at,
                isFromMe: Boolean(r.is_from_me),
            },
            unreadCount: Number(r.unread_count),
        };
    });

    return { data: list };
}

/**
 * Lấy tin nhắn giữa user hiện tại và userId (phân trang)
 */
async function getThread(userId, otherId, params) {
    const { limit = 50, before } = params;

    if (!userId || !otherId) {
        throw Object.assign(new Error('userId và otherId không được để trống'), { statusCode: 400 });
    }

    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    if (otherId === userId) {
        throw Object.assign(new Error('Không thể xem hội thoại với chính mình'), { statusCode: 400 });
    }

    const other = await prisma.user.findUnique({
        where: { id: otherId },
        select: { id: true, fullName: true, avatarUrl: true },
    });
    if (!other) {
        throw Object.assign(new Error('Người dùng không tồn tại'), { statusCode: 404 });
    }

    const where = {
        OR: [
            { senderId: userId, receiverId: otherId },
            { senderId: otherId, receiverId: userId },
        ],
    };
    if (before) {
        where.created_at = { lt: new Date(before) };
    }

    const messages = await prisma.message.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limitNum + 1,
        include: {
            sender: { select: { id: true, fullName: true, avatarUrl: true } },
        },
    });

    const hasMore = messages.length > limitNum;
    const list = (hasMore ? messages.slice(0, limitNum) : messages)
        .reverse()
        .map((m) => ({
            id: m.id,
            senderId: m.senderId,
            receiverId: m.receiverId,
            content: m.content,
            message_type: m.message_type,
            status: m.status,
            created_at: m.created_at,
            isFromMe: m.senderId === userId,
            sender: m.sender
                ? { id: m.sender.id, fullName: m.sender.fullName, avatarUrl: m.sender.avatarUrl }
                : null,
        }));

    // Mark incoming messages as READ
    await prisma.message.updateMany({
        where: { receiverId: userId, senderId: otherId, status: { not: 'READ' } },
        data: { status: 'READ' },
    });

    // Notify sender via socket that their messages were read
    emitToUser(otherId, 'messages_read', { byUserId: userId });

    return {
        data: {
            peer: other,
            messages: list,
            hasMore,
            nextCursor: hasMore && list.length > 0 ? list[0].created_at : null,
        },
    };
}

/**
 * Gửi tin nhắn + push real-time event via Socket.io
 */
async function sendMessage(userId, body) {
    const { receiverId, content } = body;

    if (!receiverId || typeof receiverId !== 'string') {
        throw Object.assign(new Error('Thiếu receiverId'), { statusCode: 400 });
    }
    const text = typeof content === 'string' ? content.trim() : '';
    if (!text) {
        throw Object.assign(new Error('Nội dung tin nhắn không được để trống'), { statusCode: 400 });
    }
    if (text.length > 5000) {
        throw Object.assign(new Error('Tin nhắn tối đa 5000 ký tự'), { statusCode: 400 });
    }
    if (receiverId === userId) {
        throw Object.assign(new Error('Không thể gửi tin nhắn cho chính mình'), { statusCode: 400 });
    }

    const receiver = await prisma.user.findUnique({ where: { id: receiverId } });
    if (!receiver || receiver.status !== 'ACTIVE') {
        throw Object.assign(new Error('Người nhận không tồn tại'), { statusCode: 404 });
    }

    const message = await prisma.message.create({
        data: {
            senderId: userId,
            receiverId,
            content: text,
            message_type: 'TEXT',
            status: 'SENT',
        },
        include: {
            sender: { select: { id: true, fullName: true, avatarUrl: true } },
        },
    });

    const payload = {
        id: message.id,
        senderId: message.senderId,
        receiverId: message.receiverId,
        content: message.content,
        message_type: message.message_type,
        status: message.status,
        created_at: message.created_at,
        isFromMe: true,
        sender: message.sender,
    };

    // Push to recipient in real-time (isFromMe = false from their perspective)
    emitToUser(receiverId, 'new_message', { ...payload, isFromMe: false });

    // Also push back to sender's OTHER sessions (multi-device sync)
    emitToUser(userId, 'new_message_sent', payload);

    return { data: payload };
}

module.exports = { getConversations, getThread, sendMessage };
