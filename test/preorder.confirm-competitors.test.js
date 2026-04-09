const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockPrisma, injectMock, clearModule } = require('./helpers');

/** Stateful mock for confirmRequest + competitor refunds */
function buildPreorderConfirmMock() {
    const state = {
        preorders: {
            p1: {
                id: 'p1',
                userId: 'u1',
                roomId: 'r1',
                status: 'PENDING',
                payment_status: 'PAID',
                deposit_amount: 3000000,
                commission_rate_bps: null,
                platform_fee_amount: null,
                landlord_payout_amount: null,
                payout_at: null,
            },
            p2: {
                id: 'p2',
                userId: 'u2',
                roomId: 'r1',
                status: 'PENDING',
                payment_status: 'PAID',
                deposit_amount: 2000000,
            },
        },
        wallets: {
            'landlord-1': { id: 'wl', userId: 'landlord-1', balance: 0 },
            u1: { id: 'w1', userId: 'u1', balance: 0 },
            u2: { id: 'w2', userId: 'u2', balance: 0 },
        },
        walletTxCreated: [],
        u2BalanceAfter: null,
    };

    const roomInclude = {
        room: { rentals: { owner_id: 'landlord-1' } },
    };

    function clonePreorder(id) {
        const p = state.preorders[id];
        return p ? { ...p, room: { ...roomInclude.room, id: 'r1' } } : null;
    }

    const mock = createMockPrisma();
    mock.systemSetting = { findUnique: async () => null };
    mock.platformLedgerEntry = {
        findFirst: async () => null,
        create: async () => ({}),
    };

    mock.$executeRaw = async () => 1;
    mock.$executeRawUnsafe = async () => 1;

    mock.preorder.findUnique = async ({ where: { id }, include }) => {
        const base = state.preorders[id];
        if (!base) return null;
        if (include?.room) {
            return {
                ...base,
                room: {
                    id: 'r1',
                    rentals: { owner_id: 'landlord-1' },
                },
            };
        }
        return { ...base };
    };

    mock.preorder.findMany = async ({ where }) => {
        if (where?.roomId === 'r1' && where?.status === 'PENDING' && where?.id?.not === 'p1') {
            return Object.values(state.preorders)
                .filter((p) => p.roomId === 'r1' && p.id !== 'p1' && p.status === 'PENDING')
                .map((p) => ({ id: p.id, payment_status: p.payment_status }));
        }
        return [];
    };

    mock.preorder.update = async ({ where: { id }, data }) => {
        if (state.preorders[id]) {
            state.preorders[id] = { ...state.preorders[id], ...data };
            return clonePreorder(id);
        }
        return null;
    };

    mock.wallet.findUnique = async ({ where: { userId } }) => state.wallets[userId] || null;
    mock.wallet.create = async ({ data: { userId, balance } }) => {
        const w = { id: `w-${userId}`, userId, balance: balance ?? 0 };
        state.wallets[userId] = w;
        return w;
    };
    mock.wallet.update = async ({ where: { id }, data }) => {
        const entry = Object.values(state.wallets).find((w) => w.id === id);
        if (entry && data.balance?.increment != null) {
            entry.balance += data.balance.increment;
            if (entry.userId === 'u2') state.u2BalanceAfter = entry.balance;
        }
        return entry;
    };

    mock.walletTransaction = {
        findFirst: async () => null,
        create: async ({ data }) => {
            state.walletTxCreated.push(data);
            return { id: 'tx-' + state.walletTxCreated.length, ...data };
        },
    };

    mock.payment_orders = {
        updateMany: async () => ({ count: 1 }),
    };

    mock.notification = {
        create: async () => ({}),
    };

    mock.$transaction = async (fn) => fn(mock);

    return { mock, state };
}

function loadPreorderService(mockPrisma) {
    clearModule('../services/preorder.service');
    injectMock('../config/prisma', mockPrisma);
    injectMock('../config/payos', {
        getPayOSClient: () => ({
            paymentRequests: {
                create: async () => ({}),
                get: async () => ({}),
            },
        }),
    });
    injectMock('../services/vip.service', {
        activateVipFromPaymentOrder: async () => {},
    });
    return require('../services/preorder.service');
}

describe('Preorder > confirmRequest refunds competing PAID preorders', () => {
    let mock;
    let state;
    let preorderService;

    beforeEach(() => {
        const built = buildPreorderConfirmMock();
        mock = built.mock;
        state = built.state;
        preorderService = loadPreorderService(mock);
    });

    it('should confirm winner and refund other tenant wallet', async () => {
        await preorderService.confirmRequest('p1', 'landlord-1');

        assert.equal(state.preorders.p1.status, 'CONFIRMED');
        assert.equal(state.preorders.p2.status, 'CANCELLED');
        assert.equal(state.preorders.p2.payment_status, 'REFUNDED');

        assert.equal(state.u2BalanceAfter, 2000000);

        const refundTx = state.walletTxCreated.find(
            (t) => t.transaction_type === 'REFUND' && t.ref_id === 'p2'
        );
        assert.ok(refundTx, 'expected REFUND wallet tx for loser preorder');
        assert.equal(refundTx.amount, 2000000);
    });

    it('should cancel unpaid competing preorders when confirming winner', async () => {
        state.preorders.p2 = {
            id: 'p2',
            userId: 'u2',
            roomId: 'r1',
            status: 'PENDING',
            payment_status: 'UNPAID',
            deposit_amount: 1500000,
        };

        await preorderService.confirmRequest('p1', 'landlord-1');

        assert.equal(state.preorders.p2.status, 'CANCELLED');
        assert.equal(state.preorders.p2.payment_status, 'UNPAID');
        const refundTx = state.walletTxCreated.find((t) => t.ref_id === 'p2');
        assert.equal(refundTx, undefined);
    });
});
