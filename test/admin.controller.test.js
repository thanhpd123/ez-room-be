const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

let mockPrisma, controller;

function setup() {
    mockPrisma = createMockPrisma();
    injectMock('../config/prisma', mockPrisma);
    clearModule('../controllers/admin.controller');
    controller = require('../controllers/admin.controller');
}

/* ════════════════════════════════════════════
   getAllUsers
   ════════════════════════════════════════════ */
describe('admin.controller — getAllUsers', () => {
    beforeEach(() => setup());

    it('should return paginated users', async () => {
        mockPrisma.user.findMany = async () => [
            { id: 'u1', fullName: 'A', email: 'a@x.com', role: 'TENANT', status: 'ACTIVE' },
        ];
        mockPrisma.user.count = async () => 1;
        const req = mockReq({ query: { page: '1', limit: '10' } });
        const res = mockRes();
        await controller.getAllUsers(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 1);
        assert.equal(res._json.pagination.total, 1);
    });

    it('should filter by role', async () => {
        let capturedWhere;
        mockPrisma.user.findMany = async (args) => { capturedWhere = args.where; return []; };
        mockPrisma.user.count = async () => 0;
        const req = mockReq({ query: { role: 'TENANT' } });
        const res = mockRes();
        await controller.getAllUsers(req, res);
        assert.equal(capturedWhere.role, 'TENANT');
    });

    it('should filter by search', async () => {
        let capturedWhere;
        mockPrisma.user.findMany = async (args) => { capturedWhere = args.where; return []; };
        mockPrisma.user.count = async () => 0;
        const req = mockReq({ query: { search: 'John' } });
        const res = mockRes();
        await controller.getAllUsers(req, res);
        assert.ok(capturedWhere.OR);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findMany = async () => { throw new Error('DB'); };
        mockPrisma.user.count = async () => { throw new Error('DB'); };
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getAllUsers(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getUserById
   ════════════════════════════════════════════ */
describe('admin.controller — getUserById', () => {
    beforeEach(() => setup());

    it('should return user', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'u1', fullName: 'A', email: 'a@x.com', role: 'TENANT', status: 'ACTIVE',
        });
        const req = mockReq({ params: { userId: 'u1' } });
        const res = mockRes();
        await controller.getUserById(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.id, 'u1');
    });

    it('should return 404', async () => {
        mockPrisma.user.findUnique = async () => null;
        const req = mockReq({ params: { userId: 'bad' } });
        const res = mockRes();
        await controller.getUserById(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { userId: 'u1' } });
        const res = mockRes();
        await controller.getUserById(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   updateUserRole
   ════════════════════════════════════════════ */
describe('admin.controller — updateUserRole', () => {
    beforeEach(() => setup());

    it('should update role successfully', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'u2', fullName: 'B', email: 'b@x.com', role: 'TENANT',
        });
        mockPrisma.user.update = async () => ({
            id: 'u2', fullName: 'B', email: 'b@x.com', role: 'LANDLORD', status: 'ACTIVE',
        });
        const req = mockReq({ params: { userId: 'u2' }, body: { role: 'LANDLORD' } });
        const res = mockRes();
        await controller.updateUserRole(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.role, 'LANDLORD');
    });

    it('should reject invalid role', async () => {
        const req = mockReq({ params: { userId: 'u2' }, body: { role: 'INVALID' } });
        const res = mockRes();
        await controller.updateUserRole(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject self-update', async () => {
        const req = mockReq({ params: { userId: 'user-1' }, body: { role: 'ADMIN' } });
        const res = mockRes();
        await controller.updateUserRole(req, res);
        assert.equal(res._status, 403);
    });

    it('should reject updating another admin', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'u2', fullName: 'Admin2', role: 'ADMIN',
        });
        const req = mockReq({ params: { userId: 'u2' }, body: { role: 'TENANT' } });
        const res = mockRes();
        await controller.updateUserRole(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 404 when user not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const req = mockReq({ params: { userId: 'bad' }, body: { role: 'TENANT' } });
        const res = mockRes();
        await controller.updateUserRole(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', role: 'TENANT' });
        mockPrisma.user.update = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { userId: 'u2' }, body: { role: 'LANDLORD' } });
        const res = mockRes();
        await controller.updateUserRole(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   updateUserStatus
   ════════════════════════════════════════════ */
describe('admin.controller — updateUserStatus', () => {
    beforeEach(() => setup());

    it('should update status successfully', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'u2', fullName: 'B', role: 'TENANT',
        });
        mockPrisma.user.update = async () => ({
            id: 'u2', fullName: 'B', email: 'b@x.com', role: 'TENANT', status: 'BANNED',
        });
        const req = mockReq({ params: { userId: 'u2' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await controller.updateUserStatus(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.status, 'BANNED');
    });

    it('should reject invalid status', async () => {
        const req = mockReq({ params: { userId: 'u2' }, body: { status: 'INVALID' } });
        const res = mockRes();
        await controller.updateUserStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject self-update', async () => {
        const req = mockReq({ params: { userId: 'user-1' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await controller.updateUserStatus(req, res);
        assert.equal(res._status, 403);
    });

    it('should reject updating another admin', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'u2', fullName: 'Admin2', role: 'ADMIN',
        });
        const req = mockReq({ params: { userId: 'u2' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await controller.updateUserStatus(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 404 when user not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const req = mockReq({ params: { userId: 'bad' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await controller.updateUserStatus(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', role: 'TENANT' });
        mockPrisma.user.update = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { userId: 'u2' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await controller.updateUserStatus(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getDashboardStats
   ════════════════════════════════════════════ */
describe('admin.controller — getDashboardStats', () => {
    beforeEach(() => setup());

    it('should return stats', async () => {
        mockPrisma.user.count = async (args) => {
            if (!args) return 100;
            if (args.where?.role === 'ADMIN') return 2;
            if (args.where?.role === 'LANDLORD') return 20;
            if (args.where?.role === 'TENANT') return 70;
            if (args.where?.role === 'MODERATOR') return 3;
            if (args.where?.status === 'ACTIVE') return 90;
            if (args.where?.status === 'BANNED') return 5;
            return 0;
        };
        const req = mockReq();
        const res = mockRes();
        await controller.getDashboardStats(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.users.total, 100);
        assert.equal(res._json.data.users.byRole.admins, 2);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.count = async () => { throw new Error('DB'); };
        const req = mockReq();
        const res = mockRes();
        await controller.getDashboardStats(req, res);
        assert.equal(res._status, 500);
    });
});
