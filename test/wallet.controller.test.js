const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();
const mockPayOSClient = {
    paymentRequests: {
        create: async () => ({ checkoutUrl: 'https://pay', paymentLinkId: 'pl-1', status: 'PENDING' }),
        get: async () => ({ status: 'PAID' }),
    },
};

function loadController() {
    clearModule('../controllers/wallet.controller');
    clearModule('../services/wallet.service');
    injectMock('../config/prisma', mockPrisma);
    injectMock('../config/payos', { getPayOSClient: () => mockPayOSClient });
    return require('../controllers/wallet.controller');
}

const fakeWallet = { id: 'w-1', userId: 'user-1', balance: 1000000, created_at: new Date() };
const fakeTx = { id: 'tx-1', walletId: 'w-1', transaction_type: 'DEPOSIT', status: 'SUCCESS', amount: 500000, description: 'Test', createdAt: new Date() };

/* ================================================================
   getMyWallet
   ================================================================ */
describe('Wallet > getMyWallet', () => {
    beforeEach(() => {
        mockPrisma.wallet.findUnique = async () => fakeWallet;
        mockPrisma.wallet.upsert = async () => fakeWallet;
    });

    it('should return wallet for logged in user', async () => {
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getMyWallet(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.ok(res._json.data.balance !== undefined);
    });

    it('should auto-create wallet if not exists', async () => {
        mockPrisma.wallet.findUnique = async () => null;
        mockPrisma.wallet.upsert = async () => ({ ...fakeWallet, balance: 0 });
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getMyWallet(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.balance, 0);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.wallet.findUnique = async () => { throw new Error('db fail'); };
        mockPrisma.wallet.upsert = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq();
        const res = mockRes();
        await ctrl.getMyWallet(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getMyWalletTransactions
   ================================================================ */
describe('Wallet > getMyWalletTransactions', () => {
    beforeEach(() => {
        mockPrisma.wallet.findUnique = async () => fakeWallet;
        mockPrisma.wallet.upsert = async () => fakeWallet;
        mockPrisma.wallet.create = async () => fakeWallet;
        mockPrisma.walletTransaction.findMany = async () => [fakeTx];
        mockPrisma.walletTransaction.count = async () => 1;
    });

    it('should return paginated transactions', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: { page: '1', limit: '20' } });
        const res = mockRes();
        await ctrl.getMyWalletTransactions(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.data.length, 1);
        assert.ok(res._json.pagination);
    });

    it('should filter by type', async () => {
        let capturedWhere = null;
        mockPrisma.walletTransaction.findMany = async (args) => { capturedWhere = args?.where; return []; };
        mockPrisma.walletTransaction.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { type: 'DEPOSIT' } });
        const res = mockRes();
        await ctrl.getMyWalletTransactions(req, res);
        assert.equal(capturedWhere.transaction_type, 'DEPOSIT');
    });

    it('should clamp page and limit params', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: { page: '-5', limit: '999' } });
        const res = mockRes();
        await ctrl.getMyWalletTransactions(req, res);
        assert.equal(res._status, 200);
        assert.ok(res._json.pagination.limit <= 100);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.wallet.findUnique = async () => { throw new Error('db fail'); };
        mockPrisma.wallet.upsert = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getMyWalletTransactions(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   depositToWallet
   ================================================================ */
describe('Wallet > depositToWallet', () => {
    beforeEach(() => {
        mockPrisma.wallet.findUnique = async () => fakeWallet;
        mockPrisma.wallet.upsert = async () => fakeWallet;
        mockPrisma.wallet.create = async () => fakeWallet;
        mockPrisma.wallet.update = async () => ({ ...fakeWallet, balance: 1500000 });
        mockPrisma.payment_orders.create = async ({ data }) => ({ id: 'po-1', ...data });
        mockPrisma.payment_orders.update = async ({ data }) => ({ id: 'po-1', ...data });
        mockPrisma.walletTransaction.create = async () => fakeTx;
        mockPrisma.walletTransaction.update = async ({ data }) => ({ ...fakeTx, ...data });
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
    });

    it('should deposit successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { amount: 500000 } });
        const res = mockRes();
        await ctrl.depositToWallet(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should reject amount = 0', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { amount: 0 } });
        const res = mockRes();
        await ctrl.depositToWallet(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject negative amount', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { amount: -100 } });
        const res = mockRes();
        await ctrl.depositToWallet(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject NaN amount', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { amount: 'abc' } });
        const res = mockRes();
        await ctrl.depositToWallet(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject missing amount', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: {} });
        const res = mockRes();
        await ctrl.depositToWallet(req, res);
        assert.equal(res._status, 400);
    });

    it('should handle transaction error', async () => {
        mockPrisma.$transaction = async () => { throw new Error('tx fail'); };
        const ctrl = loadController();
        const req = mockReq({ body: { amount: 500000 } });
        const res = mockRes();
        await ctrl.depositToWallet(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   withdrawFromWallet
   ================================================================ */
describe('Wallet > withdrawFromWallet', () => {
    beforeEach(() => {
        mockPrisma.wallet.findUnique = async () => fakeWallet;
        mockPrisma.wallet.upsert = async () => fakeWallet;
        mockPrisma.wallet.create = async () => fakeWallet;
        mockPrisma.wallet.update = async () => ({ ...fakeWallet, balance: 500000 });
        mockPrisma.walletTransaction.create = async () => fakeTx;
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
    });

    it('should withdraw successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { amount: 500000 } });
        const res = mockRes();
        await ctrl.withdrawFromWallet(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should reject when insufficient balance', async () => {
        mockPrisma.wallet.findUnique = async () => ({ ...fakeWallet, balance: 100 });
        mockPrisma.wallet.upsert = async () => ({ ...fakeWallet, balance: 100 });
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
        const ctrl = loadController();
        const req = mockReq({ body: { amount: 500000 } });
        const res = mockRes();
        await ctrl.withdrawFromWallet(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject invalid amount', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { amount: 'abc' } });
        const res = mockRes();
        await ctrl.withdrawFromWallet(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject negative amount', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { amount: -100 } });
        const res = mockRes();
        await ctrl.withdrawFromWallet(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 500 on server error', async () => {
        mockPrisma.$transaction = async () => { throw new Error('server fail'); };
        const ctrl = loadController();
        const req = mockReq({ body: { amount: 500000 } });
        const res = mockRes();
        await ctrl.withdrawFromWallet(req, res);
        assert.equal(res._status, 500);
    });
});
