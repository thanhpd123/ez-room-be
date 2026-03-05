const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();
const mockValidator = {
    validateCreateRental: () => ({ valid: true, errors: [] }),
    validateUpdateRentalStatus: () => ({ valid: true, errors: [] }),
};
const mockMapper = { getLabelForDb: (v) => v, mapDbToFe: (v, d) => v || d, mapFeToDb: (v) => v };
const mockLegacy = {
    expandCity: (c) => [c],
    expandDistrict: (d) => [d],
    extractLocationTermsFromQuery: () => ({ cities: [], districts: [] }),
};
const mockCache = { get: () => null, set: () => {}, invalidate: () => {} };

function loadController() {
    clearModule('../controllers/rental.controller');
    injectMock('../config/prisma', mockPrisma);
    injectMock('../validators/rental.validator', mockValidator);
    injectMock('../utils/room-type-mapper', mockMapper);
    injectMock('../data/legacy-location-map', mockLegacy);
    injectMock('../utils/simple-cache', mockCache);
    return require('../controllers/rental.controller');
}

const fakeRental = {
    id: 'rental-1', title: 'Test Rental', description: 'Desc', status: 'PENDING',
    createdAt: new Date(), owner_id: 'user-1',
    location: { id: 'loc-1', address: '123 St', district: 'Q1', city: 'HCM' },
    images: [{ imageUrl: 'https://example.com/img.jpg' }],
    users: { id: 'user-1', fullName: 'Owner', avatarUrl: null },
    rooms: [],
};

/* ================================================================
   createRental
   ================================================================ */
describe('Rental > createRental', () => {
    beforeEach(() => {
        mockValidator.validateCreateRental = () => ({ valid: true, errors: [] });
        mockPrisma.location.findFirst = async () => null;
        mockPrisma.location.create = async () => ({ id: 'loc-new', address: '123 St', district: 'Q1', city: 'HCM' });
        mockPrisma.rental.create = async () => fakeRental;
    });

    it('should create rental successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { title: 'New', city: 'HCM', district: 'Q1', address: '123 St' } });
        const res = mockRes();
        await ctrl.createRental(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
    });

    it('should reuse existing location', async () => {
        mockPrisma.location.findFirst = async () => ({ id: 'loc-1' });
        const ctrl = loadController();
        const req = mockReq({ body: { title: 'New', city: 'HCM', district: 'Q1', address: '123 St' } });
        const res = mockRes();
        await ctrl.createRental(req, res);
        assert.equal(res._status, 201);
    });

    it('should return 400 on validation failure', async () => {
        mockValidator.validateCreateRental = () => ({ valid: false, errors: ['Title required'] });
        const ctrl = loadController();
        const req = mockReq({ body: {} });
        const res = mockRes();
        await ctrl.createRental(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.rental.create = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ body: { title: 'X', city: 'HCM', district: 'Q1', address: 'St' } });
        const res = mockRes();
        await ctrl.createRental(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getRentals
   ================================================================ */
describe('Rental > getRentals', () => {
    beforeEach(() => {
        mockPrisma.rental.findMany = async () => [fakeRental];
        mockPrisma.rental.count = async () => 1;
    });

    it('should return paginated rentals', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: { page: '1', limit: '10' } });
        const res = mockRes();
        await ctrl.getRentals(req, res);
        assert.equal(res._json.success, true);
        assert.equal(res._json.pagination.total, 1);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.findMany = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getRentals(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getRentalById
   ================================================================ */
describe('Rental > getRentalById', () => {
    beforeEach(() => {
        mockPrisma.rental.findUnique = async () => fakeRental;
    });

    it('should return rental details', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { rentalId: 'rental-1' } });
        const res = mockRes();
        await ctrl.getRentalById(req, res);
        assert.equal(res._json.data.id, 'rental-1');
    });

    it('should return 404 when not found', async () => {
        mockPrisma.rental.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { rentalId: 'nope' } });
        const res = mockRes();
        await ctrl.getRentalById(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.findUnique = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ params: { rentalId: 'rental-1' } });
        const res = mockRes();
        await ctrl.getRentalById(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getMyRentals
   ================================================================ */
describe('Rental > getMyRentals', () => {
    beforeEach(() => {
        mockPrisma.rental.findMany = async () => [fakeRental];
        mockPrisma.rental.count = async () => 1;
    });

    it('should return current user rentals', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getMyRentals(req, res);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.length, 1);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.findMany = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getMyRentals(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   updateRentalStatus
   ================================================================ */
describe('Rental > updateRentalStatus', () => {
    beforeEach(() => {
        mockValidator.validateUpdateRentalStatus = () => ({ valid: true, errors: [] });
        mockPrisma.rental.findUnique = async () => fakeRental;
        mockPrisma.rental.update = async ({ data }) => ({
            ...fakeRental, status: data.status, location: fakeRental.location,
        });
    });

    it('should update status', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { rentalId: 'rental-1' }, body: { status: 'AVAILABLE' } });
        const res = mockRes();
        await ctrl.updateRentalStatus(req, res);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.status, 'AVAILABLE');
    });

    it('should return 400 on invalid body', async () => {
        mockValidator.validateUpdateRentalStatus = () => ({ valid: false, errors: ['bad'] });
        const ctrl = loadController();
        const req = mockReq({ params: { rentalId: 'rental-1' }, body: {} });
        const res = mockRes();
        await ctrl.updateRentalStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 when not found', async () => {
        mockPrisma.rental.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { rentalId: 'nope' }, body: { status: 'AVAILABLE' } });
        const res = mockRes();
        await ctrl.updateRentalStatus(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.update = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq({ params: { rentalId: 'rental-1' }, body: { status: 'AVAILABLE' } });
        const res = mockRes();
        await ctrl.updateRentalStatus(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getRentalStats
   ================================================================ */
describe('Rental > getRentalStats', () => {
    beforeEach(() => {
        mockPrisma.rental.count = async () => 10;
    });

    it('should return rental statistics', async () => {
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getRentalStats(req, res);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.total, 10);
        assert.ok(res._json.data.byStatus);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.count = async () => { throw new Error('db'); };
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getRentalStats(req, res);
        assert.equal(res._status, 500);
    });
});
