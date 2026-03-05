const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

let mockPrisma, controller;

function setup() {
    mockPrisma = createMockPrisma();
    injectMock('../config/prisma', mockPrisma);
    injectMock('../utils/simple-cache', {
        get: () => null, set: () => {}, invalidate: () => {},
    });
    injectMock('../utils/room-type-mapper', {
        getLabelForDb: (v) => v || 'Phòng đơn',
        mapFeToDb: (v) => v,
        mapDbToFe: (v) => v,
    });
    injectMock('../data/legacy-location-map', {
        expandCity: (c) => [c],
        expandDistrict: (d) => [d],
        extractLocationTermsFromQuery: () => ({ cities: [], districts: [] }),
    });
    injectMock('../validators/rental.validator', {
        validateCreateRental: (body) => {
            if (!body.title || !body.city || !body.district || !body.address)
                return { valid: false, errors: ['missing fields'] };
            return { valid: true, errors: [] };
        },
        validateUpdateRentalStatus: (body) => {
            if (!body.status) return { valid: false, errors: ['missing status'] };
            return { valid: true, errors: [] };
        },
    });
    clearModule('../controllers/rental.controller');
    controller = require('../controllers/rental.controller');
}

/* ════════════════════════════════════════════
   createRental
   ════════════════════════════════════════════ */
