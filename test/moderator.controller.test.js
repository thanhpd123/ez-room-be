const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();

// Mock sub-dependencies
const mockValidator = { validateUpdateRentalStatus: (body) => ({ valid: !!body?.status, errors: body?.status ? [] : ['Status không hợp lệ'] }) };
const mockRoomMapper = { mapFeToDb: (v) => v, mapDbToFe: (v) => v || 'single' };

function loadController() {
    clearModule('../controllers/moderator.controller');
    injectMock('../config/prisma', mockPrisma);
    injectMock('../validators/rental.validator', mockValidator);
    injectMock('../utils/room-type-mapper', mockRoomMapper);
    return require('../controllers/moderator.controller');
}

const fakeUser = {
    id: 'u-1', fullName: 'Tenant A', email: 'tenant@test.com', phone: '09012', avatarUrl: null,
    role: 'TENANT', status: 'ACTIVE', createdAt: new Date(), updated_at: new Date(),
    wallet: { id: 'w-1', balance: 0, created_at: new Date() },
    rentals: [], lifestyleProfile: null, preference: null, favoriteRooms: [], preorders: [],
};

const fakeRental = {
    id: 'r-1', title: 'Nhà trọ ABC', description: 'Mô tả', status: 'HIDDEN',
    createdAt: new Date(), location: { id: 'l-1', address: '123 Đường', district: 'Q1', city: 'HCM' },
    images: [], rooms: [], rental_documents: [],
    users: { id: 'u-1', fullName: 'Owner', avatarUrl: null, email: 'o@t.com', phone: '09012' },
};

const fakeRoom = {
    id: 'rm-1', rental_id: 'r-1', room_name: 'Phòng 101', description: '', room_type: 'single',
    price: 3000000, size_m2: 20, max_people: 2, status: 'AVAILABLE', created_at: new Date(),
    images: [{ imageUrl: 'http://img.test/1.jpg' }], roomAmenities: [],
    rentals: { id: 'r-1', title: 'Nhà trọ', status: 'AVAILABLE', location: { address: '123', district: 'Q1', city: 'HCM' } },
};

const fakeLog = { id: 'log-1', moderator_id: 'user-1', target_type: 'RENTAL', target_id: 'r-1', action: 'APPROVE', created_at: new Date(), users: { id: 'user-1', fullName: 'Mod' } };
const fakeQueue = { id: 'q-1', target_type: 'RENTAL', target_id: 'r-1', status: 'OPEN', priority: 'NORMAL', category: 'NEW_LISTING', assigned_to: null, created_at: new Date(), users: null };
const fakeReport = { id: 'rpt-1', reporterId: 'u-2', targetType: 'USER', targetId: 'u-3', reason: 'Spam', status: 'PENDING', createdAt: new Date(), reporter: { id: 'u-2', fullName: 'R', email: 'r@t.com', phone: '09', avatarUrl: null }, moderator: null };
const fakeFeedback = {
    id: 'fb-1', user_id: 'u-2', target_type: 'ROOM', target_id: 'rm-1', rating: 4, comment: 'Tốt',
    status: 'PENDING', reviewed_by: null, moderator_note: null, created_at: new Date(),
    users: { id: 'u-2', fullName: 'Tenant', email: 't@t.com', avatarUrl: null },
};

/* ================================================================
   getAllUsers
   ================================================================ */
