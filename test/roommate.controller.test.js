const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();

function loadController() {
    clearModule('../controllers/roommate.controller');
    injectMock('../config/prisma', mockPrisma);
    return require('../controllers/roommate.controller');
}

const fakeLifestyle = {
    smoking: false, drinking: false, pets_allowed: false, work_from_home: true,
    sleep_schedule: 'Sớm (trước 22h)', cleanliness: 'Sạch sẽ', noise_tolerance: 'Trung bình',
    guest_frequency: 'Thỉnh thoảng', cooking_frequency: 'Thường xuyên',
    personalityType: 'Hướng nội', social_level: 'Trung bình',
    wake_time: '06:00', bedtime: '22:00', occupation_type: 'Sinh viên',
    temperature_preference: 'Mát', quiet_hours_preference: '22-06',
    interests: ['Đọc sách', 'Nấu ăn'], languages: ['Tiếng Việt'],
    preferred_lease_months: 6,
};

const fakePreference = {
    preferred_districts: ['Quận 1'], room_type: 'single',
    preferred_amenities: ['WiFi'], must_have_amenities: ['WiFi'],
    preferred_lease_months: 6, pet_friendly: false,
};

const fakeMe = {
    id: 'user-1', gender: 'Nam', status: 'ACTIVE', role: 'TENANT',
    lifestyleProfile: fakeLifestyle, preference: fakePreference,
};

const fakeCandidate = {
    id: 'user-3', fullName: 'Candidate', avatarUrl: null, gender: 'Nam',
    status: 'ACTIVE', role: 'TENANT',
    lifestyleProfile: { ...fakeLifestyle }, preference: { ...fakePreference },
};

/* ================================================================
   getSuggestions
   ================================================================ */
