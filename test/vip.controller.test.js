const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, injectMock, clearModule } = require('./helpers');

const mockVipService = {
    getVipPackages: async () => ({ data: [] }),
    createVipPurchase: async () => ({ message: '', data: {} }),
    verifyVipPurchase: async () => ({ message: '', data: {} }),
};

function loadController() {
    clearModule('../controllers/vip.controller');
    injectMock('../services/vip.service', mockVipService);
    return require('../controllers/vip.controller');
}

describe('VIP controller', () => {
    it('should return active packages', async () => {
        mockVipService.getVipPackages = async ({ targetRole }) => ({
            data: [{ id: 'pkg-1', targetRole }],
        });

        const ctrl = loadController();
        const req = mockReq({ query: { targetRole: 'TENANT' } });
        const res = mockRes();
        await ctrl.getVipPackages(req, res);

        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data[0].targetRole, 'TENANT');
    });

    it('should create VIP purchase payment link', async () => {
        mockVipService.createVipPurchase = async () => ({
            message: 'ok',
            data: {
                payment: { orderCode: '123' },
            },
        });

        const ctrl = loadController();
        const req = mockReq({
            body: { packageId: 'pkg-1' },
            auth: { user: { id: 'u-1', role: 'TENANT' } },
        });
        const res = mockRes();
        await ctrl.createVipPurchase(req, res);

        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.payment.orderCode, '123');
    });

    it('should verify VIP purchase by orderCode', async () => {
        mockVipService.verifyVipPurchase = async (userId, orderCode) => ({
            message: 'verified',
            data: { confirmed: true, userId, orderCode },
        });

        const ctrl = loadController();
        const req = mockReq({
            query: { orderCode: 'abc' },
            auth: { user: { id: 'u-1' } },
        });
        const res = mockRes();
        await ctrl.verifyVipPurchase(req, res);

        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.confirmed, true);
        assert.equal(res._json.data.userId, 'u-1');
    });

    it('should return service statusCode on errors', async () => {
        mockVipService.createVipPurchase = async () => {
            throw Object.assign(new Error('bad input'), { statusCode: 400 });
        };

        const ctrl = loadController();
        const req = mockReq({
            body: {},
            auth: { user: { id: 'u-1', role: 'TENANT' } },
        });
        const res = mockRes();
        await ctrl.createVipPurchase(req, res);

        assert.equal(res._status, 400);
        assert.equal(res._json.success, false);
        assert.equal(res._json.message, 'bad input');
    });
});