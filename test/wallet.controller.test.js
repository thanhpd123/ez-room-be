const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

/* ── Setup: inject mock prisma before requiring controller ── */
let mockPrisma;
let controller;

function setup() {
    mockPrisma = createMockPrisma();
    injectMock('../config/prisma', mockPrisma);
    clearModule('../controllers/wallet.controller');
    controller = require('../controllers/wallet.controller');
}

/* ════════════════════════════════════════════
   getMyWallet
   ════════════════════════════════════════════ */
describe('wallet.controller — getMyWallet', () => {
    beforeEach(() => setup());

    it('should return wallet for authenticated user', async () => {
        mockPrisma.wallet.findUnique = async () => ({
            id: 'w1', userId: 'user-1', balance: 500000, created_at: '2026-01-01',
        });
        const req = mockReq();
        const res = mockRes();
        await controller.getMyWallet(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.balance, 500000);
        assert.equal(res._json.data.currency, 'VND');
    });

    it('should auto-create wallet if not exists', async () => {
        mockPrisma.wallet.findUnique = async () => null;
        mockPrisma.wallet.create = async (args) => ({
            id: 'w-new', userId: args.data.userId, balance: 0, created_at: '2026-01-01',
        });
        const req = mockReq();
        const res = mockRes();
        await controller.getMyWallet(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.balance, 0);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.wallet.findUnique = async () => { throw new Error('DB fail'); };
        const req = mockReq();
        const res = mockRes();
        await controller.getMyWallet(req, res);
        assert.equal(res._status, 500);
        assert.equal(res._json.success, false);
    });
});

/* ════════════════════════════════════════════
   getMyWalletTransactions
   ════════════════════════════════════════════ */
