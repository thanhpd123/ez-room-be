const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();

// Mock feedback.config
const mockFeedbackConfig = { MIN_RENTAL_DURATION_MS: 60 * 1000 };

function loadController() {
    clearModule('../controllers/feedback.controller');
    injectMock('../config/prisma', mockPrisma);
    injectMock('../config/feedback.config', mockFeedbackConfig);
    return require('../controllers/feedback.controller');
}

const fakeRentalPeriod = {
    id: 'rp-1',
    userId: 'user-1',
    roomId: 'room-1',
    status: 'ACTIVE',
    startDate: new Date(Date.now() - 2 * 60 * 1000), // 2 phút trước
    feedback: [],
};

const fakeFeedback = {
    id: 'fb-1',
    user_id: 'user-1',
    target_type: 'ROOM',
    target_id: 'room-1',
    rental_period_id: 'rp-1',
    rating: 4,
    comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài',
    status: 'PENDING',
    cleanliness_rating: 4,
    location_rating: 5,
    value_rating: 3,
    landlord_rating: 4,
    moderator_note: null,
    created_at: new Date(),
};

/* ================================================================
   createFeedback
   ================================================================ */
describe('Feedback > createFeedback', () => {
    beforeEach(() => {
        mockPrisma.roomRentalPeriod.findUnique = async () => ({ ...fakeRentalPeriod });
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
        mockPrisma.feedback.create = async () => fakeFeedback;
        mockPrisma.moderation_queue.create = async () => ({});
        mockPrisma.user.findMany = async () => [];
        mockPrisma.notification.createMany = async () => ({});
    });

    it('should create feedback successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({
            body: {
                rentalPeriodId: 'rp-1',
                roomId: 'room-1',
                rating: 4,
                comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài',
                cleanlinessRating: 4,
                locationRating: 5,
                valueRating: 3,
                landlordRating: 4,
            },
        });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
        assert.ok(res._json.data.id);
    });

    it('should return 400 if rentalPeriodId missing', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { roomId: 'room-1', rating: 4, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /rentalPeriodId/);
    });

    it('should return 400 if roomId missing', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-1', rating: 4, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /roomId/);
    });

    it('should return 400 if rating is 0', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-1', roomId: 'room-1', rating: 0, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /1 đến 5/);
    });

    it('should return 400 if rating > 5', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-1', roomId: 'room-1', rating: 6, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /1 đến 5/);
    });

    it('should return 400 if rating is null', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-1', roomId: 'room-1', rating: null, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /1 đến 5/);
    });

    it('should return 400 if comment < 20 chars', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-1', roomId: 'room-1', rating: 4, comment: 'Ngắn quá' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /20 ký tự/);
    });

    it('should return 400 if optional rating out of range', async () => {
        const ctrl = loadController();
        const req = mockReq({
            body: { rentalPeriodId: 'rp-1', roomId: 'room-1', rating: 4, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài', cleanlinessRating: 7 },
        });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /1 đến 5/);
    });

    it('should return 404 if rental period not found', async () => {
        mockPrisma.roomRentalPeriod.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-999', roomId: 'room-1', rating: 4, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 403 if user does not own rental period', async () => {
        mockPrisma.roomRentalPeriod.findUnique = async () => ({ ...fakeRentalPeriod, userId: 'other-user' });
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-1', roomId: 'room-1', rating: 4, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 400 if rental period cancelled', async () => {
        mockPrisma.roomRentalPeriod.findUnique = async () => ({ ...fakeRentalPeriod, status: 'CANCELLED' });
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-1', roomId: 'room-1', rating: 4, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /đã hủy/);
    });

    it('should return 400 if rental too short (< 1 min)', async () => {
        mockPrisma.roomRentalPeriod.findUnique = async () => ({ ...fakeRentalPeriod, startDate: new Date() });
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-1', roomId: 'room-1', rating: 4, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /1 phút/);
    });

    it('should return 400 if already reviewed (not REJECTED)', async () => {
        mockPrisma.roomRentalPeriod.findUnique = async () => ({
            ...fakeRentalPeriod,
            feedback: [{ user_id: 'user-1', status: 'APPROVED' }],
        });
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-1', roomId: 'room-1', rating: 4, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /đã đánh giá/);
    });

    it('should update existing REJECTED feedback and return 201', async () => {
        mockPrisma.roomRentalPeriod.findUnique = async () => ({
            ...fakeRentalPeriod,
            feedback: [{ id: 'fb-old', user_id: 'user-1', status: 'REJECTED' }],
        });
        mockPrisma.feedback.update = async () => fakeFeedback;
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-1', roomId: 'room-1', rating: 5, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
    });

    it('should handle P2002 duplicate key error', async () => {
        mockPrisma.$transaction = async () => { const e = new Error('dup'); e.code = 'P2002'; throw e; };
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-1', roomId: 'room-1', rating: 4, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /đã đánh giá/);
    });

    it('should return 500 on unexpected error', async () => {
        mockPrisma.$transaction = async () => { throw new Error('unexpected'); };
        const ctrl = loadController();
        const req = mockReq({ body: { rentalPeriodId: 'rp-1', roomId: 'room-1', rating: 4, comment: 'Phòng sạch sẽ thoáng mát rất tốt để ở lâu dài' } });
        const res = mockRes();
        await ctrl.createFeedback(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getFeedbackByRentalPeriod
   ================================================================ */
describe('Feedback > getFeedbackByRentalPeriod', () => {
    beforeEach(() => {
        mockPrisma.roomRentalPeriod.findUnique = async () => ({
            id: 'rp-1',
            userId: 'user-1',
            feedback: [fakeFeedback],
        });
    });

    it('should return feedback data for valid rental period', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { rentalPeriodId: 'rp-1' } });
        const res = mockRes();
        await ctrl.getFeedbackByRentalPeriod(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.ok(res._json.data.rating);
    });

    it('should return null data when no feedback exists', async () => {
        mockPrisma.roomRentalPeriod.findUnique = async () => ({
            id: 'rp-1',
            userId: 'user-1',
            feedback: [],
        });
        const ctrl = loadController();
        const req = mockReq({ params: { rentalPeriodId: 'rp-1' } });
        const res = mockRes();
        await ctrl.getFeedbackByRentalPeriod(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data, null);
    });

    it('should return 404 if rental period not found', async () => {
        mockPrisma.roomRentalPeriod.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { rentalPeriodId: 'rp-999' } });
        const res = mockRes();
        await ctrl.getFeedbackByRentalPeriod(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 403 if user does not own period', async () => {
        mockPrisma.roomRentalPeriod.findUnique = async () => ({
            id: 'rp-1',
            userId: 'other-user',
            feedback: [],
        });
        const ctrl = loadController();
        const req = mockReq({ params: { rentalPeriodId: 'rp-1' } });
        const res = mockRes();
        await ctrl.getFeedbackByRentalPeriod(req, res);
        assert.equal(res._status, 403);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.roomRentalPeriod.findUnique = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { rentalPeriodId: 'rp-1' } });
        const res = mockRes();
        await ctrl.getFeedbackByRentalPeriod(req, res);
        assert.equal(res._status, 500);
    });
});
