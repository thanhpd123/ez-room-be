const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

let mockPrisma, controller;

function setup() {
    mockPrisma = createMockPrisma();
    injectMock('../config/prisma', mockPrisma);
    clearModule('../utils/room-type-mapper');
    injectMock('../utils/room-type-mapper', { mapDbToFe: (v) => v });
    clearModule('../controllers/favorite.controller');
    controller = require('../controllers/favorite.controller');
}

/* ════════════════════════════════════════════
   formatRoomForFavorite (exported helper)
   ════════════════════════════════════════════ */
describe('favorite.controller — formatRoomForFavorite', () => {
    beforeEach(() => setup());

    it('should format room with full details', () => {
        const room = {
            id: 'r1', room_name: 'Phòng 101', price: 3000000, size_m2: 25,
            room_type: 'SINGLE', status: 'AVAILABLE',
            images: [{ imageUrl: 'img1.jpg' }],
            roomAmenities: [{ amenity: { name: 'WiFi' } }],
            rentals: {
                id: 'ren1', title: 'Nhà trọ ABC',
                location: { address: '123 XYZ', district: 'Q1', city: 'HCM' },
                images: [],
            },
        };
        const result = controller.formatRoomForFavorite(room);
        assert.equal(result.id, 'r1');
        assert.equal(result.price, 3000000);
        assert.equal(result.area, 25);
        assert.deepEqual(result.images, ['img1.jpg']);
        assert.deepEqual(result.amenities, ['WiFi']);
        assert.equal(result.address, '123 XYZ, Q1, HCM');
        assert.equal(result.available, true);
    });

    it('should use rental images when room has none', () => {
        const room = {
            id: 'r2', room_name: 'P2', price: 2000000, size_m2: null,
            room_type: null, status: 'RENTED',
            images: [],
            roomAmenities: [],
            rentals: { id: 'ren2', title: null, location: null, images: [{ imageUrl: 'ren-img.jpg' }] },
        };
        const result = controller.formatRoomForFavorite(room);
        assert.deepEqual(result.images, ['ren-img.jpg']);
        assert.equal(result.available, false);
    });

    it('should use placeholder when no images at all', () => {
        const room = {
            id: 'r3', room_name: 'P3', price: 1000000, size_m2: null,
            room_type: null, status: 'AVAILABLE',
            images: [], roomAmenities: [],
            rentals: { id: 'ren3', title: null, location: null, images: [] },
        };
        const result = controller.formatRoomForFavorite(room);
        assert.equal(result.images.length, 1);
        assert.ok(result.images[0].includes('unsplash'));
    });
});

/* ════════════════════════════════════════════
   addFavorite
   ════════════════════════════════════════════ */
describe('favorite.controller — addFavorite', () => {
    beforeEach(() => setup());

    it('should add room to favorites', async () => {
        mockPrisma.rooms.findUnique = async () => ({ id: 'r1', rentals: { location: {} } });
        mockPrisma.favoriteRoom.upsert = async () => ({});
        const req = mockReq({ params: { roomId: 'r1' } });
        const res = mockRes();
        await controller.addFavorite(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.roomId, 'r1');
    });

    it('should return 404 when room not found', async () => {
        mockPrisma.rooms.findUnique = async () => null;
        const req = mockReq({ params: { roomId: 'bad-id' } });
        const res = mockRes();
        await controller.addFavorite(req, res);
        assert.equal(res._status, 404);
        assert.equal(res._json.success, false);
    });

    it('should handle upsert without error for duplicate', async () => {
        mockPrisma.rooms.findUnique = async () => ({ id: 'r1', rentals: {} });
        mockPrisma.favoriteRoom.upsert = async () => ({}); // upsert → no dup error
        const req = mockReq({ params: { roomId: 'r1' } });
        const res = mockRes();
        await controller.addFavorite(req, res);
        assert.equal(res._status, 200);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.rooms.findUnique = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { roomId: 'r1' } });
        const res = mockRes();
        await controller.addFavorite(req, res);
        assert.equal(res._status, 500);
        assert.equal(res._json.success, false);
    });
});

/* ════════════════════════════════════════════
   removeFavorite
   ════════════════════════════════════════════ */
describe('favorite.controller — removeFavorite', () => {
    beforeEach(() => setup());

    it('should remove favorite successfully', async () => {
        mockPrisma.favoriteRoom.deleteMany = async () => ({ count: 1 });
        const req = mockReq({ params: { roomId: 'r1' } });
        const res = mockRes();
        await controller.removeFavorite(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should succeed even when favorite did not exist', async () => {
        mockPrisma.favoriteRoom.deleteMany = async () => ({ count: 0 });
        const req = mockReq({ params: { roomId: 'r1' } });
        const res = mockRes();
        await controller.removeFavorite(req, res);
        assert.equal(res._status, 200);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.favoriteRoom.deleteMany = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { roomId: 'r1' } });
        const res = mockRes();
        await controller.removeFavorite(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getMyFavorites
   ════════════════════════════════════════════ */
describe('favorite.controller — getMyFavorites', () => {
    beforeEach(() => setup());

    it('should return formatted favorite rooms', async () => {
        mockPrisma.favoriteRoom.findMany = async () => [
            {
                room: {
                    id: 'r1', room_name: 'P1', price: 3000000, size_m2: 20,
                    room_type: null, status: 'AVAILABLE',
                    images: [], roomAmenities: [],
                    rentals: { id: 'ren1', title: 'T', location: { address: 'A', district: 'D', city: 'C' }, images: [] },
                },
            },
        ];
        const req = mockReq();
        const res = mockRes();
        await controller.getMyFavorites(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 1);
        assert.equal(res._json.data[0].id, 'r1');
    });

    it('should return empty array when no favorites', async () => {
        mockPrisma.favoriteRoom.findMany = async () => [];
        const req = mockReq();
        const res = mockRes();
        await controller.getMyFavorites(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 0);
    });

    it('should filter out null rooms', async () => {
        mockPrisma.favoriteRoom.findMany = async () => [{ room: null }, { room: null }];
        const req = mockReq();
        const res = mockRes();
        await controller.getMyFavorites(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 0);
    });

    it('should return 500 on error', async () => {
        mockPrisma.favoriteRoom.findMany = async () => { throw new Error('DB'); };
        const req = mockReq();
        const res = mockRes();
        await controller.getMyFavorites(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getFavoriteIds
   ════════════════════════════════════════════ */
describe('favorite.controller — getFavoriteIds', () => {
    beforeEach(() => setup());

    it('should return array of room IDs', async () => {
        mockPrisma.favoriteRoom.findMany = async () => [{ roomId: 'r1' }, { roomId: 'r2' }];
        const req = mockReq();
        const res = mockRes();
        await controller.getFavoriteIds(req, res);
        assert.equal(res._status, 200);
        assert.deepEqual(res._json.data, ['r1', 'r2']);
    });

    it('should return empty array', async () => {
        mockPrisma.favoriteRoom.findMany = async () => [];
        const req = mockReq();
        const res = mockRes();
        await controller.getFavoriteIds(req, res);
        assert.equal(res._status, 200);
        assert.deepEqual(res._json.data, []);
    });

    it('should return 500 on error', async () => {
        mockPrisma.favoriteRoom.findMany = async () => { throw new Error('DB'); };
        const req = mockReq();
        const res = mockRes();
        await controller.getFavoriteIds(req, res);
        assert.equal(res._status, 500);
    });
});
