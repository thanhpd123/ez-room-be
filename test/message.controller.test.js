const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();

function loadController() {
    clearModule('../controllers/message.controller');
    injectMock('../config/prisma', mockPrisma);
    return require('../controllers/message.controller');
}

const sentMsgs = [
    { receiverId: 'user-2', created_at: new Date('2024-01-02'), content: 'hi', id: 'm1' },
];
const receivedMsgs = [
    { senderId: 'user-2', created_at: new Date('2024-01-03'), content: 'hello', id: 'm2', status: 'SENT' },
];
const fakeUser2 = { id: 'user-2', fullName: 'User Two', avatarUrl: null };

/* ================================================================
   getConversations
   ================================================================ */
describe('Message > getConversations', () => {
    beforeEach(() => {
        mockPrisma.message.findMany = async ({ where }) => {
            if (where.senderId) return sentMsgs;
            return receivedMsgs;
        };
        mockPrisma.user.findMany = async () => [fakeUser2];
    });

    it('should return conversations list', async () => {
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getConversations(req, res);
        assert.equal(res._json.success, true);
        assert.ok(Array.isArray(res._json.data));
        assert.equal(res._json.data.length, 1);
        assert.equal(res._json.data[0].peer.id, 'user-2');
        assert.equal(res._json.data[0].unreadCount, 1);
    });

    it('should return empty when no messages', async () => {
        mockPrisma.message.findMany = async () => [];
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getConversations(req, res);
        assert.deepEqual(res._json.data, []);
    });

    it('should handle missing peer user gracefully', async () => {
        mockPrisma.user.findMany = async () => [];
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getConversations(req, res);
        assert.equal(res._json.data[0].peer.fullName, '—');
    });

    it('should return 500 on error', async () => {
        mockPrisma.message.findMany = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getConversations(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getThread
   ================================================================ */
describe('Message > getThread', () => {
    const fullMsgs = Array.from({ length: 3 }, (_, i) => ({
        id: `m${i}`,
        senderId: i % 2 === 0 ? 'user-1' : 'user-2',
        receiverId: i % 2 === 0 ? 'user-2' : 'user-1',
        content: `msg ${i}`,
        message_type: 'TEXT',
        status: 'SENT',
        created_at: new Date(2024, 0, i + 1),
        sender: fakeUser2,
    }));

    beforeEach(() => {
        mockPrisma.user.findUnique = async () => fakeUser2;
        mockPrisma.message.findMany = async () => fullMsgs;
        mockPrisma.message.updateMany = async () => ({ count: 1 });
    });

    it('should return thread messages', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' }, query: {} });
        const res = mockRes();
        await ctrl.getThread(req, res);
        assert.equal(res._json.success, true);
        assert.ok(Array.isArray(res._json.data.messages));
    });

    it('should reject self conversation', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-1' }, query: {} });
        const res = mockRes();
        await ctrl.getThread(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 when other user not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-99' }, query: {} });
        const res = mockRes();
        await ctrl.getThread(req, res);
        assert.equal(res._status, 404);
    });

    it('should handle cursor pagination', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' }, query: { before: '2024-01-03T00:00:00Z', limit: '2' } });
        const res = mockRes();
        await ctrl.getThread(req, res);
        assert.equal(res._json.success, true);
    });

    it('should mark messages as READ', async () => {
        let updateCalled = false;
        mockPrisma.message.updateMany = async () => { updateCalled = true; return { count: 1 }; };
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' }, query: {} });
        const res = mockRes();
        await ctrl.getThread(req, res);
        assert.ok(updateCalled);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' }, query: {} });
        const res = mockRes();
        await ctrl.getThread(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   sendMessage
   ================================================================ */
describe('Message > sendMessage', () => {
    beforeEach(() => {
        mockPrisma.user.findUnique = async () => ({ id: 'user-2', status: 'ACTIVE' });
        mockPrisma.message.create = async () => ({
            id: 'm1', senderId: 'user-1', receiverId: 'user-2', content: 'hi',
            message_type: 'TEXT', status: 'SENT', created_at: new Date(),
            sender: { id: 'user-1', fullName: 'Me', avatarUrl: null },
        });
    });

    it('should send message successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { receiverId: 'user-2', content: 'hello' } });
        const res = mockRes();
        await ctrl.sendMessage(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.data.isFromMe, true);
    });

    it('should reject when receiverId is missing', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { content: 'hello' } });
        const res = mockRes();
        await ctrl.sendMessage(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject empty content', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { receiverId: 'user-2', content: '   ' } });
        const res = mockRes();
        await ctrl.sendMessage(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject content longer than 5000 chars', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { receiverId: 'user-2', content: 'a'.repeat(5001) } });
        const res = mockRes();
        await ctrl.sendMessage(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject self-message', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { receiverId: 'user-1', content: 'hi self' } });
        const res = mockRes();
        await ctrl.sendMessage(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 when receiver not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ body: { receiverId: 'user-99', content: 'hi' } });
        const res = mockRes();
        await ctrl.sendMessage(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 404 when receiver is inactive', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'user-2', status: 'BANNED' });
        const ctrl = loadController();
        const req = mockReq({ body: { receiverId: 'user-2', content: 'hi' } });
        const res = mockRes();
        await ctrl.sendMessage(req, res);
        assert.equal(res._status, 404);
    });

    it('should reject non-string receiverId', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { receiverId: 123, content: 'hi' } });
        const res = mockRes();
        await ctrl.sendMessage(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'user-2', status: 'ACTIVE' });
        mockPrisma.message.create = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ body: { receiverId: 'user-2', content: 'hi' } });
        const res = mockRes();
        await ctrl.sendMessage(req, res);
        assert.equal(res._status, 500);
    });
});
