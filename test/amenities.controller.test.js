const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();
const mockCache = { get: () => null, set: () => {}, invalidate: () => {} };

function loadController() {
    clearModule('../controllers/amenities.controller');
    injectMock('../config/prisma', mockPrisma);
    injectMock('../utils/simple-cache', mockCache);
    return require('../controllers/amenities.controller');
}

const fakeAmenity = { id: 'am-1', name: 'WiFi' };

/* ================================================================
   getAllAmenities
   ================================================================ */
describe('Amenities > getAllAmenities', () => {
    beforeEach(() => {
        mockCache.get = () => null;
        mockPrisma.amenities.findMany = async () => [fakeAmenity];
    });

    it('should return amenities from DB', async () => {
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getAllAmenities(req, res);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.length, 1);
    });

    it('should return cached data if available', async () => {
        mockCache.get = () => [fakeAmenity];
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getAllAmenities(req, res);
        assert.equal(res._json.data.length, 1);
    });

    it('should return 500 on error', async () => {
        mockCache.get = () => null;
        mockPrisma.amenities.findMany = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getAllAmenities(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getAmenityById
   ================================================================ */
describe('Amenities > getAmenityById', () => {
    beforeEach(() => {
        mockPrisma.amenities.findUnique = async () => ({
            ...fakeAmenity, roomAmenities: [{ roomId: 'r1' }],
        });
    });

    it('should return amenity with room count', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'am-1' } });
        const res = mockRes();
        await ctrl.getAmenityById(req, res);
        assert.equal(res._json.data.roomCount, 1);
    });

    it('should return 404 when not found', async () => {
        mockPrisma.amenities.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'nope' } });
        const res = mockRes();
        await ctrl.getAmenityById(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.amenities.findUnique = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'am-1' } });
        const res = mockRes();
        await ctrl.getAmenityById(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   createAmenity
   ================================================================ */
describe('Amenities > createAmenity', () => {
    beforeEach(() => {
        mockPrisma.amenities.findUnique = async () => null;
        mockPrisma.amenities.create = async ({ data }) => ({ id: 'am-new', name: data.name });
    });

    it('should create amenity', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { name: 'Parking' } });
        const res = mockRes();
        await ctrl.createAmenity(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.data.name, 'Parking');
    });

    it('should reject empty name', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { name: '' } });
        const res = mockRes();
        await ctrl.createAmenity(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject missing name', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: {} });
        const res = mockRes();
        await ctrl.createAmenity(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject name longer than 100 chars', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { name: 'a'.repeat(101) } });
        const res = mockRes();
        await ctrl.createAmenity(req, res);
        assert.equal(res._status, 400);
    });

    it('should trim name', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { name: '  Pool  ' } });
        const res = mockRes();
        await ctrl.createAmenity(req, res);
        assert.equal(res._json.data.name, 'Pool');
    });

    it('should return 409 on duplicate', async () => {
        mockPrisma.amenities.findUnique = async () => fakeAmenity;
        const ctrl = loadController();
        const req = mockReq({ body: { name: 'WiFi' } });
        const res = mockRes();
        await ctrl.createAmenity(req, res);
        assert.equal(res._status, 409);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.amenities.create = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ body: { name: 'Gym' } });
        const res = mockRes();
        await ctrl.createAmenity(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   updateAmenity
   ================================================================ */
describe('Amenities > updateAmenity', () => {
    beforeEach(() => {
        mockPrisma.amenities.findUnique = async () => fakeAmenity;
        mockPrisma.amenities.findFirst = async () => null;
        mockPrisma.amenities.update = async ({ data }) => ({ id: 'am-1', name: data.name });
    });

    it('should update amenity name', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'am-1' }, body: { name: 'WiFi 5G' } });
        const res = mockRes();
        await ctrl.updateAmenity(req, res);
        assert.equal(res._json.data.name, 'WiFi 5G');
    });

    it('should return 404 when not found', async () => {
        mockPrisma.amenities.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'nope' }, body: { name: 'X' } });
        const res = mockRes();
        await ctrl.updateAmenity(req, res);
        assert.equal(res._status, 404);
    });

    it('should reject empty name', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'am-1' }, body: { name: '' } });
        const res = mockRes();
        await ctrl.updateAmenity(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject name > 100 chars', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'am-1' }, body: { name: 'x'.repeat(101) } });
        const res = mockRes();
        await ctrl.updateAmenity(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 409 on duplicate name', async () => {
        mockPrisma.amenities.findFirst = async () => ({ id: 'am-2', name: 'Pool' });
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'am-1' }, body: { name: 'Pool' } });
        const res = mockRes();
        await ctrl.updateAmenity(req, res);
        assert.equal(res._status, 409);
    });

    it('should return 500 on error', async () => {
        mockPrisma.amenities.update = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'am-1' }, body: { name: 'Gym' } });
        const res = mockRes();
        await ctrl.updateAmenity(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   deleteAmenity
   ================================================================ */
describe('Amenities > deleteAmenity', () => {
    beforeEach(() => {
        mockPrisma.amenities.findUnique = async () => ({
            ...fakeAmenity, roomAmenities: [],
        });
        mockPrisma.amenities.delete = async () => ({});
    });

    it('should delete amenity', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'am-1' } });
        const res = mockRes();
        await ctrl.deleteAmenity(req, res);
        assert.equal(res._json.success, true);
    });

    it('should warn when amenity is in use', async () => {
        mockPrisma.amenities.findUnique = async () => ({
            ...fakeAmenity, roomAmenities: [{ roomId: 'r1' }, { roomId: 'r2' }],
        });
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'am-1' } });
        const res = mockRes();
        await ctrl.deleteAmenity(req, res);
        assert.ok(res._json.message.includes('2'));
    });

    it('should return 404 when not found', async () => {
        mockPrisma.amenities.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'nope' } });
        const res = mockRes();
        await ctrl.deleteAmenity(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.amenities.delete = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'am-1' } });
        const res = mockRes();
        await ctrl.deleteAmenity(req, res);
        assert.equal(res._status, 500);
    });
});