describe('Roommate > getSuggestions', () => {
    beforeEach(() => {
        mockPrisma.user.findUnique = async () => fakeMe;
        mockPrisma.user.findMany = async () => [fakeCandidate];
        mockPrisma.roommateMatch.findMany = async () => [];
    });

    it('should return scored suggestions', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getSuggestions(req, res);
        assert.equal(res._json.success, true);
        assert.ok(res._json.data.length > 0);
        assert.ok(typeof res._json.data[0].matchScore === 'number');
    });

    it('should exclude already-matched users', async () => {
        mockPrisma.roommateMatch.findMany = async () => [
            { requester_id: 'user-1', target_id: 'user-3' },
        ];
        mockPrisma.user.findMany = async () => [];
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getSuggestions(req, res);
        assert.equal(res._json.data.length, 0);
    });

    it('should add gender boost for same gender', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getSuggestions(req, res);
        assert.ok(res._json.data[0].isSameGender === true);
    });

    it('should show hint when user has no gender', async () => {
        mockPrisma.user.findUnique = async () => ({ ...fakeMe, gender: null });
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getSuggestions(req, res);
        assert.ok(res._json.message);
    });

    it('should return 404 when user not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getSuggestions(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getSuggestions(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   sendRequest
   ================================================================ */
describe('Roommate > sendRequest', () => {
    beforeEach(() => {
        mockPrisma.user.findUnique = async () => ({ id: 'user-3', status: 'ACTIVE', role: 'TENANT' });
        mockPrisma.roommateMatch.findUnique = async () => null;
        mockPrisma.roommateMatch.create = async () => ({
            id: 'match-1', requester_id: 'user-1', target_id: 'user-3',
            status: 'PENDING', created_at: new Date(),
        });
    });

    it('should create a pending request', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { targetId: 'user-3' } });
        const res = mockRes();
        await ctrl.sendRequest(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.data.status, 'PENDING');
    });

    it('should reject self-request', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { targetId: 'user-1' } });
        const res = mockRes();
        await ctrl.sendRequest(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 when target not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { targetId: 'user-99' } });
        const res = mockRes();
        await ctrl.sendRequest(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 404 when target is not tenant', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'user-3', status: 'ACTIVE', role: 'LANDLORD' });
        const ctrl = loadController();
        const req = mockReq({ params: { targetId: 'user-3' } });
        const res = mockRes();
        await ctrl.sendRequest(req, res);
        assert.equal(res._status, 404);
    });

    it('should reject duplicate pending request', async () => {
        mockPrisma.roommateMatch.findUnique = async () => ({ status: 'PENDING' });
        const ctrl = loadController();
        const req = mockReq({ params: { targetId: 'user-3' } });
        const res = mockRes();
        await ctrl.sendRequest(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject if already accepted', async () => {
        mockPrisma.roommateMatch.findUnique = async () => ({ status: 'ACCEPTED' });
        const ctrl = loadController();
        const req = mockReq({ params: { targetId: 'user-3' } });
        const res = mockRes();
        await ctrl.sendRequest(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject blocked match', async () => {
        mockPrisma.roommateMatch.findUnique = async () => ({ status: 'BLOCKED' });
        const ctrl = loadController();
        const req = mockReq({ params: { targetId: 'user-3' } });
        const res = mockRes();
        await ctrl.sendRequest(req, res);
        assert.equal(res._status, 400);
    });

    it('should detect reverse pending request', async () => {
        let callCount = 0;
        mockPrisma.roommateMatch.findUnique = async () => {
            callCount++;
            if (callCount === 1) return null;           // forward check
            return { status: 'PENDING' };               // reverse check
        };
        const ctrl = loadController();
        const req = mockReq({ params: { targetId: 'user-3' } });
        const res = mockRes();
        await ctrl.sendRequest(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ params: { targetId: 'user-3' } });
        const res = mockRes();
        await ctrl.sendRequest(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getMyMatches
   ================================================================ */
describe('Roommate > getMyMatches', () => {
    beforeEach(() => {
        mockPrisma.roommateMatch.findMany = async () => [
            { id: 'match-1', requester_id: 'user-1', target_id: 'user-3', status: 'PENDING', created_at: new Date() },
        ];
        mockPrisma.user.findMany = async () => [
            { id: 'user-3', fullName: 'Candidate', avatarUrl: null, gender: 'Nam' },
        ];
    });

    it('should return matches with user info', async () => {
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getMyMatches(req, res);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.length, 1);
        assert.equal(res._json.data[0].isRequester, true);
    });

    it('should return empty list', async () => {
        mockPrisma.roommateMatch.findMany = async () => [];
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getMyMatches(req, res);
        assert.equal(res._json.data.length, 0);
    });

    it('should return 500 on error', async () => {
        mockPrisma.roommateMatch.findMany = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getMyMatches(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   updateMatchStatus
   ================================================================ */
describe('Roommate > updateMatchStatus', () => {
    beforeEach(() => {
        mockPrisma.roommateMatch.findUnique = async () => ({
            id: 'match-1', requester_id: 'user-3', target_id: 'user-1', status: 'PENDING',
        });
        mockPrisma.roommateMatch.update = async ({ data }) => ({
            id: 'match-1', status: data.status,
        });
    });

    it('should accept match', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { matchId: 'match-1' }, body: { status: 'ACCEPTED' } });
        const res = mockRes();
        await ctrl.updateMatchStatus(req, res);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.status, 'ACCEPTED');
    });

    it('should reject match', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { matchId: 'match-1' }, body: { status: 'REJECTED' } });
        const res = mockRes();
        await ctrl.updateMatchStatus(req, res);
        assert.equal(res._json.data.status, 'REJECTED');
    });

    it('should reject invalid status value', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { matchId: 'match-1' }, body: { status: 'BLOCKED' } });
        const res = mockRes();
        await ctrl.updateMatchStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 when match not found', async () => {
        mockPrisma.roommateMatch.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { matchId: 'no' }, body: { status: 'ACCEPTED' } });
        const res = mockRes();
        await ctrl.updateMatchStatus(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 403 when not the target', async () => {
        mockPrisma.roommateMatch.findUnique = async () => ({
            id: 'match-1', requester_id: 'user-1', target_id: 'user-3', status: 'PENDING',
        });
        const ctrl = loadController();
        const req = mockReq({ params: { matchId: 'match-1' }, body: { status: 'ACCEPTED' } });
        const res = mockRes();
        await ctrl.updateMatchStatus(req, res);
        assert.equal(res._status, 403);
    });

    it('should reject already processed match', async () => {
        mockPrisma.roommateMatch.findUnique = async () => ({
            id: 'match-1', requester_id: 'user-3', target_id: 'user-1', status: 'ACCEPTED',
        });
        const ctrl = loadController();
        const req = mockReq({ params: { matchId: 'match-1' }, body: { status: 'REJECTED' } });
        const res = mockRes();
        await ctrl.updateMatchStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject missing status', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { matchId: 'match-1' }, body: {} });
        const res = mockRes();
        await ctrl.updateMatchStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on error', async () => {
        mockPrisma.roommateMatch.findUnique = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ params: { matchId: 'match-1' }, body: { status: 'ACCEPTED' } });
        const res = mockRes();
        await ctrl.updateMatchStatus(req, res);
        assert.equal(res._status, 500);
    });
});
