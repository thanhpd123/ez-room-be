const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();
const mockMapper = { mapFeToDb: (v) => v, mapDbToFe: (v, def) => v || def };
const mockLegacy = {
    expandCity: (c) => [c],
    expandDistrict: (d) => [d],
    extractLocationTermsFromQuery: () => ({ cities: [], districts: [] }),
};

function loadController() {
    clearModule('../controllers/search.controller');
    injectMock('../config/prisma', mockPrisma);
    injectMock('../utils/room-type-mapper', mockMapper);
    injectMock('../data/legacy-location-map', mockLegacy);
    return require('../controllers/search.controller');
}

const fakeRoom = {
    id: 'room-1', room_name: 'Room A', price: 3000000, size_m2: 25,
    room_type: 'single', status: 'AVAILABLE',
    images: [{ imageUrl: 'https://example.com/room.jpg' }],
    roomAmenities: [{ amenityId: 'am-1', amenity: { name: 'WiFi' } }],
    rentals: {
        id: 'rental-1', title: 'Rental A', status: 'AVAILABLE', description: 'Desc',
        location: { address: '123 St', district: 'Q1', city: 'HCM' },
        images: [{ imageUrl: 'https://example.com/rental.jpg' }],
        users: { id: 'landlord-1', role: 'LANDLORD', isVip: false },
        rooms: [],
    },
};

function buildRoom({ id, isVipLandlord }) {
    return {
        ...fakeRoom,
        id,
        room_name: `Room ${id}`,
        rentals: {
            ...fakeRoom.rentals,
            id: `rental-${id}`,
            users: {
                id: `owner-${id}`,
                role: 'LANDLORD',
                isVip: isVipLandlord,
            },
            rooms: [],
        },
    };
}

/* ================================================================
   getPublicSearch
   ================================================================ */
describe('Search > getPublicSearch', () => {
    beforeEach(() => {
        mockPrisma.rooms.findMany = async () => [fakeRoom];
        mockPrisma.feedback.groupBy = async () => [];
        mockPrisma.userPreference.findUnique = async () => null;
    });

    it('should return scored rooms', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {}, auth: { user: null } });
        const res = mockRes();
        await ctrl.getPublicSearch(req, res);
        assert.equal(res._json.success, true);
        assert.ok(res._json.data.length > 0);
        assert.ok(typeof res._json.data[0].matchScore === 'number');
    });

    it('should support pagination', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: { page: '1', limit: '10' }, auth: { user: null } });
        const res = mockRes();
        await ctrl.getPublicSearch(req, res);
        assert.equal(res._json.pagination.page, 1);
        assert.equal(res._json.pagination.limit, 10);
    });

    it('should filter by roomType', async () => {
        mockMapper.mapFeToDb = () => 'single';
        const ctrl = loadController();
        const req = mockReq({ query: { roomType: 'single' }, auth: { user: null } });
        const res = mockRes();
        await ctrl.getPublicSearch(req, res);
        assert.equal(res._json.success, true);
        mockMapper.mapFeToDb = (v) => v;
    });

    it('should use user preference scoring when logged in', async () => {
        mockPrisma.userPreference.findUnique = async () => ({
            budget_min: 1000000, budget_max: 5000000,
            preferred_districts: ['Q1'], room_type: 'single',
            preferred_amenities: ['WiFi'], must_have_amenities: [],
        });
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getPublicSearch(req, res);
        assert.ok(res._json.data[0].matchScore > 0);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rooms.findMany = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ query: {}, auth: { user: null } });
        const res = mockRes();
        await ctrl.getPublicSearch(req, res);
        assert.equal(res._status, 500);
    });

    it('should require VIP for advanced filters when guest', async () => {
        const ctrl = loadController();
        const req = mockReq({
            query: { minArea: '20', amenities: 'am-1' },
            auth: { user: null },
        });
        const res = mockRes();

        await ctrl.getPublicSearch(req, res);

        assert.equal(res._status, 403);
        assert.equal(res._json.code, 'VIP_REQUIRED_FOR_ADVANCED_FILTERS');
    });

    it('should require VIP for advanced filters when authenticated but non-VIP', async () => {
        const ctrl = loadController();
        const req = mockReq({
            query: { maxArea: '35' },
            auth: {
                user: {
                    id: 'user-1',
                    role: 'TENANT',
                    isVip: false,
                },
            },
        });
        const res = mockRes();

        await ctrl.getPublicSearch(req, res);

        assert.equal(res._status, 403);
        assert.equal(res._json.code, 'VIP_REQUIRED_FOR_ADVANCED_FILTERS');
    });

    it('should allow advanced filters for VIP users', async () => {
        const ctrl = loadController();
        const req = mockReq({
            query: { minArea: '20', amenities: 'am-1' },
            auth: {
                user: {
                    id: 'user-1',
                    role: 'TENANT',
                    isVip: true,
                },
            },
        });
        const res = mockRes();

        await ctrl.getPublicSearch(req, res);

        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should keep free-tier rooms visible on first page when many VIP rooms exist', async () => {
        const vipRooms = Array.from({ length: 12 }, (_, idx) =>
            buildRoom({ id: `vip-${idx + 1}`, isVipLandlord: true })
        );
        const freeRooms = Array.from({ length: 3 }, (_, idx) =>
            buildRoom({ id: `free-${idx + 1}`, isVipLandlord: false })
        );

        mockPrisma.rooms.findMany = async () => [...vipRooms, ...freeRooms];
        const ctrl = loadController();
        const req = mockReq({
            query: { limit: '10' },
            auth: { user: null },
        });
        const res = mockRes();

        await ctrl.getPublicSearch(req, res);

        assert.equal(res._status, 200);
        const freeInFirstPage = (res._json.data || []).filter((item) =>
            String(item.id).startsWith('free-')
        ).length;
        assert.ok(freeInFirstPage >= 2);
    });
});

