const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();
const mockRoomTypeMapper = { mapDbToFe: (v, def) => v || def };

function loadController() {
    clearModule('../controllers/favorite.controller');
    injectMock('../config/prisma', mockPrisma);
    injectMock('../utils/room-type-mapper', mockRoomTypeMapper);
    return require('../controllers/favorite.controller');
}

const fakeRoom = {
    id: 'room-1', room_name: 'Room A', price: 3000000, size_m2: 25, room_type: 'single', status: 'AVAILABLE',
    images: [{ imageUrl: 'https://example.com/room.jpg' }],
    roomAmenities: [{ amenity: { name: 'WiFi' } }],
    rentals: {
        id: 'rental-1', title: 'Rental A',
        location: { address: '123 St', district: 'Q1', city: 'HCM' },
        images: [{ imageUrl: 'https://example.com/rental.jpg' }],
    },
};

/* ================================================================
   formatRoomForFavorite
   ================================================================ */
describe('Favorite > formatRoomForFavorite', () => {
    it('should format room with full details', () => {
        const ctrl = loadController();
        const result = ctrl.formatRoomForFavorite(fakeRoom);
        assert.equal(result.id, 'room-1');
        assert.equal(result.price, 3000000);
        assert.ok(result.images.length > 0);
        assert.ok(result.amenities.includes('WiFi'));
        assert.ok(result.address.includes('Q1'));
    });

    it('should use rental images when room has no images', () => {
        const ctrl = loadController();
        const room = { ...fakeRoom, images: [] };
        const result = ctrl.formatRoomForFavorite(room);
        assert.equal(result.images[0], 'https://example.com/rental.jpg');
    });

    it('should use placeholder when no images at all', () => {
        const ctrl = loadController();
        const room = { ...fakeRoom, images: [], rentals: { ...fakeRoom.rentals, images: [] } };
        const result = ctrl.formatRoomForFavorite(room);
        assert.ok(result.images[0].includes('unsplash'));
    });
});

/* ================================================================
   addFavorite
   ================================================================ */
describe('Favorite > addFavorite', () => {
    beforeEach(() => {
        mockPrisma.rooms.findUnique = async () => fakeRoom;
        mockPrisma.favoriteRoom.upsert = async () => ({});
    });

    it('should add favorite successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'room-1' } });
        const res = mockRes();
        await ctrl.addFavorite(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should return 404 when room not found', async () => {
        mockPrisma.rooms.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'nope' } });
        const res = mockRes();
        await ctrl.addFavorite(req, res);
        assert.equal(res._status, 404);
    });

    it('should handle upsert without error on duplicate', async () => {
        mockPrisma.favoriteRoom.upsert = async () => ({ userId: 'user-1', roomId: 'room-1' });
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'room-1' } });
        const res = mockRes();
        await ctrl.addFavorite(req, res);
        assert.equal(res._status, 200);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.rooms.findUnique = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'room-1' } });
        const res = mockRes();
        await ctrl.addFavorite(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   removeFavorite
   ================================================================ */
describe('Favorite > removeFavorite', () => {
    beforeEach(() => {
        mockPrisma.favoriteRoom.deleteMany = async () => ({ count: 1 });
    });

    it('should remove favorite successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'room-1' } });
        const res = mockRes();
        await ctrl.removeFavorite(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should succeed even if not in favorites', async () => {
        mockPrisma.favoriteRoom.deleteMany = async () => ({ count: 0 });
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'room-1' } });
        const res = mockRes();
        await ctrl.removeFavorite(req, res);
        assert.equal(res._status, 200);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.favoriteRoom.deleteMany = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { roomId: 'room-1' } });
        const res = mockRes();
        await ctrl.removeFavorite(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getMyFavorites
   ================================================================ */
describe('Favorite > getMyFavorites', () => {
    beforeEach(() => {
        mockPrisma.favoriteRoom.findMany = async () => [{ room: fakeRoom }];
    });

    it('should return formatted favorite rooms', async () => {
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getMyFavorites(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 1);
    });

    it('should return empty array when no favorites', async () => {
        mockPrisma.favoriteRoom.findMany = async () => [];
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getMyFavorites(req, res);
        assert.equal(res._json.data.length, 0);
    });

    it('should filter out null rooms', async () => {
        mockPrisma.favoriteRoom.findMany = async () => [{ room: null }, { room: fakeRoom }];
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getMyFavorites(req, res);
        assert.equal(res._json.data.length, 1);
    });

    it('should return 500 on error', async () => {
        mockPrisma.favoriteRoom.findMany = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getMyFavorites(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getFavoriteIds
   ================================================================ */
describe('Favorite > getFavoriteIds', () => {
    beforeEach(() => {
        mockPrisma.favoriteRoom.findMany = async () => [{ roomId: 'room-1' }, { roomId: 'room-2' }];
    });

    it('should return array of room IDs', async () => {
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getFavoriteIds(req, res);
        assert.equal(res._status, 200);
        assert.deepEqual(res._json.data, ['room-1', 'room-2']);
    });

    it('should return empty array', async () => {
        mockPrisma.favoriteRoom.findMany = async () => [];
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getFavoriteIds(req, res);
        assert.deepEqual(res._json.data, []);
    });

    it('should return 500 on error', async () => {
        mockPrisma.favoriteRoom.findMany = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getFavoriteIds(req, res);
        assert.equal(res._status, 500);
    });
});
