const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

let mockPrisma, controller;

function setup() {
    mockPrisma = createMockPrisma();
    injectMock('../config/prisma', mockPrisma);
    clearModule('../controllers/roommate.controller');
    controller = require('../controllers/roommate.controller');
}

/* ════════════════════════════════════════════
   getSuggestions
   ════════════════════════════════════════════ */
describe('roommate.controller — getSuggestions', () => {
    beforeEach(() => setup());

    it('should return scored suggestions for user with gender', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'user-1', gender: 'Nam', lifestyleProfile: { smoking: false, drinking: false, pets_allowed: true, sleep_schedule: 'early', work_from_home: true, interests: ['coding'], languages: ['vi'] },
            preference: { preferred_districts: ['Q1'], room_type: 'SINGLE', preferred_amenities: [], must_have_amenities: [] },
        });
        mockPrisma.roommateMatch.findMany = async () => [];
        mockPrisma.user.findMany = async () => [
            {
                id: 'u2', fullName: 'B', avatarUrl: null, gender: 'Nam', status: 'ACTIVE', role: 'TENANT',
                lifestyleProfile: { smoking: false, drinking: false, pets_allowed: true, sleep_schedule: 'early', work_from_home: true, interests: ['coding'], languages: ['vi'] },
                preference: { preferred_districts: ['Q1'], room_type: 'SINGLE', preferred_amenities: [], must_have_amenities: [] },
            },
        ];
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getSuggestions(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.length, 1);
        assert.ok(res._json.data[0].matchScore > 0);
        assert.equal(res._json.data[0].isSameGender, true);
    });

    it('should warn when user has no gender', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'user-1', gender: null, lifestyleProfile: null, preference: null,
        });
        mockPrisma.roommateMatch.findMany = async () => [];
        mockPrisma.user.findMany = async () => [];
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getSuggestions(req, res);
        assert.equal(res._status, 200);
        assert.ok(res._json.message);
    });

    it('should exclude existing matches', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'user-1', gender: 'Nam', lifestyleProfile: null, preference: null,
        });
        mockPrisma.roommateMatch.findMany = async () => [
            { requester_id: 'user-1', target_id: 'u2' },
        ];
        let captured;
        mockPrisma.user.findMany = async (args) => { captured = args?.where?.id?.notIn; return []; };
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getSuggestions(req, res);
        assert.equal(res._status, 200);
        assert.ok(captured?.includes('u2'));
    });

    it('should return 404 if current user not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getSuggestions(req, res);
        assert.equal(res._status, 404);
    });

    it('should respect limit param', async () => {
        mockPrisma.user.findUnique = async () => ({
            id: 'user-1', gender: 'Nam', lifestyleProfile: null, preference: null,
        });
        mockPrisma.roommateMatch.findMany = async () => [];
        const candidates = Array.from({ length: 10 }, (_, i) => ({
            id: `u${i}`, fullName: `User${i}`, avatarUrl: null, gender: 'Nam', status: 'ACTIVE', role: 'TENANT',
            lifestyleProfile: null, preference: null,
        }));
        mockPrisma.user.findMany = async () => candidates;
        const req = mockReq({ query: { limit: '3' } });
        const res = mockRes();
        await controller.getSuggestions(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 3);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('DB'); };
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getSuggestions(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   sendRequest
   ════════════════════════════════════════════ */
describe('roommate.controller — sendRequest', () => {
    beforeEach(() => setup());

    it('should create a PENDING request', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', status: 'ACTIVE', role: 'TENANT' });
        mockPrisma.roommateMatch.findUnique = async () => null;
        mockPrisma.roommateMatch.create = async () => ({
            id: 'match-1', requester_id: 'user-1', target_id: 'u2', status: 'PENDING', created_at: '2026-01-01',
        });
        const req = mockReq({ params: { targetId: 'u2' } });
        const res = mockRes();
        await controller.sendRequest(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
    });

    it('should reject self-request', async () => {
        const req = mockReq({ params: { targetId: 'user-1' } });
        const res = mockRes();
        await controller.sendRequest(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject if target not found', async () => {
        mockPrisma.user.findUnique = async () => null;
        const req = mockReq({ params: { targetId: 'u-gone' } });
        const res = mockRes();
        await controller.sendRequest(req, res);
        assert.equal(res._status, 404);
    });

    it('should reject if target is not ACTIVE', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', status: 'BANNED', role: 'TENANT' });
        const req = mockReq({ params: { targetId: 'u2' } });
        const res = mockRes();
        await controller.sendRequest(req, res);
        assert.equal(res._status, 404);
    });

    it('should reject if target is not TENANT', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', status: 'ACTIVE', role: 'LANDLORD' });
        const req = mockReq({ params: { targetId: 'u2' } });
        const res = mockRes();
        await controller.sendRequest(req, res);
        assert.equal(res._status, 404);
    });

    it('should reject duplicate PENDING request', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', status: 'ACTIVE', role: 'TENANT' });
        mockPrisma.roommateMatch.findUnique = async (args) => {
            if (args.where.requester_id_target_id.requester_id === 'user-1') {
                return { status: 'PENDING' };
            }
            return null;
        };
        const req = mockReq({ params: { targetId: 'u2' } });
        const res = mockRes();
        await controller.sendRequest(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject if already ACCEPTED', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', status: 'ACTIVE', role: 'TENANT' });
        mockPrisma.roommateMatch.findUnique = async (args) => {
            if (args.where.requester_id_target_id.requester_id === 'user-1') {
                return { status: 'ACCEPTED' };
            }
            return null;
        };
        const req = mockReq({ params: { targetId: 'u2' } });
        const res = mockRes();
        await controller.sendRequest(req, res);
        assert.equal(res._status, 400);
    });

    it('should block when reverse PENDING exists', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', status: 'ACTIVE', role: 'TENANT' });
        let callCount = 0;
        mockPrisma.roommateMatch.findUnique = async () => {
            callCount++;
            if (callCount === 1) return null; // first lookup (forward)
            return { status: 'PENDING' }; // second lookup (reverse)
        };
        const req = mockReq({ params: { targetId: 'u2' } });
        const res = mockRes();
        await controller.sendRequest(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on error', async () => {
        mockPrisma.user.findUnique = async () => ({ id: 'u2', status: 'ACTIVE', role: 'TENANT' });
        mockPrisma.roommateMatch.findUnique = async () => null;
        mockPrisma.roommateMatch.create = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { targetId: 'u2' } });
        const res = mockRes();
        await controller.sendRequest(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getMyMatches
   ════════════════════════════════════════════ */
describe('roommate.controller — getMyMatches', () => {
    beforeEach(() => setup());

    it('should return matches with user detail', async () => {
        mockPrisma.roommateMatch.findMany = async () => [
            { id: 'm1', requester_id: 'user-1', target_id: 'u2', status: 'PENDING', created_at: '2026-01-01' },
        ];
        mockPrisma.user.findMany = async () => [
            { id: 'u2', fullName: 'B', avatarUrl: null, gender: 'Nam' },
        ];
        const req = mockReq();
        const res = mockRes();
        await controller.getMyMatches(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 1);
        assert.equal(res._json.data[0].isRequester, true);
        assert.equal(res._json.data[0].otherUser.id, 'u2');
    });

    it('should return empty array when no matches', async () => {
        mockPrisma.roommateMatch.findMany = async () => [];
        const req = mockReq();
        const res = mockRes();
        await controller.getMyMatches(req, res);
        assert.equal(res._status, 200);
        assert.deepEqual(res._json.data, []);
    });

    it('should return 500 on error', async () => {
        mockPrisma.roommateMatch.findMany = async () => { throw new Error('DB'); };
        const req = mockReq();
        const res = mockRes();
        await controller.getMyMatches(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   updateMatchStatus
   ════════════════════════════════════════════ */
describe('roommate.controller — updateMatchStatus', () => {
    beforeEach(() => setup());

    it('should accept match as target', async () => {
        mockPrisma.roommateMatch.findUnique = async () => ({
            id: 'match-1', requester_id: 'u2', target_id: 'user-1', status: 'PENDING',
        });
        mockPrisma.roommateMatch.update = async () => ({ id: 'match-1', status: 'ACCEPTED' });
        const req = mockReq({ params: { matchId: 'match-1' }, body: { status: 'ACCEPTED' } });
        const res = mockRes();
        await controller.updateMatchStatus(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.status, 'ACCEPTED');
    });

    it('should reject match as target', async () => {
        mockPrisma.roommateMatch.findUnique = async () => ({
            id: 'match-1', requester_id: 'u2', target_id: 'user-1', status: 'PENDING',
        });
        mockPrisma.roommateMatch.update = async () => ({ id: 'match-1', status: 'REJECTED' });
        const req = mockReq({ params: { matchId: 'match-1' }, body: { status: 'REJECTED' } });
        const res = mockRes();
        await controller.updateMatchStatus(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.status, 'REJECTED');
    });

    it('should reject invalid status value', async () => {
        const req = mockReq({ params: { matchId: 'match-1' }, body: { status: 'INVALID' } });
        const res = mockRes();
        await controller.updateMatchStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject missing status', async () => {
        const req = mockReq({ params: { matchId: 'match-1' }, body: {} });
        const res = mockRes();
        await controller.updateMatchStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 when match not found', async () => {
        mockPrisma.roommateMatch.findUnique = async () => null;
        const req = mockReq({ params: { matchId: 'bad' }, body: { status: 'ACCEPTED' } });
        const res = mockRes();
        await controller.updateMatchStatus(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 403 if not target user', async () => {
        mockPrisma.roommateMatch.findUnique = async () => ({
            id: 'match-1', requester_id: 'u2', target_id: 'u3', status: 'PENDING',
        });
        const req = mockReq({ params: { matchId: 'match-1' }, body: { status: 'ACCEPTED' } });
        const res = mockRes();
        await controller.updateMatchStatus(req, res);
        assert.equal(res._status, 403);
    });

    it('should reject if status is not PENDING', async () => {
        mockPrisma.roommateMatch.findUnique = async () => ({
            id: 'match-1', requester_id: 'u2', target_id: 'user-1', status: 'ACCEPTED',
        });
        const req = mockReq({ params: { matchId: 'match-1' }, body: { status: 'REJECTED' } });
        const res = mockRes();
        await controller.updateMatchStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on error', async () => {
        mockPrisma.roommateMatch.findUnique = async () => ({
            id: 'match-1', requester_id: 'u2', target_id: 'user-1', status: 'PENDING',
        });
        mockPrisma.roommateMatch.update = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { matchId: 'match-1' }, body: { status: 'ACCEPTED' } });
        const res = mockRes();
        await controller.updateMatchStatus(req, res);
        assert.equal(res._status, 500);
    });
});
