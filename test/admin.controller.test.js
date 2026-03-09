const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();

function loadController() {
    clearModule('../controllers/admin.controller');
    injectMock('../config/prisma', mockPrisma);
    return require('../controllers/admin.controller');
}

const fakeUser = {
    id: 'user-2', fullName: 'Target User', email: 'target@example.com', phone: '0900000001',
    avatarUrl: null, role: 'TENANT', status: 'ACTIVE', createdAt: new Date(), updated_at: new Date(),
    wallet: null, rentals: [], lifestyleProfile: null, preference: null,
    favoriteRooms: [], preorders: [],
};

/* ================================================================
   getAllUsers
   ================================================================ */
describe('Admin > getAllUsers', () => {
    beforeEach(() => {
        mockPrisma.user.findMany = async () => [fakeUser];
        mockPrisma.user.count = async () => 1;
    });

    it('should return paginated users', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: { page: '1', limit: '10' } });
        const res = mockRes();
        await ctrl.getAllUsers(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.length, 1);
        assert.ok(res._json.pagination);
    });

    it('should filter by role', async () => {
        let capturedWhere = null;
        mockPrisma.user.findMany = async (args) => { capturedWhere = args?.where; return []; };
        mockPrisma.user.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { role: 'TENANT' } });
        const res = mockRes();
        await ctrl.getAllUsers(req, res);
        assert.equal(capturedWhere.role, 'TENANT');
    });

    it('should search by keyword', async () => {
        let capturedWhere = null;
        mockPrisma.user.findMany = async (args) => { capturedWhere = args?.where; return []; };
        mockPrisma.user.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { search: 'test' } });
        const res = mockRes();
        await ctrl.getAllUsers(req, res);
        assert.ok(capturedWhere.OR);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.findMany = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getAllUsers(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getUserById
   ================================================================ */
describe('Admin > getUserById', () => {
    beforeEach(() => {
        mockPrisma.user.findUnique = async () => fakeUser;
    });

    it('should return user detail', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' } });
        const res = mockRes();
        await ctrl.getUserById(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.id, 'user-2');
    });

    it('should return 404 when user not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'nope' } });
        const res = mockRes();
        await ctrl.getUserById(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' } });
        const res = mockRes();
        await ctrl.getUserById(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   updateUserRole
   ================================================================ */
describe('Admin > updateUserRole', () => {
    beforeEach(() => {
        mockPrisma.user.findUnique = async () => fakeUser;
        mockPrisma.user.update = async (args) => ({ ...fakeUser, role: args.data.role });
    });

    it('should update role successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' }, body: { role: 'LANDLORD' } });
        const res = mockRes();
        await ctrl.updateUserRole(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should reject invalid role', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' }, body: { role: 'SUPERUSER' } });
        const res = mockRes();
        await ctrl.updateUserRole(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject self role change', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-1' }, body: { role: 'LANDLORD' } });
        const res = mockRes();
        await ctrl.updateUserRole(req, res);
        assert.equal(res._status, 403);
    });

    it('should reject changing other admin role', async () => {
        mockPrisma.user.findUnique = async () => ({ ...fakeUser, role: 'ADMIN' });
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' }, body: { role: 'TENANT' } });
        const res = mockRes();
        await ctrl.updateUserRole(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 404 when user not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'nope' }, body: { role: 'TENANT' } });
        const res = mockRes();
        await ctrl.updateUserRole(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' }, body: { role: 'TENANT' } });
        const res = mockRes();
        await ctrl.updateUserRole(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   updateUserStatus
   ================================================================ */
describe('Admin > updateUserStatus', () => {
    beforeEach(() => {
        mockPrisma.user.findUnique = async () => fakeUser;
        mockPrisma.user.update = async (args) => ({ ...fakeUser, status: args.data.status });
    });

    it('should update status successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' }, body: { status: 'SUSPENDED' } });
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should reject invalid status', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' }, body: { status: 'DELETED' } });
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject self status change', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-1' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 403);
    });

    it('should reject changing other admin status', async () => {
        mockPrisma.user.findUnique = async () => ({ ...fakeUser, role: 'ADMIN' });
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 404 when user not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'nope' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-2' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getDashboardStats
   ================================================================ */
describe('Admin > getDashboardStats', () => {
    beforeEach(() => {
        mockPrisma.user.count = async () => 10;
        mockPrisma.rental.count = async () => 5;
        mockPrisma.rooms.count = async () => 20;
        mockPrisma.wallet.count = async () => 8;
        mockPrisma.wallet.aggregate = async () => ({ _sum: { balance: 5000000 } });
        mockPrisma.feedback.count = async () => 3;
        mockPrisma.preorder.count = async () => 2;
    });

    it('should return dashboard stats', async () => {
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getDashboardStats(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.ok(res._json.data.users);
        assert.ok(res._json.data.rentals);
        assert.ok(res._json.data.rooms);
        assert.ok(res._json.data.wallets);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.user.count = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getDashboardStats(req, res);
        assert.equal(res._status, 500);
    });
});
