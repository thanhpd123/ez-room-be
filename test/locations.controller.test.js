const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

let mockPrisma, controller;

function setup() {
    mockPrisma = createMockPrisma();
    injectMock('../config/prisma', mockPrisma);
    clearModule('../controllers/locations.controller');
    controller = require('../controllers/locations.controller');
}

/* ════════════════════════════════════════════
   getAllLocations
   ════════════════════════════════════════════ */
describe('locations.controller — getAllLocations', () => {
    beforeEach(() => setup());

    it('should return all locations without filter', async () => {
        mockPrisma.location.findMany = async () => [
            { id: 'l1', address: '123 ABC', district: 'Q1', city: 'HCM', latitude: 10.7, longitude: 106.6 },
        ];
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getAllLocations(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 1);
        assert.equal(res._json.total, 1);
    });

    it('should apply city and district filters', async () => {
        let capturedWhere = null;
        mockPrisma.location.findMany = async (args) => { capturedWhere = args.where; return []; };
        const req = mockReq({ query: { city: 'HCM', district: 'Q1' } });
        const res = mockRes();
        await controller.getAllLocations(req, res);
        assert.equal(res._status, 200);
        assert.ok(capturedWhere.city);
        assert.ok(capturedWhere.district);
    });

    it('should apply search filter', async () => {
        let capturedWhere = null;
        mockPrisma.location.findMany = async (args) => { capturedWhere = args.where; return []; };
        const req = mockReq({ query: { search: 'Nguyễn' } });
        const res = mockRes();
        await controller.getAllLocations(req, res);
        assert.equal(res._status, 200);
        assert.ok(capturedWhere.OR);
        assert.equal(capturedWhere.OR.length, 3);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.findMany = async () => { throw new Error('DB'); };
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getAllLocations(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getCities
   ════════════════════════════════════════════ */
describe('locations.controller — getCities', () => {
    beforeEach(() => setup());

    it('should return distinct cities', async () => {
        mockPrisma.location.findMany = async () => [
            { city: 'Hà Nội' },
            { city: 'HCM' },
        ];
        const req = mockReq();
        const res = mockRes();
        await controller.getCities(req, res);
        assert.equal(res._status, 200);
        assert.deepEqual(res._json.data, ['Hà Nội', 'HCM']);
    });

    it('should filter out null cities', async () => {
        mockPrisma.location.findMany = async () => [{ city: null }, { city: 'HCM' }];
        const req = mockReq();
        const res = mockRes();
        await controller.getCities(req, res);
        assert.equal(res._status, 200);
        assert.deepEqual(res._json.data, ['HCM']);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.findMany = async () => { throw new Error('DB'); };
        const req = mockReq();
        const res = mockRes();
        await controller.getCities(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getDistricts
   ════════════════════════════════════════════ */
describe('locations.controller — getDistricts', () => {
    beforeEach(() => setup());

    it('should return districts', async () => {
        mockPrisma.location.findMany = async () => [
            { district: 'Cầu Giấy', city: 'Hà Nội' },
        ];
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getDistricts(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 1);
    });

    it('should filter by city when provided', async () => {
        let capturedWhere = null;
        mockPrisma.location.findMany = async (args) => { capturedWhere = args.where; return []; };
        const req = mockReq({ query: { city: 'Hà Nội' } });
        const res = mockRes();
        await controller.getDistricts(req, res);
        assert.ok(capturedWhere.city);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.findMany = async () => { throw new Error('DB'); };
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getDistricts(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getLocationById
   ════════════════════════════════════════════ */
describe('locations.controller — getLocationById', () => {
    beforeEach(() => setup());

    it('should return location with rental count', async () => {
        mockPrisma.location.findUnique = async () => ({
            id: 'l1', address: '123', district: 'Q1', city: 'HCM',
            latitude: 10.7, longitude: 106.6,
            rentals: [{ id: 'r1', title: 'T', status: 'APPROVED' }],
        });
        const req = mockReq({ params: { id: 'l1' } });
        const res = mockRes();
        await controller.getLocationById(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.rentalCount, 1);
    });

    it('should return 404 when not found', async () => {
        mockPrisma.location.findUnique = async () => null;
        const req = mockReq({ params: { id: 'bad' } });
        const res = mockRes();
        await controller.getLocationById(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.findUnique = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { id: 'l1' } });
        const res = mockRes();
        await controller.getLocationById(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   createLocation
   ════════════════════════════════════════════ */
describe('locations.controller — createLocation', () => {
    beforeEach(() => setup());

    it('should create location with all fields', async () => {
        mockPrisma.location.create = async (args) => ({ id: 'l-new', ...args.data });
        const req = mockReq({ body: { address: '123 ABC', district: 'Q1', city: 'HCM', latitude: 10.7, longitude: 106.6 } });
        const res = mockRes();
        await controller.createLocation(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
    });

    it('should create location with address only', async () => {
        mockPrisma.location.create = async (args) => ({ id: 'l-new', ...args.data });
        const req = mockReq({ body: { address: '456 XYZ' } });
        const res = mockRes();
        await controller.createLocation(req, res);
        assert.equal(res._status, 201);
    });

    it('should reject empty address', async () => {
        const req = mockReq({ body: { address: '' } });
        const res = mockRes();
        await controller.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject missing address', async () => {
        const req = mockReq({ body: {} });
        const res = mockRes();
        await controller.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject invalid latitude (> 90)', async () => {
        const req = mockReq({ body: { address: '123', latitude: 91 } });
        const res = mockRes();
        await controller.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject invalid latitude (< -90)', async () => {
        const req = mockReq({ body: { address: '123', latitude: -91 } });
        const res = mockRes();
        await controller.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject invalid longitude (> 180)', async () => {
        const req = mockReq({ body: { address: '123', longitude: 181 } });
        const res = mockRes();
        await controller.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject invalid longitude (< -180)', async () => {
        const req = mockReq({ body: { address: '123', longitude: -181 } });
        const res = mockRes();
        await controller.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject non-number latitude', async () => {
        const req = mockReq({ body: { address: '123', latitude: 'abc' } });
        const res = mockRes();
        await controller.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.create = async () => { throw new Error('DB'); };
        const req = mockReq({ body: { address: '123' } });
        const res = mockRes();
        await controller.createLocation(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   updateLocation
   ════════════════════════════════════════════ */
describe('locations.controller — updateLocation', () => {
    beforeEach(() => setup());

    it('should update address', async () => {
        mockPrisma.location.findUnique = async () => ({ id: 'l1', address: 'Old' });
        mockPrisma.location.update = async (args) => ({ id: 'l1', ...args.data });
        const req = mockReq({ params: { id: 'l1' }, body: { address: 'New' } });
        const res = mockRes();
        await controller.updateLocation(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should return 404 when not found', async () => {
        mockPrisma.location.findUnique = async () => null;
        const req = mockReq({ params: { id: 'bad' }, body: { address: 'New' } });
        const res = mockRes();
        await controller.updateLocation(req, res);
        assert.equal(res._status, 404);
    });

    it('should reject empty address', async () => {
        mockPrisma.location.findUnique = async () => ({ id: 'l1' });
        const req = mockReq({ params: { id: 'l1' }, body: { address: '' } });
        const res = mockRes();
        await controller.updateLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject invalid latitude', async () => {
        mockPrisma.location.findUnique = async () => ({ id: 'l1' });
        const req = mockReq({ params: { id: 'l1' }, body: { latitude: 999 } });
        const res = mockRes();
        await controller.updateLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject invalid longitude', async () => {
        mockPrisma.location.findUnique = async () => ({ id: 'l1' });
        const req = mockReq({ params: { id: 'l1' }, body: { longitude: -200 } });
        const res = mockRes();
        await controller.updateLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject empty body (no data)', async () => {
        mockPrisma.location.findUnique = async () => ({ id: 'l1' });
        const req = mockReq({ params: { id: 'l1' }, body: {} });
        const res = mockRes();
        await controller.updateLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.findUnique = async () => ({ id: 'l1' });
        mockPrisma.location.update = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { id: 'l1' }, body: { address: 'New' } });
        const res = mockRes();
        await controller.updateLocation(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   deleteLocation
   ════════════════════════════════════════════ */
describe('locations.controller — deleteLocation', () => {
    beforeEach(() => setup());

    it('should delete location with no rentals', async () => {
        mockPrisma.location.findUnique = async () => ({
            id: 'l1', address: '123', rentals: [],
        });
        mockPrisma.location.delete = async () => ({});
        const req = mockReq({ params: { id: 'l1' } });
        const res = mockRes();
        await controller.deleteLocation(req, res);
        assert.equal(res._status, 200);
    });

    it('should return 409 when location has rentals', async () => {
        mockPrisma.location.findUnique = async () => ({
            id: 'l1', address: '123', rentals: [{ id: 'ren1' }],
        });
        const req = mockReq({ params: { id: 'l1' } });
        const res = mockRes();
        await controller.deleteLocation(req, res);
        assert.equal(res._status, 409);
    });

    it('should return 404 when not found', async () => {
        mockPrisma.location.findUnique = async () => null;
        const req = mockReq({ params: { id: 'bad' } });
        const res = mockRes();
        await controller.deleteLocation(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.findUnique = async () => ({
            id: 'l1', address: '123', rentals: [],
        });
        mockPrisma.location.delete = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { id: 'l1' } });
        const res = mockRes();
        await controller.deleteLocation(req, res);
        assert.equal(res._status, 500);
    });
});