describe('Moderator > getAllUsers', () => {
    beforeEach(() => {
        mockPrisma.user.findMany = async () => [fakeUser];
        mockPrisma.user.count = async () => 1;
    });

    it('should return paginated user list', async () => {
        const ctrl = loadController();
        const req = mockReq({ auth: { user: { id: 'mod-1', role: 'MODERATOR' } }, query: {} });
        const res = mockRes();
        await ctrl.getAllUsers(req, res);
        assert.equal(res._status, 200);
        assert.ok(res._json.data.length >= 1);
        assert.ok(res._json.pagination);
    });

    it('should filter by role', async () => {
        let captured = null;
        mockPrisma.user.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.user.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { role: 'TENANT' } });
        const res = mockRes();
        await ctrl.getAllUsers(req, res);
        assert.equal(captured.role, 'TENANT');
    });

    it('should return 400 for invalid role', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: { role: 'ADMIN' } });
        const res = mockRes();
        await ctrl.getAllUsers(req, res);
        assert.equal(res._status, 400);
    });

    it('should support search', async () => {
        let captured = null;
        mockPrisma.user.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.user.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { search: 'keyword' } });
        const res = mockRes();
        await ctrl.getAllUsers(req, res);
        assert.ok(captured.OR);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findMany = async () => { throw new Error('fail'); };
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
describe('Moderator > getUserById', () => {
    beforeEach(() => {
        mockPrisma.user.findUnique = async () => ({ ...fakeUser });
    });

    it('should return user detail', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'u-1' } });
        const res = mockRes();
        await ctrl.getUserById(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.id, 'u-1');
        assert.ok(res._json.data.stats);
    });

    it('should return 404 if user not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'u-999' } });
        const res = mockRes();
        await ctrl.getUserById(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 403 if user role not LANDLORD/TENANT', async () => {
        mockPrisma.user.findUnique = async () => ({ ...fakeUser, role: 'ADMIN' });
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'u-1' } });
        const res = mockRes();
        await ctrl.getUserById(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'u-1' } });
        const res = mockRes();
        await ctrl.getUserById(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   updateUserStatus
   ================================================================ */
describe('Moderator > updateUserStatus', () => {
    beforeEach(() => {
        mockPrisma.user.findUnique = async () => ({ ...fakeUser });
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
        mockPrisma.user.update = async () => ({ ...fakeUser, status: 'BANNED' });
        mockPrisma.moderator_logs.create = async () => ({});
    });

    it('should update user status to BANNED', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'u-1' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should return 400 for invalid status', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'u-1' }, body: { status: 'INVALID' } });
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 400 for missing status', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'u-1' }, body: {} });
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 403 if moderator changes own status', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'user-1' }, body: { status: 'BANNED' } }); // user-1 = req.auth.user.id
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 404 if user not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'u-999' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 403 if target user role is ADMIN', async () => {
        mockPrisma.user.findUnique = async () => ({ ...fakeUser, role: 'ADMIN' });
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'u-1' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { userId: 'u-1' }, body: { status: 'BANNED' } });
        const res = mockRes();
        await ctrl.updateUserStatus(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getRentalsForModeration
   ================================================================ */
describe('Moderator > getRentalsForModeration', () => {
    beforeEach(() => {
        mockPrisma.rental.findMany = async () => [fakeRental];
        mockPrisma.rental.count = async () => 1;
    });

    it('should return paginated rental list', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getRentalsForModeration(req, res);
        assert.equal(res._status, 200);
        assert.ok(Array.isArray(res._json.data));
        assert.ok(res._json.pagination);
    });

    it('should filter by status', async () => {
        let captured = null;
        mockPrisma.rental.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.rental.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { status: 'HIDDEN' } });
        const res = mockRes();
        await ctrl.getRentalsForModeration(req, res);
        assert.equal(captured.status, 'HIDDEN');
    });

    it('should support search', async () => {
        let captured = null;
        mockPrisma.rental.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.rental.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { search: 'nhà trọ' } });
        const res = mockRes();
        await ctrl.getRentalsForModeration(req, res);
        assert.ok(captured.title);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.findMany = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getRentalsForModeration(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   updateRentalStatus
   ================================================================ */
describe('Moderator > updateRentalStatus', () => {
    beforeEach(() => {
        mockPrisma.rental.findUnique = async () => ({ ...fakeRental });
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
        mockPrisma.rental.update = async () => ({ ...fakeRental, status: 'AVAILABLE', location: fakeRental.location });
        mockPrisma.moderation_queue.updateMany = async () => ({});
        mockPrisma.moderator_logs.create = async () => ({});
    });

    it('should update rental status to AVAILABLE', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { rentalId: 'r-1' }, body: { status: 'AVAILABLE' } });
        const res = mockRes();
        await ctrl.updateRentalStatus(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should return 400 for invalid body (validation fail)', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { rentalId: 'r-1' }, body: {} });
        const res = mockRes();
        await ctrl.updateRentalStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 if rental not found', async () => {
        mockPrisma.rental.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { rentalId: 'r-999' }, body: { status: 'AVAILABLE' } });
        const res = mockRes();
        await ctrl.updateRentalStatus(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.findUnique = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { rentalId: 'r-1' }, body: { status: 'AVAILABLE' } });
        const res = mockRes();
        await ctrl.updateRentalStatus(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getRentalStats
   ================================================================ */
describe('Moderator > getRentalStats', () => {
    beforeEach(() => {
        mockPrisma.rental.count = async () => 10;
    });

    it('should return rental statistics', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getRentalStats(req, res);
        assert.equal(res._status, 200);
        assert.ok(res._json.data.total !== undefined);
        assert.ok(res._json.data.byStatus);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.count = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getRentalStats(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getRooms
   ================================================================ */
describe('Moderator > getRooms', () => {
    beforeEach(() => {
        mockPrisma.rooms.findMany = async () => [fakeRoom];
        mockPrisma.rooms.count = async () => 1;
    });

    it('should return room list', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getRooms(req, res);
        assert.equal(res._status, 200);
        assert.ok(Array.isArray(res._json.data));
    });

    it('should filter by rentalId', async () => {
        let captured = null;
        mockPrisma.rooms.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.rooms.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { rentalId: 'r-1' } });
        const res = mockRes();
        await ctrl.getRooms(req, res);
        assert.equal(captured.rental_id, 'r-1');
    });

    it('should filter by price range', async () => {
        let captured = null;
        mockPrisma.rooms.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.rooms.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { minPrice: '1000000', maxPrice: '5000000' } });
        const res = mockRes();
        await ctrl.getRooms(req, res);
        assert.ok(captured.price);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rooms.findMany = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getRooms(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   moderateRoom
   ================================================================ */
describe('Moderator > moderateRoom', () => {
    beforeEach(() => {
        mockPrisma.rooms.findUnique = async () => ({ ...fakeRoom });
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
        mockPrisma.rooms.update = async () => ({ ...fakeRoom, status: 'AVAILABLE' });
        mockPrisma.moderation_queue.updateMany = async () => ({});
        mockPrisma.moderator_logs.create = async () => ({});
    });

    it('should approve a room', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'rm-1' }, body: { decision: 'approved' } });
        const res = mockRes();
        await ctrl.moderateRoom(req, res);
        assert.equal(res._status, 200);
        assert.match(res._json.message, /duyệt/);
    });

    it('should reject a room', async () => {
        mockPrisma.rooms.update = async () => ({ ...fakeRoom, status: 'MAINTENANCE' });
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'rm-1' }, body: { decision: 'rejected', note: 'Vi phạm' } });
        const res = mockRes();
        await ctrl.moderateRoom(req, res);
        assert.equal(res._status, 200);
        assert.match(res._json.message, /từ chối/);
    });

    it('should return 400 for invalid decision', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'rm-1' }, body: { decision: 'maybe' } });
        const res = mockRes();
        await ctrl.moderateRoom(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 400 if decision missing', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'rm-1' }, body: {} });
        const res = mockRes();
        await ctrl.moderateRoom(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 if room not found', async () => {
        mockPrisma.rooms.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'rm-999' }, body: { decision: 'approved' } });
        const res = mockRes();
        await ctrl.moderateRoom(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rooms.findUnique = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'rm-1' }, body: { decision: 'approved' } });
        const res = mockRes();
        await ctrl.moderateRoom(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getModeratorLogs
   ================================================================ */
describe('Moderator > getModeratorLogs', () => {
    beforeEach(() => {
        mockPrisma.moderator_logs.findMany = async () => [fakeLog];
        mockPrisma.moderator_logs.count = async () => 1;
    });

    it('should return log list', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getModeratorLogs(req, res);
        assert.equal(res._status, 200);
        assert.ok(Array.isArray(res._json.data));
    });

    it('should filter by targetType', async () => {
        let captured = null;
        mockPrisma.moderator_logs.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.moderator_logs.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { targetType: 'RENTAL' } });
        const res = mockRes();
        await ctrl.getModeratorLogs(req, res);
        assert.equal(captured.target_type, 'RENTAL');
    });

    it('should filter by action', async () => {
        let captured = null;
        mockPrisma.moderator_logs.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.moderator_logs.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { action: 'APPROVE' } });
        const res = mockRes();
        await ctrl.getModeratorLogs(req, res);
        assert.equal(captured.action, 'APPROVE');
    });

    it('should return 500 on error', async () => {
        mockPrisma.moderator_logs.findMany = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getModeratorLogs(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getModerationQueue
   ================================================================ */
describe('Moderator > getModerationQueue', () => {
    beforeEach(() => {
        mockPrisma.moderation_queue.findMany = async () => [fakeQueue];
        mockPrisma.moderation_queue.count = async () => 1;
    });

    it('should return queue items', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getModerationQueue(req, res);
        assert.equal(res._status, 200);
        assert.ok(Array.isArray(res._json.data));
    });

    it('should filter by status', async () => {
        let captured = null;
        mockPrisma.moderation_queue.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.moderation_queue.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { status: 'OPEN' } });
        const res = mockRes();
        await ctrl.getModerationQueue(req, res);
        assert.equal(captured.status, 'OPEN');
    });

    it('should filter by priority', async () => {
        let captured = null;
        mockPrisma.moderation_queue.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.moderation_queue.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { priority: 'HIGH' } });
        const res = mockRes();
        await ctrl.getModerationQueue(req, res);
        assert.equal(captured.priority, 'HIGH');
    });

    it('should return 500 on error', async () => {
        mockPrisma.moderation_queue.findMany = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getModerationQueue(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getQueueActivity
   ================================================================ */
describe('Moderator > getQueueActivity', () => {
    beforeEach(() => {
        mockPrisma.moderator_logs.findMany = async () => [fakeLog];
        mockPrisma.moderator_logs.count = async () => 1;
    });

    it('should return queue activity list', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getQueueActivity(req, res);
        assert.equal(res._status, 200);
        assert.ok(Array.isArray(res._json.data));
    });

    it('should filter by action CLAIM', async () => {
        let captured = null;
        mockPrisma.moderator_logs.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.moderator_logs.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { action: 'CLAIM' } });
        const res = mockRes();
        await ctrl.getQueueActivity(req, res);
        assert.equal(captured.action, 'CLAIM');
    });

    it('should return 500 on error', async () => {
        mockPrisma.moderator_logs.findMany = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getQueueActivity(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   assignQueueItem
   ================================================================ */
describe('Moderator > assignQueueItem', () => {
    beforeEach(() => {
        mockPrisma.moderation_queue.findUnique = async () => ({ ...fakeQueue, status: 'OPEN' });
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
        mockPrisma.moderation_queue.update = async () => ({ ...fakeQueue, status: 'IN_PROGRESS', assigned_to: 'user-1', users: { id: 'user-1', fullName: 'Mod' } });
        mockPrisma.moderator_logs.create = async () => ({});
    });

    it('should assign queue item to self', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'q-1' }, body: {} });
        const res = mockRes();
        await ctrl.assignQueueItem(req, res);
        assert.equal(res._status, 200);
        assert.match(res._json.message, /nhận task/);
    });

    it('should assign to specific user', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'q-1' }, body: { assignTo: 'mod-2' } });
        const res = mockRes();
        await ctrl.assignQueueItem(req, res);
        assert.equal(res._status, 200);
    });

    it('should return 401 if no auth', async () => {
        const ctrl = loadController();
        const req = mockReq({ auth: { user: {} }, params: { id: 'q-1' }, body: {} });
        req.auth.user.id = undefined;
        const res = mockRes();
        await ctrl.assignQueueItem(req, res);
        assert.equal(res._status, 401);
    });

    it('should return 404 if queue item not found', async () => {
        mockPrisma.moderation_queue.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'q-999' }, body: {} });
        const res = mockRes();
        await ctrl.assignQueueItem(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 400 if item not OPEN', async () => {
        mockPrisma.moderation_queue.findUnique = async () => ({ ...fakeQueue, status: 'IN_PROGRESS' });
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'q-1' }, body: {} });
        const res = mockRes();
        await ctrl.assignQueueItem(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on error', async () => {
        mockPrisma.moderation_queue.findUnique = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'q-1' }, body: {} });
        const res = mockRes();
        await ctrl.assignQueueItem(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   releaseQueueItem
   ================================================================ */
describe('Moderator > releaseQueueItem', () => {
    beforeEach(() => {
        mockPrisma.moderation_queue.findUnique = async () => ({ ...fakeQueue, status: 'IN_PROGRESS', assigned_to: 'user-1' });
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
        mockPrisma.moderation_queue.update = async () => ({ ...fakeQueue, status: 'OPEN', assigned_to: null });
        mockPrisma.moderator_logs.create = async () => ({});
    });

    it('should release queue item back to queue', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'q-1' } });
        const res = mockRes();
        await ctrl.releaseQueueItem(req, res);
        assert.equal(res._status, 200);
        assert.match(res._json.message, /trả task/);
    });

    it('should return 401 if no auth', async () => {
        const ctrl = loadController();
        const req = mockReq({ auth: { user: {} }, params: { id: 'q-1' } });
        req.auth.user.id = undefined;
        const res = mockRes();
        await ctrl.releaseQueueItem(req, res);
        assert.equal(res._status, 401);
    });

    it('should return 404 if queue item not found', async () => {
        mockPrisma.moderation_queue.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'q-999' } });
        const res = mockRes();
        await ctrl.releaseQueueItem(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 400 if item not IN_PROGRESS', async () => {
        mockPrisma.moderation_queue.findUnique = async () => ({ ...fakeQueue, status: 'OPEN' });
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'q-1' } });
        const res = mockRes();
        await ctrl.releaseQueueItem(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 403 if not assigned moderator', async () => {
        mockPrisma.moderation_queue.findUnique = async () => ({ ...fakeQueue, status: 'IN_PROGRESS', assigned_to: 'other-mod' });
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'q-1' } });
        const res = mockRes();
        await ctrl.releaseQueueItem(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 500 on error', async () => {
        mockPrisma.moderation_queue.findUnique = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'q-1' } });
        const res = mockRes();
        await ctrl.releaseQueueItem(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getReports (moderator)
   ================================================================ */
describe('Moderator > getReports', () => {
    beforeEach(() => {
        mockPrisma.report.findMany = async () => [fakeReport];
        mockPrisma.report.count = async () => 1;
        mockPrisma.user.findMany = async () => [];
    });

    it('should return reports list', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getReports(req, res);
        assert.equal(res._status, 200);
        assert.ok(Array.isArray(res._json.data));
    });

    it('should filter by status', async () => {
        let captured = null;
        mockPrisma.report.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.report.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { status: 'PENDING' } });
        const res = mockRes();
        await ctrl.getReports(req, res);
        assert.equal(captured.status, 'PENDING');
    });

    it('should return 500 on error', async () => {
        mockPrisma.report.findMany = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getReports(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   handleReport (moderator)
   ================================================================ */
describe('Moderator > handleReport', () => {
    beforeEach(() => {
        mockPrisma.report.findUnique = async () => ({ ...fakeReport, status: 'PENDING' });
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
        mockPrisma.report.update = async () => ({ ...fakeReport, status: 'APPROVED', moderator: { id: 'user-1', fullName: 'Mod' } });
        mockPrisma.moderation_queue.updateMany = async () => ({});
        mockPrisma.moderator_logs.create = async () => ({});
    });

    it('should handle report with APPROVED', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-1' }, body: { status: 'APPROVED' } });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should return 400 for invalid status', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-1' }, body: { status: 'PENDING' } });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 if report not found', async () => {
        mockPrisma.report.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-999' }, body: { status: 'APPROVED' } });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 400 if already handled', async () => {
        mockPrisma.report.findUnique = async () => ({ ...fakeReport, status: 'APPROVED' });
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-1' }, body: { status: 'REJECTED' } });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on error', async () => {
        mockPrisma.report.findUnique = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-1' }, body: { status: 'APPROVED' } });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getReviewsForModeration
   ================================================================ */
describe('Moderator > getReviewsForModeration', () => {
    beforeEach(() => {
        mockPrisma.feedback.findMany = async () => [fakeFeedback];
        mockPrisma.feedback.count = async () => 1;
        mockPrisma.rooms.findMany = async () => [];
    });

    it('should return reviews list', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getReviewsForModeration(req, res);
        assert.equal(res._status, 200);
        assert.ok(Array.isArray(res._json.data));
    });

    it('should filter by status', async () => {
        let captured = null;
        mockPrisma.feedback.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.feedback.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { status: 'PENDING' } });
        const res = mockRes();
        await ctrl.getReviewsForModeration(req, res);
        assert.equal(captured.status, 'PENDING');
    });

    it('should filter by roomId', async () => {
        let captured = null;
        mockPrisma.feedback.findMany = async (a) => { captured = a?.where; return []; };
        mockPrisma.feedback.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { roomId: 'rm-1' } });
        const res = mockRes();
        await ctrl.getReviewsForModeration(req, res);
        assert.equal(captured.target_id, 'rm-1');
    });

    it('should return 500 on error', async () => {
        mockPrisma.feedback.findMany = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getReviewsForModeration(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getReviewDetail
   ================================================================ */
describe('Moderator > getReviewDetail', () => {
    beforeEach(() => {
        mockPrisma.feedback.findUnique = async () => ({
            ...fakeFeedback,
            users_feedback_reviewed_byTousers: null,
            room_rental_periods: {
                startDate: new Date('2025-01-01'),
                endDate: new Date('2025-02-01'),
                actualPrice: 3000000,
                room: {
                    id: 'rm-1', room_name: 'Phòng 101',
                    rentals: { title: 'Nhà trọ', owner_id: 'u-1', location: { address: '123', district: 'Q1', city: 'HCM' } },
                    images: [{ imageUrl: 'http://img/1.jpg' }],
                },
            },
        });
    });

    it('should return feedback detail', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-1' } });
        const res = mockRes();
        await ctrl.getReviewDetail(req, res);
        assert.equal(res._status, 200);
        assert.ok(res._json.data.rating);
        assert.ok(res._json.data.tenant);
        assert.ok(res._json.data.room);
    });

    it('should return 404 if feedback not found', async () => {
        mockPrisma.feedback.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-999' } });
        const res = mockRes();
        await ctrl.getReviewDetail(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.feedback.findUnique = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-1' } });
        const res = mockRes();
        await ctrl.getReviewDetail(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   updateReviewStatus
   ================================================================ */
describe('Moderator > updateReviewStatus', () => {
    beforeEach(() => {
        mockPrisma.feedback.findUnique = async () => ({
            ...fakeFeedback,
            users_feedback_reviewed_byTousers: null,
            room_rental_periods: { room: { rentals: { owner_id: 'u-owner', title: 'Nhà trọ' } } },
        });
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
        mockPrisma.feedback.update = async () => ({ id: 'fb-1', status: 'APPROVED' });
        mockPrisma.moderation_queue.updateMany = async () => ({});
        mockPrisma.moderator_logs.create = async () => ({});
        mockPrisma.notification.create = async () => ({});
    });

    it('should approve a review', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-1' }, body: { status: 'APPROVED' } });
        const res = mockRes();
        await ctrl.updateReviewStatus(req, res);
        assert.equal(res._status, 200);
        assert.match(res._json.message, /duyệt/);
    });

    it('should reject a review with note ≥ 10 chars', async () => {
        mockPrisma.feedback.update = async () => ({ id: 'fb-1', status: 'REJECTED' });
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-1' }, body: { status: 'REJECTED', moderatorNote: 'Nội dung không phù hợp với chính sách' } });
        const res = mockRes();
        await ctrl.updateReviewStatus(req, res);
        assert.equal(res._status, 200);
    });

    it('should return 400 if REJECTED without sufficient note', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-1' }, body: { status: 'REJECTED', moderatorNote: 'short' } });
        const res = mockRes();
        await ctrl.updateReviewStatus(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /10 ký tự/);
    });

    it('should hide an APPROVED review with note ≥ 10 chars', async () => {
        mockPrisma.feedback.findUnique = async () => ({
            ...fakeFeedback,
            status: 'APPROVED',
            users_feedback_reviewed_byTousers: null,
            room_rental_periods: { room: { rentals: { owner_id: 'u-owner', title: 'Nhà trọ' } } },
        });
        mockPrisma.feedback.update = async () => ({ id: 'fb-1', status: 'HIDDEN' });
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-1' }, body: { status: 'HIDDEN', moderatorNote: 'Vi phạm chính sách cộng đồng' } });
        const res = mockRes();
        await ctrl.updateReviewStatus(req, res);
        assert.equal(res._status, 200);
    });

    it('should return 400 if HIDDEN on non-APPROVED review', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-1' }, body: { status: 'HIDDEN', moderatorNote: 'Vi phạm chính sách cộng đồng' } });
        const res = mockRes();
        await ctrl.updateReviewStatus(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /đã được duyệt/);
    });

    it('should return 400 for invalid status', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-1' }, body: { status: 'INVALID' } });
        const res = mockRes();
        await ctrl.updateReviewStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 if review not found', async () => {
        mockPrisma.feedback.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-999' }, body: { status: 'APPROVED' } });
        const res = mockRes();
        await ctrl.updateReviewStatus(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 400 if review already processed (not PENDING)', async () => {
        mockPrisma.feedback.findUnique = async () => ({
            ...fakeFeedback,
            status: 'APPROVED',
            users_feedback_reviewed_byTousers: { fullName: 'Other Mod' },
            room_rental_periods: { room: { rentals: { owner_id: 'u-owner' } } },
        });
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-1' }, body: { status: 'APPROVED' } });
        const res = mockRes();
        await ctrl.updateReviewStatus(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /đã được xử lý/);
    });

    it('should return 500 on error', async () => {
        mockPrisma.feedback.findUnique = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-1' }, body: { status: 'APPROVED' } });
        const res = mockRes();
        await ctrl.updateReviewStatus(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   deleteReview
   ================================================================ */
describe('Moderator > deleteReview', () => {
    beforeEach(() => {
        mockPrisma.feedback.findUnique = async () => ({ ...fakeFeedback });
        mockPrisma.feedback.delete = async () => ({});
    });

    it('should delete a review', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-1' } });
        const res = mockRes();
        await ctrl.deleteReview(req, res);
        assert.equal(res._status, 200);
        assert.match(res._json.message, /xóa/);
    });

    it('should return 404 if review not found', async () => {
        mockPrisma.feedback.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-999' } });
        const res = mockRes();
        await ctrl.deleteReview(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.feedback.findUnique = async () => { throw new Error('fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { reviewId: 'fb-1' } });
        const res = mockRes();
        await ctrl.deleteReview(req, res);
        assert.equal(res._status, 500);
    });
});
