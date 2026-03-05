const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

let mockPrisma, controller;

function setup() {
    mockPrisma = createMockPrisma();
    /* Mock the simple-cache module */
    const fakeCache = new Map();
    injectMock('../utils/simple-cache', {
        get: (k) => fakeCache.get(k) ?? null,
        set: (k, v) => fakeCache.set(k, v),
        invalidate: (k) => fakeCache.delete(k),
    });
    injectMock('../config/prisma', mockPrisma);
    clearModule('../controllers/amenities.controller');
    controller = require('../controllers/amenities.controller');
}

/* ════════════════════════════════════════════
   getAllAmenities
   ════════════════════════════════════════════ */
describe('amenities.controller — getAllAmenities', () => {
    beforeEach(() => setup());

    it('should return all amenities from DB', async () => {
        mockPrisma.amenities.findMany = async () => [
            { id: 'a1', name: 'WiFi' },
            { id: 'a2', name: 'Máy lạnh' },
        ];
        const req = mockReq();
        const res = mockRes();
        await controller.getAllAmenities(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 2);
        assert.equal(res._json.total, 2);
    });

    it('should return empty array when none exist', async () => {
        mockPrisma.amenities.findMany = async () => [];
        const req = mockReq();
        const res = mockRes();
        await controller.getAllAmenities(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 0);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.amenities.findMany = async () => { throw new Error('DB'); };
        const req = mockReq();
        const res = mockRes();
        await controller.getAllAmenities(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getAmenityById
   ════════════════════════════════════════════ */
describe('amenities.controller — getAmenityById', () => {
    beforeEach(() => setup());

    it('should return amenity with room count', async () => {
        mockPrisma.amenities.findUnique = async () => ({
            id: 'a1', name: 'WiFi',
            roomAmenities: [{ roomId: 'r1' }, { roomId: 'r2' }],
        });
        const req = mockReq({ params: { id: 'a1' } });
        const res = mockRes();
        await controller.getAmenityById(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.name, 'WiFi');
        assert.equal(res._json.data.roomCount, 2);
    });

    it('should return 404 when not found', async () => {
        mockPrisma.amenities.findUnique = async () => null;
        const req = mockReq({ params: { id: 'bad' } });
        const res = mockRes();
        await controller.getAmenityById(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.amenities.findUnique = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { id: 'a1' } });
        const res = mockRes();
        await controller.getAmenityById(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   createAmenity
   ════════════════════════════════════════════ */
describe('amenities.controller — createAmenity', () => {
    beforeEach(() => setup());

    it('should create amenity successfully', async () => {
        mockPrisma.amenities.findUnique = async () => null; // no dup
        mockPrisma.amenities.create = async (args) => ({ id: 'a-new', name: args.data.name });
        const req = mockReq({ body: { name: 'Bể bơi' } });
        const res = mockRes();
        await controller.createAmenity(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.data.name, 'Bể bơi');
    });

    it('should reject empty name', async () => {
        const req = mockReq({ body: { name: '' } });
        const res = mockRes();
        await controller.createAmenity(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject whitespace-only name', async () => {
        const req = mockReq({ body: { name: '   ' } });
        const res = mockRes();
        await controller.createAmenity(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject missing name', async () => {
        const req = mockReq({ body: {} });
        const res = mockRes();
        await controller.createAmenity(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject name over 100 chars', async () => {
        const req = mockReq({ body: { name: 'x'.repeat(101) } });
        const res = mockRes();
        await controller.createAmenity(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 409 on duplicate name', async () => {
        mockPrisma.amenities.findUnique = async () => ({ id: 'a1', name: 'WiFi' });
        const req = mockReq({ body: { name: 'WiFi' } });
        const res = mockRes();
        await controller.createAmenity(req, res);
        assert.equal(res._status, 409);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.amenities.findUnique = async () => null;
        mockPrisma.amenities.create = async () => { throw new Error('DB'); };
        const req = mockReq({ body: { name: 'Test' } });
        const res = mockRes();
        await controller.createAmenity(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   updateAmenity
   ════════════════════════════════════════════ */
describe('amenities.controller — updateAmenity', () => {
    beforeEach(() => setup());

    it('should update successfully', async () => {
        mockPrisma.amenities.findUnique = async () => ({ id: 'a1', name: 'Old' });
        mockPrisma.amenities.findFirst = async () => null; // no dup
        mockPrisma.amenities.update = async () => ({ id: 'a1', name: 'New' });
        const req = mockReq({ params: { id: 'a1' }, body: { name: 'New' } });
        const res = mockRes();
        await controller.updateAmenity(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.name, 'New');
    });

    it('should return 404 when not found', async () => {
        mockPrisma.amenities.findUnique = async () => null;
        const req = mockReq({ params: { id: 'bad' }, body: { name: 'New' } });
        const res = mockRes();
        await controller.updateAmenity(req, res);
        assert.equal(res._status, 404);
    });

    it('should reject empty name', async () => {
        mockPrisma.amenities.findUnique = async () => ({ id: 'a1', name: 'Old' });
        const req = mockReq({ params: { id: 'a1' }, body: { name: '' } });
        const res = mockRes();
        await controller.updateAmenity(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject name over 100 chars', async () => {
        mockPrisma.amenities.findUnique = async () => ({ id: 'a1', name: 'Old' });
        const req = mockReq({ params: { id: 'a1' }, body: { name: 'x'.repeat(101) } });
        const res = mockRes();
        await controller.updateAmenity(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 409 on duplicate name', async () => {
        mockPrisma.amenities.findUnique = async () => ({ id: 'a1', name: 'Old' });
        mockPrisma.amenities.findFirst = async () => ({ id: 'a2', name: 'New' });
        const req = mockReq({ params: { id: 'a1' }, body: { name: 'New' } });
        const res = mockRes();
        await controller.updateAmenity(req, res);
        assert.equal(res._status, 409);
    });

    it('should return 500 on error', async () => {
        mockPrisma.amenities.findUnique = async () => ({ id: 'a1', name: 'Old' });
        mockPrisma.amenities.findFirst = async () => null;
        mockPrisma.amenities.update = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { id: 'a1' }, body: { name: 'New' } });
        const res = mockRes();
        await controller.updateAmenity(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   deleteAmenity
   ════════════════════════════════════════════ */
describe('amenities.controller — deleteAmenity', () => {
    beforeEach(() => setup());

    it('should delete amenity with no rooms', async () => {
        mockPrisma.amenities.findUnique = async () => ({
            id: 'a1', name: 'WiFi', roomAmenities: [],
        });
        mockPrisma.amenities.delete = async () => ({});
        const req = mockReq({ params: { id: 'a1' } });
        const res = mockRes();
        await controller.deleteAmenity(req, res);
        assert.equal(res._status, 200);
        assert.ok(!res._json.message.includes('gỡ khỏi'));
    });

    it('should delete amenity with rooms and warn', async () => {
        mockPrisma.amenities.findUnique = async () => ({
            id: 'a1', name: 'WiFi', roomAmenities: [{ roomId: 'r1' }, { roomId: 'r2' }],
        });
        mockPrisma.amenities.delete = async () => ({});
        const req = mockReq({ params: { id: 'a1' } });
        const res = mockRes();
        await controller.deleteAmenity(req, res);
        assert.equal(res._status, 200);
        assert.ok(res._json.message.includes('2 phòng'));
    });

    it('should return 404 when not found', async () => {
        mockPrisma.amenities.findUnique = async () => null;
        const req = mockReq({ params: { id: 'bad' } });
        const res = mockRes();
        await controller.deleteAmenity(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.amenities.findUnique = async () => ({
            id: 'a1', name: 'WiFi', roomAmenities: [],
        });
        mockPrisma.amenities.delete = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { id: 'a1' } });
        const res = mockRes();
        await controller.deleteAmenity(req, res);
        assert.equal(res._status, 500);
    });
});
