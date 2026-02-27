/**
 * =====================================================
 * UNIT TEST - Admin Controller
 * =====================================================
 * File: test/admin.controller.test.js
 * Mô tả: Test các chức năng quản trị admin
 *   - getAllUsers: Lấy danh sách users (phân trang, lọc, tìm kiếm)
 *   - getUserById: Lấy chi tiết 1 user
 *   - updateUserRole: Cập nhật role user
 *   - updateUserStatus: Cập nhật status user
 *   - getDashboardStats: Thống kê tổng quan
 *
 * Sử dụng: node:test + node:assert (built-in Node.js)
 * Chạy: node --test test/admin.controller.test.js
 * =====================================================
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma } = require('./helpers');

// =====================================================
// MOCK SETUP - Ghi đè prisma trước khi require controller
// =====================================================

let mockPrisma;

/**
 * Hàm load controller với mock prisma
 * Sử dụng require.cache injection để thay thế prisma thật bằng mock
 */
function loadController() {
    mockPrisma = createMockPrisma();

    // Xóa cache để require lại module mới
    const controllerPath = require.resolve('../controllers/admin.controller');
    const prismaPath = require.resolve('../config/prisma');
    delete require.cache[controllerPath];
    delete require.cache[prismaPath];

    // Inject mock prisma vào cache
    require.cache[prismaPath] = {
        id: prismaPath,
        filename: prismaPath,
        loaded: true,
        exports: mockPrisma,
    };

    return require('../controllers/admin.controller');
}

