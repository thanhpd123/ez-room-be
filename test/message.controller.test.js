const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

let mockPrisma, controller;

function setup() {
    mockPrisma = createMockPrisma();
    injectMock('../config/prisma', mockPrisma);
    clearModule('../controllers/message.controller');
    controller = require('../controllers/message.controller');
}

/* ════════════════════════════════════════════
   getConversations
   ════════════════════════════════════════════ */
describe('message.controller — getConversations', () => {
    beforeEach(() => setup());

    it('should return conversation list with unread counts', async () => {
        mockPrisma.message.findMany = async (args) => {
            if (args.where.senderId) {
                return [{ id: 'm1', receiverId: 'u2', content: 'Hi', created_at: '2026-01-02', isFromMe: true }];
            }
            return [{ id: 'm2', senderId: 'u2', content: 'Hello', created_at: '2026-01-01', status: 'SENT' }];
        };
        mockPrisma.user.findMany = async () => [
            { id: 'u2', fullName: 'Nguyen B', avatarUrl: null },
        ];
        const req = mockReq();
        const res = mockRes();
        await controller.getConversations(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.length, 1);
        assert.equal(res._json.data[0].peer.id, 'u2');
        assert.equal(res._json.data[0].unreadCount, 1);
    });

    it('should return empty array when no conversations', async () => {
        mockPrisma.message.findMany = async () => [];
        const req = mockReq();
        const res = mockRes();
        await controller.getConversations(req, res);
        assert.equal(res._status, 200);
        assert.deepEqual(res._json.data, []);
    });

    it('should handle unknown peer gracefully', async () => {
        mockPrisma.message.findMany = async (args) => {
            if (args.where.senderId) return [{ id: 'm1', receiverId: 'u-gone', content: 'Hi', created_at: '2026-01-01' }];
            return [];
        };
        mockPrisma.user.findMany = async () => []; // user deleted
        const req = mockReq();
        const res = mockRes();
        await controller.getConversations(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data[0].peer.fullName, '—');
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.message.findMany = async () => { throw new Error('DB'); };
        const req = mockReq();
        const res = mockRes();
        await controller.getConversations(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getThread
   ════════════════════════════════════════════ */
describe('message.controller — getThread', () => {
    beforeEach(() => setup());

    it('should return thread messages and mark as read', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', fullName: 'B', avatarUrl: null });
        mockPrisma.message.findMany = async () => [
            { id: 'm1', senderId: 'u2', receiverId: 'user-1', content: 'Hey', message_type: 'TEXT', status: 'SENT', created_at: '2026-01-01', sender: { id: 'u2', fullName: 'B', avatarUrl: null } },
        ];
        let markReadCalled = false;
        mockPrisma.message.updateMany = async () => { markReadCalled = true; return { count: 1 }; };
        const req = mockReq({ params: { userId: 'u2' }, query: {} });
        const res = mockRes();
        await controller.getThread(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.messages.length, 1);
        assert.equal(res._json.data.peer.id, 'u2');
        assert.ok(markReadCalled);
    });

    it('should reject self-thread', async () => {
        const req = mockReq({ params: { userId: 'user-1' }, query: {} });
        const res = mockRes();
        await controller.getThread(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 if other user not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const req = mockReq({ params: { userId: 'u999' }, query: {} });
        const res = mockRes();
        await controller.getThread(req, res);
        assert.equal(res._status, 404);
    });

    it('should support cursor-based pagination with before param', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', fullName: 'B', avatarUrl: null });
        let capturedWhere = null;
        mockPrisma.message.findMany = async (args) => { capturedWhere = args.where; return []; };
        mockPrisma.message.updateMany = async () => ({ count: 0 });
        const req = mockReq({ params: { userId: 'u2' }, query: { before: '2026-01-01T00:00:00Z' } });
        const res = mockRes();
        await controller.getThread(req, res);
        assert.equal(res._status, 200);
        assert.ok(capturedWhere.created_at);
    });

    it('should indicate hasMore when more messages exist', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', fullName: 'B', avatarUrl: null });
        const msgs = Array.from({ length: 51 }, (_, i) => ({
            id: `m${i}`, senderId: 'u2', receiverId: 'user-1', content: `msg${i}`, message_type: 'TEXT', status: 'SENT', created_at: `2026-01-${String(i + 1).padStart(2, '0')}`, sender: { id: 'u2', fullName: 'B', avatarUrl: null },
        }));
        mockPrisma.message.findMany = async () => msgs;
        mockPrisma.message.updateMany = async () => ({ count: 0 });
        const req = mockReq({ params: { userId: 'u2' }, query: {} });
        const res = mockRes();
        await controller.getThread(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.hasMore, true);
        assert.equal(res._json.data.messages.length, 50);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { userId: 'u2' }, query: {} });
        const res = mockRes();
        await controller.getThread(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   sendMessage
   ════════════════════════════════════════════ */
describe('message.controller — sendMessage', () => {
    beforeEach(() => setup());

    it('should send a message successfully', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', status: 'ACTIVE' });
        mockPrisma.message.create = async () => ({
            id: 'm-new', senderId: 'user-1', receiverId: 'u2', content: 'Hi there',
            message_type: 'TEXT', status: 'SENT', created_at: '2026-01-01',
            sender: { id: 'user-1', fullName: 'A', avatarUrl: null },
        });
        const req = mockReq({ body: { receiverId: 'u2', content: 'Hi there' } });
        const res = mockRes();
        await controller.sendMessage(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.content, 'Hi there');
        assert.equal(res._json.data.isFromMe, true);
    });

    it('should reject missing receiverId', async () => {
        const req = mockReq({ body: { content: 'Hi' } });
        const res = mockRes();
        await controller.sendMessage(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject empty content', async () => {
        const req = mockReq({ body: { receiverId: 'u2', content: '   ' } });
        const res = mockRes();
        await controller.sendMessage(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject content over 5000 chars', async () => {
        const req = mockReq({ body: { receiverId: 'u2', content: 'x'.repeat(5001) } });
        const res = mockRes();
        await controller.sendMessage(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject self-send', async () => {
        const req = mockReq({ body: { receiverId: 'user-1', content: 'Hi' } });
        const res = mockRes();
        await controller.sendMessage(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 if receiver not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const req = mockReq({ body: { receiverId: 'u-gone', content: 'Hi' } });
        const res = mockRes();
        await controller.sendMessage(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 404 if receiver is inactive', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', status: 'BANNED' });
        const req = mockReq({ body: { receiverId: 'u2', content: 'Hi' } });
        const res = mockRes();
        await controller.sendMessage(req, res);
        assert.equal(res._status, 404);
    });

    it('should reject non-string receiverId', async () => {
        const req = mockReq({ body: { receiverId: 123, content: 'Hi' } });
        const res = mockRes();
        await controller.sendMessage(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', status: 'ACTIVE' });
        mockPrisma.message.create = async () => { throw new Error('DB'); };
        const req = mockReq({ body: { receiverId: 'u2', content: 'Hi' } });
        const res = mockRes();
        await controller.sendMessage(req, res);
        assert.equal(res._status, 500);
    });
});