describe('wallet.controller — getMyWalletTransactions', () => {
    beforeEach(() => setup());

    it('should return paginated transactions', async () => {
        mockPrisma.wallet.findUnique = async () => ({ id: 'w1', userId: 'user-1', balance: 0, created_at: '2026-01-01' });
        mockPrisma.walletTransaction.findMany = async () => [
            { id: 'tx1', walletId: 'w1', transaction_type: 'DEPOSIT', status: 'SUCCESS', amount: 100000, description: 'Nạp', createdAt: '2026-01-01' },
        ];
        mockPrisma.walletTransaction.count = async () => 1;
        const req = mockReq({ query: { page: '1', limit: '10' } });
        const res = mockRes();
        await controller.getMyWalletTransactions(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.equal(res._json.data.length, 1);
        assert.equal(res._json.pagination.total, 1);
    });

    it('should filter by type', async () => {
        mockPrisma.wallet.findUnique = async () => ({ id: 'w1', userId: 'user-1', balance: 0, created_at: '2026-01-01' });
        let capturedWhere = null;
        mockPrisma.walletTransaction.findMany = async (args) => { capturedWhere = args?.where; return []; };
        mockPrisma.walletTransaction.count = async () => 0;
        const req = mockReq({ query: { type: 'DEPOSIT' } });
        const res = mockRes();
        await controller.getMyWalletTransactions(req, res);
        assert.equal(res._status, 200);
        assert.equal(capturedWhere?.transaction_type, 'DEPOSIT');
    });

    it('should clamp page/limit to valid range', async () => {
        mockPrisma.wallet.findUnique = async () => ({ id: 'w1', userId: 'user-1', balance: 0, created_at: '2026-01-01' });
        mockPrisma.walletTransaction.findMany = async () => [];
        mockPrisma.walletTransaction.count = async () => 0;
        const req = mockReq({ query: { page: '-5', limit: '999' } });
        const res = mockRes();
        await controller.getMyWalletTransactions(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.pagination.page, 1);
        assert.equal(res._json.pagination.limit, 100); // max clamped
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.wallet.findUnique = async () => { throw new Error('DB fail'); };
        const req = mockReq({ query: {} });
        const res = mockRes();
        await controller.getMyWalletTransactions(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   depositToWallet
   ════════════════════════════════════════════ */
describe('wallet.controller — depositToWallet', () => {
    beforeEach(() => setup());

    it('should deposit successfully', async () => {
        mockPrisma.$transaction = async (fn) => {
            const tx = createMockPrisma();
            tx.wallet.findUnique = async () => ({ id: 'w1', userId: 'user-1', balance: 100000, created_at: '2026-01-01' });
            tx.wallet.update = async () => ({ id: 'w1', userId: 'user-1', balance: 200000, created_at: '2026-01-01' });
            tx.wallet.create = async () => ({ id: 'w1', userId: 'user-1', balance: 0, created_at: '2026-01-01' });
            tx.walletTransaction.create = async () => ({
                id: 'tx1', walletId: 'w1', transaction_type: 'DEPOSIT', status: 'SUCCESS', amount: 100000, description: 'Nạp', createdAt: '2026-01-01',
            });
            return fn(tx);
        };
        const req = mockReq({ body: { amount: 100000, description: 'Test nạp' } });
        const res = mockRes();
        await controller.depositToWallet(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.ok(res._json.data.wallet);
        assert.ok(res._json.data.transaction);
    });

    it('should reject invalid amount (0)', async () => {
        const req = mockReq({ body: { amount: 0 } });
        const res = mockRes();
        await controller.depositToWallet(req, res);
        assert.equal(res._status, 400);
        assert.equal(res._json.success, false);
    });

    it('should reject negative amount', async () => {
        const req = mockReq({ body: { amount: -5000 } });
        const res = mockRes();
        await controller.depositToWallet(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject non-numeric amount', async () => {
        const req = mockReq({ body: { amount: 'abc' } });
        const res = mockRes();
        await controller.depositToWallet(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject missing amount', async () => {
        const req = mockReq({ body: {} });
        const res = mockRes();
        await controller.depositToWallet(req, res);
        assert.equal(res._status, 400);
    });

    it('should handle DB transaction error', async () => {
        mockPrisma.$transaction = async () => { throw new Error('TX fail'); };
        const req = mockReq({ body: { amount: 50000 } });
        const res = mockRes();
        await controller.depositToWallet(req, res);
        assert.equal(res._status, 500);
    });
});

/* ════════════════════════════════════════════
   withdrawFromWallet
   ════════════════════════════════════════════ */
describe('wallet.controller — withdrawFromWallet', () => {
    beforeEach(() => setup());

    it('should withdraw successfully when balance sufficient', async () => {
        mockPrisma.$transaction = async (fn) => {
            const tx = createMockPrisma();
            tx.wallet.findUnique = async () => ({ id: 'w1', userId: 'user-1', balance: 500000, created_at: '2026-01-01' });
            tx.wallet.update = async () => ({ id: 'w1', userId: 'user-1', balance: 400000, created_at: '2026-01-01' });
            tx.wallet.create = async () => ({ id: 'w1', userId: 'user-1', balance: 0, created_at: '2026-01-01' });
            tx.walletTransaction.create = async () => ({
                id: 'tx2', walletId: 'w1', transaction_type: 'WITHDRAW', status: 'SUCCESS', amount: 100000, description: 'Rút', createdAt: '2026-01-01',
            });
            return fn(tx);
        };
        const req = mockReq({ body: { amount: 100000 } });
        const res = mockRes();
        await controller.withdrawFromWallet(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should reject when balance insufficient', async () => {
        const err = new Error('Số dư không đủ');
        err.statusCode = 400;
        mockPrisma.$transaction = async () => { throw err; };
        const req = mockReq({ body: { amount: 999999 } });
        const res = mockRes();
        await controller.withdrawFromWallet(req, res);
        assert.equal(res._status, 400);
        assert.equal(res._json.success, false);
    });

    it('should reject invalid amount', async () => {
        const req = mockReq({ body: { amount: 0 } });
        const res = mockRes();
        await controller.withdrawFromWallet(req, res);
        assert.equal(res._status, 400);
    });

    it('should reject negative amount', async () => {
        const req = mockReq({ body: { amount: -100 } });
        const res = mockRes();
        await controller.withdrawFromWallet(req, res);
        assert.equal(res._status, 400);
    });

    it('should handle server error', async () => {
        mockPrisma.$transaction = async () => { throw new Error('Server crash'); };
        const req = mockReq({ body: { amount: 10000 } });
        const res = mockRes();
        await controller.withdrawFromWallet(req, res);
        assert.equal(res._status, 500);
    });
});