// =====================================================
// TEST: getAllUsers
// =====================================================
describe('Admin Controller - getAllUsers', () => {
    let controller;

    beforeEach(() => {
        controller = loadController();
    });

    it('nên trả về danh sách users với phân trang mặc định (page=1, limit=10)', async () => {
        // Arrange - Chuẩn bị dữ liệu giả
        const fakeUsers = [
            { id: '1', fullName: 'User 1', email: 'user1@test.com', role: 'TENANT', status: 'ACTIVE', createdAt: new Date() },
            { id: '2', fullName: 'User 2', email: 'user2@test.com', role: 'LANDLORD', status: 'ACTIVE', createdAt: new Date() },
        ];

        mockPrisma.user.findMany = async () => fakeUsers;
        mockPrisma.user.count = async () => 2;

        const req = mockReq({ query: {} });
        const res = mockRes();

        // Act - Gọi hàm
        await controller.getAllUsers(req, res);

        // Assert - Kiểm tra kết quả
        assert.equal(res.statusCode, 200);
        const body = res.body;
        assert.equal(body.success, true);
        assert.equal(body.data.length, 2);
        assert.equal(body.pagination.page, 1);
        assert.equal(body.pagination.limit, 10);
        assert.equal(body.pagination.total, 2);
        assert.equal(body.pagination.totalPages, 1);
    });

    it('nên áp dụng phân trang theo query (page=2, limit=5)', async () => {
        mockPrisma.user.findMany = async () => [];
        mockPrisma.user.count = async () => 12;

        const req = mockReq({ query: { page: '2', limit: '5' } });
        const res = mockRes();

        await controller.getAllUsers(req, res);

        assert.equal(res.body.pagination.page, 2);
        assert.equal(res.body.pagination.limit, 5);
        assert.equal(res.body.pagination.totalPages, 3); // Math.ceil(12/5)
    });

    it('nên lọc theo role hợp lệ', async () => {
        let capturedWhere = null;
        mockPrisma.user.findMany = async (args) => { capturedWhere = args.where; return []; };
        mockPrisma.user.count = async () => 0;

        const req = mockReq({ query: { role: 'tenant' } }); // lowercase
        const res = mockRes();

        await controller.getAllUsers(req, res);

        // Kiểm tra role được uppercase
        assert.equal(capturedWhere.role, 'TENANT');
    });

    it('nên bỏ qua role không hợp lệ', async () => {
        let capturedWhere = null;
        mockPrisma.user.findMany = async (args) => { capturedWhere = args.where; return []; };
        mockPrisma.user.count = async () => 0;

        const req = mockReq({ query: { role: 'INVALID_ROLE' } });
        const res = mockRes();

        await controller.getAllUsers(req, res);

        // Role không hợp lệ nên where.role không được set
        assert.equal(capturedWhere.role, undefined);
    });

    it('nên lọc theo status', async () => {
        let capturedWhere = null;
        mockPrisma.user.findMany = async (args) => { capturedWhere = args.where; return []; };
        mockPrisma.user.count = async () => 0;

        const req = mockReq({ query: { status: 'BANNED' } });
        const res = mockRes();

        await controller.getAllUsers(req, res);

        assert.equal(capturedWhere.status, 'BANNED');
    });

    it('nên tìm kiếm theo từ khóa (fullName, email, phone)', async () => {
        let capturedWhere = null;
        mockPrisma.user.findMany = async (args) => { capturedWhere = args.where; return []; };
        mockPrisma.user.count = async () => 0;

        const req = mockReq({ query: { search: 'nguyen' } });
        const res = mockRes();

        await controller.getAllUsers(req, res);

        // Kiểm tra search filter tạo điều kiện OR
        assert.ok(capturedWhere.OR);
        assert.equal(capturedWhere.OR.length, 3);
        // Kiểm tra tìm kiếm theo fullName
        assert.deepStrictEqual(capturedWhere.OR[0], {
            fullName: { contains: 'nguyen', mode: 'insensitive' },
        });
    });

    it('nên kết hợp nhiều filter cùng lúc (role + status + search)', async () => {
        let capturedWhere = null;
        mockPrisma.user.findMany = async (args) => { capturedWhere = args.where; return []; };
        mockPrisma.user.count = async () => 0;

        const req = mockReq({ query: { role: 'TENANT', status: 'ACTIVE', search: 'test' } });
        const res = mockRes();

        await controller.getAllUsers(req, res);

        assert.equal(capturedWhere.role, 'TENANT');
        assert.equal(capturedWhere.status, 'ACTIVE');
        assert.ok(capturedWhere.OR);
    });

    it('nên trả về 500 khi có lỗi database', async () => {
        mockPrisma.user.findMany = async () => { throw new Error('DB connection failed'); };
        mockPrisma.user.count = async () => 0;

        const req = mockReq({ query: {} });
        const res = mockRes();

        await controller.getAllUsers(req, res);

        assert.equal(res.statusCode, 500);
        assert.equal(res.body.success, false);
        assert.ok(res.body.message.includes('Lỗi'));
    });
});

// =====================================================
// TEST: getUserById
// =====================================================
describe('Admin Controller - getUserById', () => {
    let controller;

    beforeEach(() => {
        controller = loadController();
    });

    it('nên trả về thông tin user khi tìm thấy', async () => {
        const fakeUser = {
            id: 'user-1',
            fullName: 'Nguyễn Văn A',
            email: 'a@test.com',
            phone: '0901234567',
            avatarUrl: null,
            role: 'TENANT',
            status: 'ACTIVE',
            createdAt: new Date(),
            updated_at: new Date(),
        };

        mockPrisma.user.findUnique = async () => fakeUser;

        const req = mockReq({ params: { userId: 'user-1' } });
        const res = mockRes();

        await controller.getUserById(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.id, 'user-1');
        assert.equal(res.body.data.fullName, 'Nguyễn Văn A');
    });

    it('nên trả về 404 khi không tìm thấy user', async () => {
        mockPrisma.user.findUnique = async () => null;

        const req = mockReq({ params: { userId: 'nonexistent' } });
        const res = mockRes();

        await controller.getUserById(req, res);

        assert.equal(res.statusCode, 404);
        assert.equal(res.body.success, false);
        assert.ok(res.body.message.includes('Không tìm thấy'));
    });

    it('nên trả về 500 khi có lỗi database', async () => {
        mockPrisma.user.findUnique = async () => { throw new Error('DB error'); };

        const req = mockReq({ params: { userId: 'user-1' } });
        const res = mockRes();

        await controller.getUserById(req, res);

        assert.equal(res.statusCode, 500);
        assert.equal(res.body.success, false);
    });
});

