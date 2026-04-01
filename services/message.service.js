const prisma = require('../config/prisma');

/**
 * Lấy danh sách hội thoại (peers + last message + unread count)
 */
async function getConversations(userId) {
    const sent = await prisma.message.findMany({
        where: { senderId: userId },
        select: { receiverId: true, created_at: true, content: true, id: true },
        orderBy: { created_at: 'desc' },
    });
    const received = await prisma.message.findMany({
        where: { receiverId: userId },
        select: { senderId: true, created_at: true, content: true, id: true, status: true },
        orderBy: { created_at: 'desc' },
    });

    const peerToLast = new Map();
    const peerToUnread = new Map();

    sent.forEach((m) => {
        const peer = m.receiverId;
        if (
            !peerToLast.has(peer) ||
            new Date(m.created_at) > new Date(peerToLast.get(peer).created_at)
        ) {
            peerToLast.set(peer, {
                id: m.id,
                content: m.content,
                created_at: m.created_at,
                isFromMe: true,
            });
        }
        if (!peerToUnread.has(peer)) peerToUnread.set(peer, 0);
    });

    received.forEach((m) => {
        const peer = m.senderId;
        if (
            !peerToLast.has(peer) ||
            new Date(m.created_at) > new Date(peerToLast.get(peer).created_at)
        ) {
            peerToLast.set(peer, {
                id: m.id,
                content: m.content,
                created_at: m.created_at,
                isFromMe: false,
            });
        }
        const prev = peerToUnread.get(peer) || 0;
        peerToUnread.set(peer, m.status !== 'READ' ? prev + 1 : prev);
    });

    const peerIds = [...peerToLast.keys()].filter((id) => id !== userId);
    if (peerIds.length === 0) {
        return { data: [] };
    }

    const users = await prisma.user.findMany({
        where: { id: { in: peerIds } },
        select: { id: true, fullName: true, avatarUrl: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const list = peerIds.map((peerId) => {
        const last = peerToLast.get(peerId);
        const user = userMap.get(peerId);
        return {
            peer: user
                ? { id: user.id, fullName: user.fullName, avatarUrl: user.avatarUrl }
                : { id: peerId, fullName: '—', avatarUrl: null },
            lastMessage: last,
            unreadCount: peerToUnread.get(peerId) || 0,
        };
    });

    list.sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));

    return { data: list };
}

/**
 * Lấy tin nhắn giữa user hiện tại và userId (phân trang)
 */
async function getThread(userId, otherId, params) {
    const { limit = 50, before } = params;
    
    // Validate IDs are proper UUIDs or strings
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
                ? {
                      id: m.sender.id,
                      fullName: m.sender.fullName,
                      avatarUrl: m.sender.avatarUrl,
                  }
                : null,
        }));

    await prisma.message.updateMany({
        where: { receiverId: userId, senderId: otherId, status: { not: 'READ' } },
        data: { status: 'READ' },
    });

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
 * Gửi tin nhắn
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

    const receiver = await prisma.user.findUnique({
        where: { id: receiverId },
    });
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

    return {
        data: {
            id: message.id,
            senderId: message.senderId,
            receiverId: message.receiverId,
            content: message.content,
            message_type: message.message_type,
            status: message.status,
            created_at: message.created_at,
            isFromMe: true,
            sender: message.sender,
        },
    };
}

module.exports = {
    getConversations,
    getThread,
    sendMessage,
};
