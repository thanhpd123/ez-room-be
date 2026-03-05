const prisma = require('../config/prisma');

/**
 * GET /messages/conversations – list conversations (peers + last message + unread count).
 */
async function getConversations(req, res) {
    try {
        const userId = req.auth.user.id;

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
            if (!peerToLast.has(peer) || new Date(m.created_at) > new Date(peerToLast.get(peer).created_at)) {
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
            if (!peerToLast.has(peer) || new Date(m.created_at) > new Date(peerToLast.get(peer).created_at)) {
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

        const peerIds = [...peerToLast.keys()];
        if (peerIds.length === 0) {
            return res.json({ success: true, data: [] });
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
                peer: user ? {
                    id: user.id,
                    fullName: user.fullName,
                    avatarUrl: user.avatarUrl,
                } : { id: peerId, fullName: '—', avatarUrl: null },
                lastMessage: last,
                unreadCount: peerToUnread.get(peerId) || 0,
            };
        });

        list.sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));

        return res.json({ success: true, data: list });
    } catch (err) {
        console.error('Get conversations error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi tải danh sách hội thoại',
            error: err.message,
        });
    }
}

/**
 * GET /messages/with/:userId – messages between current user and userId (paginated).
 * Query: ?limit=50&before=ISO_DATE (cursor) or ?page=1&limit=50
 */
async function getThread(req, res) {
    try {
        const userId = req.auth.user.id;
        const otherId = req.params.userId;
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const before = req.query.before; // cursor: created_at

        if (otherId === userId) {
            return res.status(400).json({ success: false, message: 'Không thể xem hội thoại với chính mình' });
        }

        const other = await prisma.user.findUnique({
            where: { id: otherId },
            select: { id: true, fullName: true, avatarUrl: true },
        });
        if (!other) {
            return res.status(404).json({ success: false, message: 'Người dùng không tồn tại' });
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
            take: limit + 1,
            include: {
                sender: { select: { id: true, fullName: true, avatarUrl: true } },
            },
        });

        const hasMore = messages.length > limit;
        const list = (hasMore ? messages.slice(0, limit) : messages).reverse().map((m) => ({
            id: m.id,
            senderId: m.senderId,
            receiverId: m.receiverId,
            content: m.content,
            message_type: m.message_type,
            status: m.status,
            created_at: m.created_at,
            isFromMe: m.senderId === userId,
            sender: m.sender ? {
                id: m.sender.id,
                fullName: m.sender.fullName,
                avatarUrl: m.sender.avatarUrl,
            } : null,
        }));

        await prisma.message.updateMany({
            where: { receiverId: userId, senderId: otherId, status: { not: 'READ' } },
            data: { status: 'READ' },
        });

        return res.json({
            success: true,
            data: {
                peer: other,
                messages: list,
                hasMore,
                nextCursor: hasMore && list.length > 0 ? list[0].created_at : null,
            },
        });
    } catch (err) {
        console.error('Get thread error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi tải tin nhắn',
            error: err.message,
        });
    }
}

/**
 * POST /messages – send a text message.
 * Body: { receiverId, content }
 */
async function sendMessage(req, res) {
    try {
        const userId = req.auth.user.id;
        const { receiverId, content } = req.body;

        if (!receiverId || typeof receiverId !== 'string') {
            return res.status(400).json({ success: false, message: 'Thiếu receiverId' });
        }
        const text = typeof content === 'string' ? content.trim() : '';
        if (!text) {
            return res.status(400).json({ success: false, message: 'Nội dung tin nhắn không được để trống' });
        }
        if (text.length > 5000) {
            return res.status(400).json({ success: false, message: 'Tin nhắn tối đa 5000 ký tự' });
        }
        if (receiverId === userId) {
            return res.status(400).json({ success: false, message: 'Không thể gửi tin nhắn cho chính mình' });
        }

        const receiver = await prisma.user.findUnique({
            where: { id: receiverId },
        });
        if (!receiver || receiver.status !== 'ACTIVE') {
            return res.status(404).json({ success: false, message: 'Người nhận không tồn tại' });
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

        return res.status(201).json({
            success: true,
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
        });
    } catch (err) {
        console.error('Send message error:', err);
        return res.status(500).json({
            success: false,
            message: 'Lỗi gửi tin nhắn',
            error: err.message,
        });
    }
}

module.exports = {
    getConversations,
    getThread,
    sendMessage,
};