// =====================================================
// TEST: updateUserRole
// =====================================================
describe('Admin Controller - updateUserRole', () => {
    let controller;

    beforeEach(() => {
        controller = loadController();
    });

    it('nên cập nhật role thành công', async () => {
        // Arrange
        const existingUser = { id: 'user-2', fullName: 'Trần B', email: 'b@test.com', role: 'TENANT' };
        const updatedUser = { id: 'user-2', fullName: 'Trần B', email: 'b@test.com', role: 'LANDLORD', status: 'ACTIVE' };

        mockPrisma.user.findUnique = async () => existingUser;
        mockPrisma.user.update = async () => updatedUser;

        const req = mockReq({
            params: { userId: 'user-2' },
            body: { role: 'LANDLORD' },
            auth: { user: { id: 'admin-1' } }, // Admin khác user đang cập nhật
        });
        const res = mockRes();

        // Act
        await controller.updateUserRole(req, res);

        // Assert
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.role, 'LANDLORD');
    });

    it('nên uppercase role khi nhận lowercase', async () => {
        const existingUser = { id: 'user-2', fullName: 'B', email: 'b@test.com', role: 'TENANT' };
        let capturedData = null;
        mockPrisma.user.findUnique = async () => existingUser;
        mockPrisma.user.update = async (args) => {
            capturedData = args.data;
            return { ...existingUser, ...args.data, status: 'ACTIVE' };
        };

        const req = mockReq({
            params: { userId: 'user-2' },
            body: { role: 'moderator' }, // lowercase
            auth: { user: { id: 'admin-1' } },
        });
        const res = mockRes();

        await controller.updateUserRole(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(capturedData.role, 'MODERATOR');
    });

    it('nên trả về 400 khi role không hợp lệ', async () => {
        const req = mockReq({
            params: { userId: 'user-2' },
            body: { role: 'SUPER_ADMIN' }, // Role không tồn tại
            auth: { user: { id: 'admin-1' } },
        });
        const res = mockRes();

        await controller.updateUserRole(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
        assert.ok(res.body.message.includes('Role không hợp lệ'));
    });

    it('nên trả về 400 khi không gửi role', async () => {
        const req = mockReq({
            params: { userId: 'user-2' },
            body: {}, // Không có role
            auth: { user: { id: 'admin-1' } },
        });
        const res = mockRes();

        await controller.updateUserRole(req, res);

        assert.equal(res.statusCode, 400);
    });

    it('nên từ chối khi admin tự thay đổi role chính mình', async () => {
        const req = mockReq({
            params: { userId: 'admin-1' },
            body: { role: 'TENANT' },
            auth: { user: { id: 'admin-1' } }, // Cùng ID → tự thay đổi
        });
        const res = mockRes();

        await controller.updateUserRole(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.success, false);
        assert.ok(res.body.message.includes('chính mình'));
    });

    it('nên từ chối khi thay đổi role của ADMIN khác', async () => {
        // User cần cập nhật có role = ADMIN → bảo vệ admin
        const existingAdmin = { id: 'admin-2', fullName: 'Admin 2', email: 'admin2@test.com', role: 'ADMIN' };
        mockPrisma.user.findUnique = async () => existingAdmin;

        const req = mockReq({
            params: { userId: 'admin-2' },
            body: { role: 'TENANT' },
            auth: { user: { id: 'admin-1' } },
        });
        const res = mockRes();

        await controller.updateUserRole(req, res);

        assert.equal(res.statusCode, 403);
        assert.ok(res.body.message.includes('Admin'));
    });

    it('nên trả về 404 khi user không tồn tại', async () => {
        mockPrisma.user.findUnique = async () => null;

        const req = mockReq({
            params: { userId: 'nonexistent' },
            body: { role: 'TENANT' },
            auth: { user: { id: 'admin-1' } },
        });
        const res = mockRes();

        await controller.updateUserRole(req, res);

        assert.equal(res.statusCode, 404);
        assert.equal(res.body.success, false);
    });

    it('nên trả về 500 khi có lỗi database khi update', async () => {
        const existingUser = { id: 'user-2', fullName: 'B', email: 'b@test.com', role: 'TENANT' };
        mockPrisma.user.findUnique = async () => existingUser;
        mockPrisma.user.update = async () => { throw new Error('DB write error'); };

        const req = mockReq({
            params: { userId: 'user-2' },
            body: { role: 'LANDLORD' },
            auth: { user: { id: 'admin-1' } },
        });
        const res = mockRes();

        await controller.updateUserRole(req, res);

        assert.equal(res.statusCode, 500);
    });
});

// =====================================================
// TEST: updateUserStatus
// =====================================================
describe('Admin Controller - updateUserStatus', () => {
    let controller;

    beforeEach(() => {
        controller = loadController();
    });

    it('nên cập nhật status thành công', async () => {
        const existingUser = { id: 'user-2', fullName: 'Trần B', role: 'TENANT' };
        const updatedUser = { id: 'user-2', fullName: 'Trần B', email: 'b@test.com', role: 'TENANT', status: 'SUSPENDED' };

        mockPrisma.user.findUnique = async () => existingUser;
        mockPrisma.user.update = async () => updatedUser;

        const req = mockReq({
            params: { userId: 'user-2' },
            body: { status: 'SUSPENDED' },
            auth: { user: { id: 'admin-1' } },
        });
        const res = mockRes();

        await controller.updateUserStatus(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.status, 'SUSPENDED');
    });

    it('nên trả về 400 khi status không hợp lệ', async () => {
        const req = mockReq({
            params: { userId: 'user-2' },
            body: { status: 'DELETED' }, // Status không tồn tại
            auth: { user: { id: 'admin-1' } },
        });
        const res = mockRes();

        await controller.updateUserStatus(req, res);

        assert.equal(res.statusCode, 400);
        assert.ok(res.body.message.includes('Status không hợp lệ'));
    });

    it('nên trả về 400 khi không gửi status', async () => {
        const req = mockReq({
            params: { userId: 'user-2' },
            body: {},
            auth: { user: { id: 'admin-1' } },
        });
        const res = mockRes();

        await controller.updateUserStatus(req, res);

        assert.equal(res.statusCode, 400);
    });

    it('nên uppercase status khi nhận lowercase', async () => {
        const existingUser = { id: 'user-2', fullName: 'B', role: 'TENANT' };
        let capturedData = null;
        mockPrisma.user.findUnique = async () => existingUser;
        mockPrisma.user.update = async (args) => {
            capturedData = args.data;
            return { id: 'user-2', fullName: 'B', email: 'b@test.com', role: 'TENANT', status: args.data.status };
        };

        const req = mockReq({
            params: { userId: 'user-2' },
            body: { status: 'banned' }, // lowercase
            auth: { user: { id: 'admin-1' } },
        });
        const res = mockRes();

        await controller.updateUserStatus(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(capturedData.status, 'BANNED');
    });

    it('nên từ chối khi admin tự thay đổi status chính mình', async () => {
        const req = mockReq({
            params: { userId: 'admin-1' },
            body: { status: 'BANNED' },
            auth: { user: { id: 'admin-1' } }, // Cùng ID
        });
        const res = mockRes();

        await controller.updateUserStatus(req, res);

        assert.equal(res.statusCode, 403);
        assert.ok(res.body.message.includes('chính mình'));
    });

    it('nên từ chối khi thay đổi status của ADMIN khác', async () => {
        const existingAdmin = { id: 'admin-2', fullName: 'Admin 2', role: 'ADMIN' };
        mockPrisma.user.findUnique = async () => existingAdmin;

        const req = mockReq({
            params: { userId: 'admin-2' },
            body: { status: 'BANNED' },
            auth: { user: { id: 'admin-1' } },
        });
        const res = mockRes();

        await controller.updateUserStatus(req, res);

        assert.equal(res.statusCode, 403);
        assert.ok(res.body.message.includes('Admin'));
    });

    it('nên trả về 404 khi user không tồn tại', async () => {
        mockPrisma.user.findUnique = async () => null;

        const req = mockReq({
            params: { userId: 'nonexistent' },
            body: { status: 'ACTIVE' },
            auth: { user: { id: 'admin-1' } },
        });
        const res = mockRes();

        await controller.updateUserStatus(req, res);

        assert.equal(res.statusCode, 404);
    });

    it('nên test tất cả status hợp lệ: ACTIVE, INACTIVE, SUSPENDED, BANNED', async () => {
        const validStatuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'BANNED'];

        for (const status of validStatuses) {
            controller = loadController(); // Reload để reset mock
            const existingUser = { id: 'user-2', fullName: 'B', role: 'TENANT' };
            mockPrisma.user.findUnique = async () => existingUser;
            mockPrisma.user.update = async () => ({
                id: 'user-2', fullName: 'B', email: 'b@test.com', role: 'TENANT', status,
            });

            const req = mockReq({
                params: { userId: 'user-2' },
                body: { status },
                auth: { user: { id: 'admin-1' } },
            });
            const res = mockRes();

            await controller.updateUserStatus(req, res);
            assert.equal(res.statusCode, 200, `Status ${status} nên được chấp nhận`);
        }
    });
});

// =====================================================
// TEST: getDashboardStats
// =====================================================
describe('Admin Controller - getDashboardStats', () => {
    let controller;

    beforeEach(() => {
        controller = loadController();
    });

    it('nên trả về thống kê tổng quan đúng cấu trúc', async () => {
        // Giả lập 7 lần gọi prisma.user.count() (theo thứ tự trong Promise.all)
        let callCount = 0;
        const countResults = [100, 2, 30, 50, 5, 80, 3];
        mockPrisma.user.count = async () => {
            return countResults[callCount++] || 0;
        };

        const req = mockReq();
        const res = mockRes();

        await controller.getDashboardStats(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);

        const stats = res.body.data.users;
        assert.equal(stats.total, 100);          // totalUsers
        assert.equal(stats.byRole.admins, 2);    // totalAdmins
        assert.equal(stats.byRole.landlords, 30); // totalLandlords
        assert.equal(stats.byRole.tenants, 50);  // totalTenants
        assert.equal(stats.byRole.moderators, 5); // totalModerators
        assert.equal(stats.byStatus.active, 80);  // activeUsers
        assert.equal(stats.byStatus.banned, 3);   // bannedUsers
    });

    it('nên trả về 0 khi không có dữ liệu', async () => {
        mockPrisma.user.count = async () => 0;

        const req = mockReq();
        const res = mockRes();

        await controller.getDashboardStats(req, res);

        assert.equal(res.statusCode, 200);
        const stats = res.body.data.users;
        assert.equal(stats.total, 0);
        assert.equal(stats.byRole.admins, 0);
    });

    it('nên trả về 500 khi có lỗi database', async () => {
        mockPrisma.user.count = async () => { throw new Error('DB timeout'); };

        const req = mockReq();
        const res = mockRes();

        await controller.getDashboardStats(req, res);

        assert.equal(res.statusCode, 500);
        assert.equal(res.body.success, false);
        assert.ok(res.body.message.includes('Lỗi'));
    });
});
