const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();

function loadController() {
    clearModule('../controllers/preorder.controller');
    injectMock('../config/prisma', mockPrisma);
    return require('../controllers/preorder.controller');
}

const fakePreorder = {
    id: 'po-1',
    userId: 'tenant-1',
    roomId: 'room-1',
    status: 'PENDING',
    createdAt: new Date(),
    user: { id: 'tenant-1', fullName: 'Tenant A', email: 'tenant@test.com', phone: '0901234567', avatarUrl: null },
    room: {
        id: 'room-1',
        room_name: 'Phòng 101',
        price: 3000000,
        rentals: { id: 'rental-1', title: 'Nhà trọ ABC', owner_id: 'user-1' },
    },
};

/* ================================================================
   getLandlordRequests
   ================================================================ */
describe('Preorder > getLandlordRequests', () => {
    beforeEach(() => {
        mockPrisma.preorder.findMany = async () => [fakePreorder];
    });

    it('should return list of preorders for landlord', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getLandlordRequests(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.ok(Array.isArray(res._json.data));
    });

    it('should support status filter', async () => {
        let capturedWhere = null;
        mockPrisma.preorder.findMany = async (args) => { capturedWhere = args?.where; return []; };
        const ctrl = loadController();
        const req = mockReq({ query: { status: 'PENDING' } });
        const res = mockRes();
        await ctrl.getLandlordRequests(req, res);
        assert.equal(res._status, 200);
        assert.equal(capturedWhere.status, 'PENDING');
    });

    it('should ignore ALL status filter', async () => {
        let capturedWhere = null;
        mockPrisma.preorder.findMany = async (args) => { capturedWhere = args?.where; return []; };
        const ctrl = loadController();
        const req = mockReq({ query: { status: 'ALL' } });
        const res = mockRes();
        await ctrl.getLandlordRequests(req, res);
        assert.equal(res._status, 200);
        assert.equal(capturedWhere.status, undefined);
    });

    it('should support search filter', async () => {
        let capturedWhere = null;
        mockPrisma.preorder.findMany = async (args) => { capturedWhere = args?.where; return []; };
        const ctrl = loadController();
        const req = mockReq({ query: { search: 'keyword' } });
        const res = mockRes();
        await ctrl.getLandlordRequests(req, res);
        assert.equal(res._status, 200);
        assert.ok(capturedWhere.OR);
    });

    it('should support pagination', async () => {
        let capturedSkip = null;
        mockPrisma.preorder.findMany = async (args) => { capturedSkip = args?.skip; return []; };
        const ctrl = loadController();
        const req = mockReq({ query: { page: '2', limit: '10' } });
        const res = mockRes();
        await ctrl.getLandlordRequests(req, res);
        assert.equal(capturedSkip, 10);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.preorder.findMany = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getLandlordRequests(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   confirmRequest
   ================================================================ */
describe('Preorder > confirmRequest', () => {
    beforeEach(() => {
        mockPrisma.preorder.findUnique = async () => ({
            ...fakePreorder,
            room: { ...fakePreorder.room, rentals: { owner_id: 'user-1' } },
        });
        mockPrisma.preorder.update = async () => ({ ...fakePreorder, status: 'CONFIRMED' });
    });

    it('should confirm a pending preorder', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { preorderId: 'po-1' } });
        const res = mockRes();
        await ctrl.confirmRequest(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.match(res._json.message, /xác nhận/);
    });

    it('should return 404 if preorder not found', async () => {
        mockPrisma.preorder.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { preorderId: 'po-999' } });
        const res = mockRes();
        await ctrl.confirmRequest(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 403 if not the landlord', async () => {
        mockPrisma.preorder.findUnique = async () => ({
            ...fakePreorder,
            room: { ...fakePreorder.room, rentals: { owner_id: 'other-landlord' } },
        });
        const ctrl = loadController();
        const req = mockReq({ params: { preorderId: 'po-1' } });
        const res = mockRes();
        await ctrl.confirmRequest(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 400 if preorder not PENDING', async () => {
        mockPrisma.preorder.findUnique = async () => ({
            ...fakePreorder,
            status: 'CONFIRMED',
            room: { ...fakePreorder.room, rentals: { owner_id: 'user-1' } },
        });
        const ctrl = loadController();
        const req = mockReq({ params: { preorderId: 'po-1' } });
        const res = mockRes();
        await ctrl.confirmRequest(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /đang chờ/);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.preorder.findUnique = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { preorderId: 'po-1' } });
        const res = mockRes();
        await ctrl.confirmRequest(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   rejectRequest
   ================================================================ */
describe('Preorder > rejectRequest', () => {
    beforeEach(() => {
        mockPrisma.preorder.findUnique = async () => ({
            ...fakePreorder,
            room: { ...fakePreorder.room, rentals: { owner_id: 'user-1' } },
        });
        mockPrisma.preorder.update = async () => ({ ...fakePreorder, status: 'CANCELLED' });
    });

    it('should reject a pending preorder', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { preorderId: 'po-1' }, body: { reason: 'Không phù hợp' } });
        const res = mockRes();
        await ctrl.rejectRequest(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.match(res._json.message, /từ chối/);
    });

    it('should reject without reason', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { preorderId: 'po-1' }, body: {} });
        const res = mockRes();
        await ctrl.rejectRequest(req, res);
        assert.equal(res._status, 200);
    });

    it('should return 404 if preorder not found', async () => {
        mockPrisma.preorder.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { preorderId: 'po-999' }, body: {} });
        const res = mockRes();
        await ctrl.rejectRequest(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 403 if not the landlord', async () => {
        mockPrisma.preorder.findUnique = async () => ({
            ...fakePreorder,
            room: { ...fakePreorder.room, rentals: { owner_id: 'other-landlord' } },
        });
        const ctrl = loadController();
        const req = mockReq({ params: { preorderId: 'po-1' }, body: {} });
        const res = mockRes();
        await ctrl.rejectRequest(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 400 if preorder not PENDING', async () => {
        mockPrisma.preorder.findUnique = async () => ({
            ...fakePreorder,
            status: 'CONFIRMED',
            room: { ...fakePreorder.room, rentals: { owner_id: 'user-1' } },
        });
        const ctrl = loadController();
        const req = mockReq({ params: { preorderId: 'po-1' }, body: {} });
        const res = mockRes();
        await ctrl.rejectRequest(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.preorder.findUnique = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { preorderId: 'po-1' }, body: {} });
        const res = mockRes();
        await ctrl.rejectRequest(req, res);
        assert.equal(res._status, 500);
    });
});
