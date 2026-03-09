const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();

function loadController() {
    clearModule('../controllers/locations.controller');
    injectMock('../config/prisma', mockPrisma);
    return require('../controllers/locations.controller');
}

const fakeLoc = { id: 'loc-1', address: '123 St', district: 'Q1', city: 'HCM', latitude: 10.7, longitude: 106.6 };

/* ================================================================
   getAllLocations
   ================================================================ */
describe('Locations > getAllLocations', () => {
    beforeEach(() => {
        mockPrisma.location.findMany = async () => [fakeLoc];
    });

    it('should return all locations', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getAllLocations(req, res);
        assert.equal(res._json.success, true);
        assert.equal(res._json.total, 1);
    });

    it('should filter by city', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: { city: 'HCM' } });
        const res = mockRes();
        await ctrl.getAllLocations(req, res);
        assert.equal(res._json.success, true);
    });

    it('should filter by search keyword', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: { search: 'Q1' } });
        const res = mockRes();
        await ctrl.getAllLocations(req, res);
        assert.equal(res._json.success, true);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.findMany = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getAllLocations(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getCities
   ================================================================ */
describe('Locations > getCities', () => {
    beforeEach(() => {
        mockPrisma.location.findMany = async () => [{ city: 'HCM' }, { city: 'Hanoi' }];
    });

    it('should return distinct cities', async () => {
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getCities(req, res);
        assert.deepEqual(res._json.data, ['HCM', 'Hanoi']);
    });

    it('should filter null cities', async () => {
        mockPrisma.location.findMany = async () => [{ city: null }, { city: 'HCM' }];
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getCities(req, res);
        assert.deepEqual(res._json.data, ['HCM']);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.findMany = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getCities(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getDistricts
   ================================================================ */
describe('Locations > getDistricts', () => {
    beforeEach(() => {
        mockPrisma.location.findMany = async () => [{ district: 'Q1', city: 'HCM' }];
    });

    it('should return districts', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getDistricts(req, res);
        assert.equal(res._json.data.length, 1);
    });

    it('should filter by city', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: { city: 'HCM' } });
        const res = mockRes();
        await ctrl.getDistricts(req, res);
        assert.equal(res._json.success, true);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.findMany = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getDistricts(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getLocationById
   ================================================================ */
describe('Locations > getLocationById', () => {
    beforeEach(() => {
        mockPrisma.location.findUnique = async () => ({
            ...fakeLoc, rentals: [{ id: 'r1', title: 'Rental', status: 'ACTIVE' }],
        });
    });

    it('should return location with rental count', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'loc-1' } });
        const res = mockRes();
        await ctrl.getLocationById(req, res);
        assert.equal(res._json.data.rentalCount, 1);
    });

    it('should return 404 when not found', async () => {
        mockPrisma.location.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'nope' } });
        const res = mockRes();
        await ctrl.getLocationById(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.findUnique = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'loc-1' } });
        const res = mockRes();
        await ctrl.getLocationById(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   createLocation
   ================================================================ */
describe('Locations > createLocation', () => {
    beforeEach(() => {
        mockPrisma.location.create = async ({ data }) => ({ id: 'loc-new', ...data });
    });

    it('should create location', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { address: '456 St', district: 'Q2', city: 'HCM' } });
        const res = mockRes();
        await ctrl.createLocation(req, res);
        assert.equal(res._status, 201);
    });

    it('should reject empty address', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { address: '' } });
        const res = mockRes();
        await ctrl.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject missing address', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: {} });
        const res = mockRes();
        await ctrl.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject invalid latitude > 90', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { address: 'St', latitude: 91 } });
        const res = mockRes();
        await ctrl.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject invalid latitude < -90', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { address: 'St', latitude: -91 } });
        const res = mockRes();
        await ctrl.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject invalid longitude > 180', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { address: 'St', longitude: 181 } });
        const res = mockRes();
        await ctrl.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject invalid longitude < -180', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { address: 'St', longitude: -181 } });
        const res = mockRes();
        await ctrl.createLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should accept valid coordinates', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { address: 'St', latitude: 10.7, longitude: 106.6 } });
        const res = mockRes();
        await ctrl.createLocation(req, res);
        assert.equal(res._status, 201);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.create = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ body: { address: 'St' } });
        const res = mockRes();
        await ctrl.createLocation(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   updateLocation
   ================================================================ */
describe('Locations > updateLocation', () => {
    beforeEach(() => {
        mockPrisma.location.findUnique = async () => fakeLoc;
        mockPrisma.location.update = async ({ data }) => ({ ...fakeLoc, ...data });
    });

    it('should update location', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'loc-1' }, body: { address: 'New St' } });
        const res = mockRes();
        await ctrl.updateLocation(req, res);
        assert.equal(res._json.success, true);
    });

    it('should return 404 when not found', async () => {
        mockPrisma.location.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'nope' }, body: { address: 'X' } });
        const res = mockRes();
        await ctrl.updateLocation(req, res);
        assert.equal(res._status, 404);
    });

    it('should reject empty address', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'loc-1' }, body: { address: '' } });
        const res = mockRes();
        await ctrl.updateLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject empty body', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'loc-1' }, body: {} });
        const res = mockRes();
        await ctrl.updateLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject invalid latitude', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'loc-1' }, body: { latitude: 999 } });
        const res = mockRes();
        await ctrl.updateLocation(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.update = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'loc-1' }, body: { city: 'Hanoi' } });
        const res = mockRes();
        await ctrl.updateLocation(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   deleteLocation
   ================================================================ */
describe('Locations > deleteLocation', () => {
    beforeEach(() => {
        mockPrisma.location.findUnique = async () => ({ ...fakeLoc, rentals: [] });
        mockPrisma.location.delete = async () => ({});
    });

    it('should delete location', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'loc-1' } });
        const res = mockRes();
        await ctrl.deleteLocation(req, res);
        assert.equal(res._json.success, true);
    });

    it('should return 409 when location has rentals', async () => {
        mockPrisma.location.findUnique = async () => ({ ...fakeLoc, rentals: [{ id: 'r1' }] });
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'loc-1' } });
        const res = mockRes();
        await ctrl.deleteLocation(req, res);
        assert.equal(res._status, 409);
    });

    it('should return 404 when not found', async () => {
        mockPrisma.location.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'nope' } });
        const res = mockRes();
        await ctrl.deleteLocation(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.location.delete = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'loc-1' } });
        const res = mockRes();
        await ctrl.deleteLocation(req, res);
        assert.equal(res._status, 500);
    });
});
