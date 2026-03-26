const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();
const mockPayOSClient = {
    paymentRequests: {
        create: async () => ({ checkoutUrl: 'https://pay', paymentLinkId: 'pl-1', status: 'PENDING' }),
        get: async () => ({ status: 'PAID' }),
    },
};

function loadService() {
    clearModule('../services/vip.service');
    injectMock('../config/prisma', mockPrisma);
    injectMock('../config/payos', { getPayOSClient: () => mockPayOSClient });
    return require('../services/vip.service');
}

describe('VIP service', () => {
    beforeEach(() => {
        mockPrisma.vip_packages = {
            findMany: async () => [],
            findUnique: async () => null,
        };
        mockPrisma.payment_orders = {
            create: async ({ data }) => ({ id: 'po-1', ...data }),
            update: async ({ data }) => ({ id: 'po-1', ...data }),
            findUnique: async () => null,
            updateMany: async () => ({ count: 1 }),
        };
        mockPrisma.user_vip_purchases = {
            create: async ({ data }) => ({ id: 'uvp-1', ...data }),
        };
        mockPrisma.user = {
            findUnique: async () => ({
                id: 'u-1',
                role: 'TENANT',
                isVip: false,
                vip_role: null,
                vip_expires_at: null,
            }),
            update: async ({ data }) => ({ id: 'u-1', ...data }),
        };
        mockPrisma.notification = {
            create: async ({ data }) => ({ id: 'n-1', ...data }),
        };
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
    });

    it('should list active packages by role', async () => {
        mockPrisma.vip_packages.findMany = async ({ where }) => [{
            id: 'pkg-1',
            name: 'Tenant VIP',
            description: 'desc',
            duration_days: 30,
            price: 99000,
            target_role: where.target_role,
            is_active: true,
            created_at: new Date('2026-01-01T00:00:00Z'),
        }];

        const vipService = loadService();
        const result = await vipService.getVipPackages({ targetRole: 'tenant' });

        assert.equal(result.data.length, 1);
        assert.equal(result.data[0].targetRole, 'TENANT');
        assert.equal(result.data[0].price, 99000);
    });

    it('should create purchase link for matching role', async () => {
        mockPrisma.vip_packages.findUnique = async () => ({
            id: 'pkg-1',
            name: 'Tenant VIP',
            description: null,
            duration_days: 30,
            price: 99000,
            target_role: 'TENANT',
            is_active: true,
        });

        const vipService = loadService();
        const result = await vipService.createVipPurchase(
            { id: 'u-1', role: 'TENANT' },
            { packageId: 'pkg-1' }
        );

        assert.equal(result.data.package.id, 'pkg-1');
        assert.ok(result.data.payment.checkoutUrl);
    });

    it('should reject purchase when package role mismatch', async () => {
        mockPrisma.vip_packages.findUnique = async () => ({
            id: 'pkg-2',
            name: 'Landlord VIP',
            description: null,
            duration_days: 30,
            price: 199000,
            target_role: 'LANDLORD',
            is_active: true,
        });

        const vipService = loadService();
        await assert.rejects(
            () => vipService.createVipPurchase({ id: 'u-1', role: 'TENANT' }, { packageId: 'pkg-2' }),
            (err) => err.statusCode === 403
        );
    });

    it('should verify and activate vip purchase when paid', async () => {
        mockPrisma.payment_orders.findUnique = async () => ({
            id: 'po-1',
            user_id: 'u-1',
            purpose: 'VIP_PURCHASE',
            status: 'PENDING',
            ref_id: 'pkg-1',
        });

        mockPrisma.vip_packages.findUnique = async () => ({
            id: 'pkg-1',
            name: 'Tenant VIP',
            description: null,
            duration_days: 30,
            price: 99000,
            target_role: 'TENANT',
            is_active: true,
        });

        const vipService = loadService();
        const result = await vipService.verifyVipPurchase('u-1', '123456');

        assert.equal(result.data.confirmed, true);
        assert.equal(result.data.activated, true);
        assert.ok(result.data.vipExpiresAt);
    });
});