describe('rental.controller — createRental', () => {
    beforeEach(() => setup());

    it('should create a rental', async () => {
        mockPrisma.location.findFirst = async () => null;
        mockPrisma.location.create = async () => ({ id: 'loc1' });
        mockPrisma.rental.create = async () => ({
            id: 'ren1', title: 'Test', description: null, status: 'PENDING',
            createdAt: '2026-01-01',
            location: { id: 'loc1', address: '123', district: 'Q1', city: 'HCM' },
            images: [],
        });
        const req = mockReq({
            body: { title: 'Test', city: 'HCM', district: 'Q1', address: '123' },
        });
        const res = mockRes();
        await controller.createRental(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.data.status, 'PENDING');
    });

    it('should reuse existing location', async () => {
        mockPrisma.location.findFirst = async () => ({ id: 'loc-existing' });
        mockPrisma.rental.create = async () => ({
            id: 'ren1', title: 'T', status: 'PENDING', createdAt: '2026-01-01',
            location: { id: 'loc-existing', address: '1', district: 'Q1', city: 'HCM' },
            images: [],
        });
        const req = mockReq({
            body: { title: 'T', city: 'HCM', district: 'Q1', address: '1' },
        });
        const res = mockRes();
        await controller.createRental(req, res);
        assert.equal(res._status, 201);
    });

    it('should return 400 on validation error', async () => {
        const req = mockReq({ body: {} });
        const res = mockRes();
        await controller.createRental(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.location.findFirst = async () => { throw new Error('DB'); };
        const req = mockReq({
            body: { title: 'T', city: 'HCM', district: 'Q1', address: '1' },
        });
        const res = mockRes();
        await controller.createRental(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getRentals
   ════════════════════════════════════════════ */
describe('rental.controller — getRentals', () => {
    beforeEach(() => setup());

    it('should return paginated rentals', async () => {
        mockPrisma.rental.findMany = async () => [
            {
                id: 'ren1', title: 'T1', description: null, status: 'AVAILABLE',
                createdAt: '2026-01-01', users: { id: 'u1', fullName: 'A', avatarUrl: null },
                location: { id: 'l1', address: '1', district: 'Q1', city: 'HCM' },
                images: [],
            },
        ];
        mockPrisma.rental.count = async () => 1;
        const req = mockReq({ query: { page: '1', limit: '10' } });
        const res = mockRes();
        await controller.getRentals(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 1);
        assert.equal(res._json.pagination.total, 1);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.findMany = async () => { throw new Error('DB'); };
        mockPrisma.rental.count = async () => { throw new Error('DB'); };
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getRentals(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getRentalById
   ════════════════════════════════════════════ */
describe('rental.controller — getRentalById', () => {
    beforeEach(() => setup());

    it('should return rental detail', async () => {
        mockPrisma.rental.findUnique = async () => ({
            id: 'ren1', title: 'T1', description: 'D', status: 'AVAILABLE',
            createdAt: '2026-01-01',
            users: { id: 'u1', fullName: 'A', avatarUrl: null, email: 'a@x.com', phone: '123' },
            location: { id: 'l1', address: '1', district: 'Q1', city: 'HCM' },
            rooms: [], images: [],
        });
        const req = mockReq({ params: { rentalId: 'ren1' } });
        const res = mockRes();
        await controller.getRentalById(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.id, 'ren1');
    });

    it('should return 404', async () => {
        mockPrisma.rental.findUnique = async () => null;
        const req = mockReq({ params: { rentalId: 'bad' } });
        const res = mockRes();
        await controller.getRentalById(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.findUnique = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { rentalId: 'x' } });
        const res = mockRes();
        await controller.getRentalById(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getMyRentals
   ════════════════════════════════════════════ */
describe('rental.controller — getMyRentals', () => {
    beforeEach(() => setup());

    it('should return user own rentals', async () => {
        mockPrisma.rental.findMany = async () => [
            {
                id: 'ren1', title: 'My', description: null, status: 'PENDING',
                createdAt: '2026-01-01', users: null, location: null, images: [],
            },
        ];
        mockPrisma.rental.count = async () => 1;
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getMyRentals(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 1);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.findMany = async () => { throw new Error('DB'); };
        mockPrisma.rental.count = async () => { throw new Error('DB'); };
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getMyRentals(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   updateRentalStatus
   ════════════════════════════════════════════ */
describe('rental.controller — updateRentalStatus', () => {
    beforeEach(() => setup());

    it('should update status', async () => {
        mockPrisma.rental.findUnique = async () => ({ id: 'ren1', status: 'PENDING' });
        mockPrisma.rental.update = async () => ({
            id: 'ren1', title: 'T', status: 'AVAILABLE',
            location: { id: 'l1', address: '1', district: 'Q1', city: 'HCM' },
        });
        const req = mockReq({ params: { rentalId: 'ren1' }, body: { status: 'AVAILABLE' } });
        const res = mockRes();
        await controller.updateRentalStatus(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.status, 'AVAILABLE');
    });

    it('should return 400 on bad validation', async () => {
        const req = mockReq({ params: { rentalId: 'ren1' }, body: {} });
        const res = mockRes();
        await controller.updateRentalStatus(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404', async () => {
        mockPrisma.rental.findUnique = async () => null;
        const req = mockReq({ params: { rentalId: 'bad' }, body: { status: 'AVAILABLE' } });
        const res = mockRes();
        await controller.updateRentalStatus(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.findUnique = async () => ({ id: 'ren1' });
        mockPrisma.rental.update = async () => { throw new Error('DB'); };
        const req = mockReq({ params: { rentalId: 'ren1' }, body: { status: 'AVAILABLE' } });
        const res = mockRes();
        await controller.updateRentalStatus(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   getRentalStats
   ════════════════════════════════════════════ */
describe('rental.controller — getRentalStats', () => {
    beforeEach(() => setup());

    it('should return stats', async () => {
        mockPrisma.rental.count = async (args) => {
            if (!args) return 50;
            if (args.where?.status === 'AVAILABLE') return 30;
            if (args.where?.status === 'UNAVAILABLE') return 5;
            if (args.where?.status === 'HIDDEN') return 3;
            if (args.where?.status?.in) return 2;
            if (args.where?.createdAt) return 8;
            return 0;
        };
        const req = mockReq();
        const res = mockRes();
        await controller.getRentalStats(req, res);
        assert.equal(res._status, 200);
        assert.ok(res._json.data);
    });

    it('should return 500 on error', async () => {
        mockPrisma.rental.count = async () => { throw new Error('DB'); };
        const req = mockReq();
        const res = mockRes();
        await controller.getRentalStats(req, res);
        assert.equal(res._status, 500);
    });
});
