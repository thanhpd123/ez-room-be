const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

let mockPrisma, controller;

function setup() {
    mockPrisma = createMockPrisma();
    injectMock('../config/prisma', mockPrisma);
    injectMock('../utils/room-type-mapper', {
        mapFeToDb: (v, opts) => v || (opts?.returnNullForInvalid ? null : 'SINGLE'),
        mapDbToFe: (v, fallback) => v ? String(v).toLowerCase() : fallback,
    });
    injectMock('../data/legacy-location-map', {
        expandCity: (c) => [c],
        expandDistrict: (d) => [d],
        extractLocationTermsFromQuery: () => ({ cities: [], districts: [] }),
    });
    clearModule('../controllers/search.controller');
    controller = require('../controllers/search.controller');
}

/* ════════════════════════════════════════════
   getPublicSearch
   ════════════════════════════════════════════ */
describe('search.controller — getPublicSearch', () => {
    beforeEach(() => setup());

    it('should return scored rooms with pagination', async () => {
        mockPrisma.rooms.findMany = async () => [
            {
                id: 'r1', room_name: 'P1', price: 3000000, size_m2: 25,
                room_type: 'SINGLE', status: 'AVAILABLE',
                images: [], roomAmenities: [],
                rentals: {
                    id: 'ren1', title: 'T', description: '', status: 'AVAILABLE',
                    location: { address: '123', district: 'Q1', city: 'HCM' },
                    images: [], rooms: [],
                },
            },
        ];
        mockPrisma.feedback.groupBy = async () => [];
        mockPrisma.userPreference = { findUnique: async () => null };
        const req = mockReq({ query: { page: '1', limit: '10' }, auth: {} });
        const res = mockRes();
        await controller.getPublicSearch(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.ok(res._json.data.length >= 1);
        assert.ok(res._json.pagination);
    });

    it('should handle empty results', async () => {
        mockPrisma.rooms.findMany = async () => [];
        mockPrisma.feedback.groupBy = async () => [];
        mockPrisma.userPreference = { findUnique: async () => null };
        const req = mockReq({ query: {}, auth: {} });
        const res = mockRes();
        await controller.getPublicSearch(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 0);
        assert.equal(res._json.pagination.total, 0);
    });

    it('should use user preferences for scoring when logged in', async () => {
        mockPrisma.rooms.findMany = async () => [
            {
                id: 'r1', room_name: 'P1', price: 3000000, size_m2: 25,
                room_type: 'SINGLE', status: 'AVAILABLE',
                images: [], roomAmenities: [],
                rentals: {
                    id: 'ren1', title: 'T', description: '', status: 'AVAILABLE',
                    location: { address: '123', district: 'Q1', city: 'HCM' },
                    images: [], rooms: [],
                },
            },
        ];
        mockPrisma.feedback.groupBy = async () => [];
        mockPrisma.userPreference = {
            findUnique: async () => ({
                budget_min: 2000000, budget_max: 4000000,
                preferred_districts: ['Q1'], room_type: 'single',
                preferred_amenities: [], must_have_amenities: [],
            }),
        };
        const req = mockReq({ query: {}, auth: { user: { id: 'user-1' } } });
        const res = mockRes();
        await controller.getPublicSearch(req, res);
        assert.equal(res._status, 200);
        // Score should be higher than base 50 due to preference match
        assert.ok(res._json.data[0].matchScore >= 50);
    });

    it('should sort by score descending', async () => {
        mockPrisma.rooms.findMany = async () => [
            {
                id: 'r1', room_name: 'P1', price: 3000000, size_m2: 25,
                room_type: 'SINGLE', status: 'AVAILABLE',
                images: [], roomAmenities: [],
                rentals: { id: 'ren1', title: 'Cheap room', description: '', status: 'AVAILABLE', location: { address: '1', district: 'Q1', city: 'HCM' }, images: [], rooms: [] },
            },
            {
                id: 'r2', room_name: 'P2', price: 5000000, size_m2: 40,
                room_type: 'APARTMENT', status: 'AVAILABLE',
                images: [{ imageUrl: 'img.jpg' }],
                roomAmenities: [{ amenityId: 'a1', amenity: { name: 'WiFi' } }],
                rentals: { id: 'ren2', title: 'Q1 search match', description: 'nice', status: 'AVAILABLE', location: { address: '2', district: 'Q1', city: 'HCM' }, images: [], rooms: [] },
            },
        ];
        mockPrisma.feedback.groupBy = async () => [
            { target_id: 'r2', _avg: { rating: 5 }, _count: { id: 3 } },
        ];
        mockPrisma.userPreference = { findUnique: async () => null };
        const req = mockReq({ query: { q: 'Q1' }, auth: {} });
        const res = mockRes();
        await controller.getPublicSearch(req, res);
        assert.equal(res._status, 200);
        // r2 should rank higher (has rating + amenity + q match)
        assert.equal(res._json.data[0].id, 'r2');
    });

    it('should return 500 on error', async () => {
        mockPrisma.rooms.findMany = async () => { throw new Error('DB'); };
        mockPrisma.userPreference = { findUnique: async () => null };
        const req = mockReq({ query: {}, auth: {} });
        const res = mockRes();
        await controller.getPublicSearch(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getRecommend
   ════════════════════════════════════════════ */
describe('search.controller — getRecommend', () => {
    beforeEach(() => setup());

    it('should return recommendations for logged-in user', async () => {
        mockPrisma.userPreference = {
            findUnique: async () => ({
                budget_min: 2000000, budget_max: 5000000,
                preferred_districts: [], room_type: null,
                preferred_amenities: [], must_have_amenities: [],
            }),
        };
        mockPrisma.favoriteRoom.findMany = async () => [];
        mockPrisma.rooms.findMany = async () => [
            {
                id: 'r1', room_name: 'P1', price: 3000000, size_m2: 25,
                room_type: 'SINGLE', status: 'AVAILABLE',
                images: [], roomAmenities: [],
                rentals: { id: 'ren1', title: 'T', location: { district: 'Q1', city: 'HCM' }, images: [] },
            },
        ];
        mockPrisma.feedback.groupBy = async () => [];
        const req = mockReq();
        const res = mockRes();
        await controller.getRecommend(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.ok(res._json.data.length >= 1);
        assert.ok(res._json.hint);
    });

    it('should return 401 when not logged in', async () => {
        const req = mockReq();
        req.auth = {};
        const res = mockRes();
        await controller.getRecommend(req, res);
        assert.equal(res._status, 401);
    });

    it('should exclude already-favorited rooms', async () => {
        mockPrisma.userPreference = { findUnique: async () => null };
        mockPrisma.favoriteRoom.findMany = async () => [
            { room: { id: 'r1', price: 3000000, room_type: 'SINGLE', rentals: { location: { district: 'Q1', city: 'HCM' } } } },
        ];
        mockPrisma.rooms.findMany = async () => [
            {
                id: 'r1', room_name: 'P1', price: 3000000, size_m2: 25,
                room_type: 'SINGLE', status: 'AVAILABLE',
                images: [], roomAmenities: [],
                rentals: { id: 'ren1', title: 'T', location: { district: 'Q1', city: 'HCM' }, images: [] },
            },
            {
                id: 'r2', room_name: 'P2', price: 4000000, size_m2: 30,
                room_type: 'SINGLE', status: 'AVAILABLE',
                images: [], roomAmenities: [],
                rentals: { id: 'ren2', title: 'T2', location: { district: 'Q1', city: 'HCM' }, images: [] },
            },
        ];
        mockPrisma.feedback.groupBy = async () => [];
        const req = mockReq();
        const res = mockRes();
        await controller.getRecommend(req, res);
        assert.equal(res._status, 200);
        // r1 should be excluded (already favorited)
        const ids = res._json.data.map((d) => d.id);
        assert.ok(!ids.includes('r1'));
    });

    it('should use favorites bonus for similar rooms', async () => {
        mockPrisma.userPreference = { findUnique: async () => null };
        mockPrisma.favoriteRoom.findMany = async () => [
            { room: { id: 'fav1', price: 3000000, room_type: 'SINGLE', rentals: { location: { district: 'Q1', city: 'HCM' } } } },
        ];
        mockPrisma.rooms.findMany = async () => [
            {
                id: 'r2', room_name: 'P2', price: 3200000, size_m2: 25,
                room_type: 'SINGLE', status: 'AVAILABLE',
                images: [], roomAmenities: [],
                rentals: { id: 'ren2', title: 'T', location: { district: 'Q1', city: 'HCM' }, images: [] },
            },
        ];
        mockPrisma.feedback.groupBy = async () => [];
        const req = mockReq();
        const res = mockRes();
        await controller.getRecommend(req, res);
        assert.equal(res._status, 200);
        // Score should include favorites bonus (same district, city, type, price range)
        assert.ok(res._json.data[0].matchScore > 50);
    });

    it('should show hint based on data available', async () => {
        mockPrisma.userPreference = { findUnique: async () => null };
        mockPrisma.favoriteRoom.findMany = async () => [];
        mockPrisma.rooms.findMany = async () => [];
        mockPrisma.feedback.groupBy = async () => [];
        const req = mockReq();
        const res = mockRes();
        await controller.getRecommend(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.hint, 'Phòng phổ biến'); // no prefs, no favs
    });

    it('should return 500 on error', async () => {
        mockPrisma.userPreference = { findUnique: async () => { throw new Error('DB'); } };
        const req = mockReq();
        const res = mockRes();
        await controller.getRecommend(req, res);
        assert.equal(res._status, 500);
    });
});