/* ================================================================
   getRecommend
   ================================================================ */
describe('Search > getRecommend', () => {
    beforeEach(() => {
        mockPrisma.userPreference.findUnique = async () => ({
            budget_min: 1000000, budget_max: 5000000,
            preferred_districts: ['Q1'], room_type: 'single',
            preferred_amenities: ['WiFi'], must_have_amenities: [],
        });
        mockPrisma.favoriteRoom.findMany = async () => [];
        mockPrisma.rooms.findMany = async () => [fakeRoom];
        mockPrisma.feedback.groupBy = async () => [];
    });

    it('should return recommendations', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getRecommend(req, res);
        assert.equal(res._json.success, true);
        assert.ok(Array.isArray(res._json.data));
    });

    it('should return 401 when not logged in', async () => {
        const ctrl = loadController();
        const req = mockReq({ auth: { user: {} } });
        req.auth.user.id = undefined;
        const res = mockRes();
        await ctrl.getRecommend(req, res);
        assert.equal(res._status, 401);
    });

    it('should exclude already favorited rooms', async () => {
        mockPrisma.favoriteRoom.findMany = async () => [
            { room: { ...fakeRoom, id: 'room-1', rentals: fakeRoom.rentals } },
        ];
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getRecommend(req, res);
        assert.equal(res._json.data.length, 0);
    });

    it('should return hint based on favorites and preferences', async () => {
        mockPrisma.favoriteRoom.findMany = async () => [
            { room: { id: 'room-fav', price: 3000000, room_type: 'single', rentals: fakeRoom.rentals } },
        ];
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getRecommend(req, res);
        assert.ok(res._json.hint.includes('sở thích'));
    });

    it('should return generic hint when no prefs or favs', async () => {
        mockPrisma.userPreference.findUnique = async () => null;
        mockPrisma.favoriteRoom.findMany = async () => [];
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getRecommend(req, res);
        assert.equal(res._json.hint, 'Phòng phổ biến');
    });

    it('should return 500 on error', async () => {
        mockPrisma.userPreference.findUnique = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getRecommend(req, res);
        assert.equal(res._status, 500);
    });
});
