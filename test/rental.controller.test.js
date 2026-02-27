/**
 * =====================================================
 * UNIT TEST - Rental Controller
 * =====================================================
 * File: test/rental.controller.test.js
 * Mô tả: Test các chức năng quản lý bài đăng cho thuê
 *   - createRental: Tạo bài đăng mới (LANDLORD)
 *   - getRentals: Lấy danh sách (phân trang, filter, search)
 *   - getRentalById: Lấy chi tiết 1 bài đăng
 *   - getMyRentals: Lấy danh sách bài đăng của user đang đăng nhập
 *   - updateRentalStatus: Cập nhật trạng thái bài đăng (Moderator/Admin)
 *
 * Sử dụng: node:test + node:assert (built-in Node.js)
 * Chạy: node --test test/rental.controller.test.js
 * =====================================================
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma } = require('./helpers');

// =====================================================
// MOCK SETUP
// =====================================================

let mockPrisma;

/**
 * Hàm load controller với mock prisma + validator
 * Inject mock prisma vào require.cache trước khi require controller
 */
function loadController() {
    mockPrisma = createMockPrisma();

    // Xóa cache các module liên quan
    const controllerPath = require.resolve('../controllers/rental.controller');
    const prismaPath = require.resolve('../config/prisma');
    const validatorPath = require.resolve('../validators/rental.validator');
    delete require.cache[controllerPath];
    delete require.cache[prismaPath];

    // Inject mock prisma
    require.cache[prismaPath] = {
        id: prismaPath,
        filename: prismaPath,
        loaded: true,
        exports: mockPrisma,
    };

    // Validator dùng module thật - không cần mock
    // (validator chỉ validate dữ liệu, không gọi DB)

    return require('../controllers/rental.controller');
}

// =====================================================
// TEST: createRental
// =====================================================
describe('Rental Controller - createRental', () => {
    let controller;

    beforeEach(() => {
        controller = loadController();
    });

    it('nên tạo rental thành công khi location đã tồn tại', async () => {
        // Arrange - Location đã có sẵn trong DB
        const existingLocation = { id: 'loc-1', address: '123 ABC', district: 'Q1', city: 'HCM' };
        const createdRental = {
            id: 'rental-1',
            title: 'Phòng trọ đẹp Q1',
            description: 'Phòng rộng rãi',
            status: 'PENDING',
            createdAt: new Date(),
            location: existingLocation,
            images: [],
        };

        mockPrisma.location.findFirst = async () => existingLocation;
        mockPrisma.rental.create = async () => createdRental;

        const req = mockReq({
            body: {
                title: 'Phòng trọ đẹp Q1',
                description: 'Phòng rộng rãi',
                city: 'HCM',
                district: 'Q1',
                address: '123 ABC',
            },
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        // Act
        await controller.createRental(req, res);

        // Assert
        assert.equal(res.statusCode, 201);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.title, 'Phòng trọ đẹp Q1');
        assert.equal(res.body.data.status, 'PENDING');
        assert.ok(res.body.message.includes('thành công'));
    });

    it('nên tạo location mới khi chưa tồn tại', async () => {
        // Location chưa có → tạo mới
        const newLocation = { id: 'loc-new', address: '456 XYZ', district: 'Q2', city: 'HCM' };
        let locationCreated = false;

        mockPrisma.location.findFirst = async () => null; // Chưa tồn tại
        mockPrisma.location.create = async () => {
            locationCreated = true;
            return newLocation;
        };
        mockPrisma.rental.create = async () => ({
            id: 'rental-2',
            title: 'Test',
            description: null,
            status: 'PENDING',
            createdAt: new Date(),
            location: newLocation,
            images: [],
        });

        const req = mockReq({
            body: {
                title: 'Test',
                city: 'HCM',
                district: 'Q2',
                address: '456 XYZ',
            },
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.createRental(req, res);

        assert.equal(res.statusCode, 201);
        assert.equal(locationCreated, true); // Đảm bảo location.create được gọi
    });

    it('nên tạo rental kèm hình ảnh', async () => {
        const location = { id: 'loc-1', address: 'A', district: 'B', city: 'C' };
        let capturedCreateArgs = null;

        mockPrisma.location.findFirst = async () => location;
        mockPrisma.rental.create = async (args) => {
            capturedCreateArgs = args;
            return {
                id: 'rental-3',
                title: 'Test',
                description: null,
                status: 'PENDING',
                createdAt: new Date(),
                location,
                images: [
                    { imageUrl: 'https://img1.jpg' },
                    { imageUrl: 'https://img2.jpg' },
                ],
            };
        };

        const req = mockReq({
            body: {
                title: 'Test',
                city: 'C',
                district: 'B',
                address: 'A',
                images: ['https://img1.jpg', 'https://img2.jpg'],
            },
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.createRental(req, res);

        assert.equal(res.statusCode, 201);
        // Kiểm tra images được tạo trong rental.create
        assert.ok(capturedCreateArgs.data.images);
        assert.equal(capturedCreateArgs.data.images.create.length, 2);
        // Response trả về danh sách URL
        assert.deepStrictEqual(res.body.data.images, ['https://img1.jpg', 'https://img2.jpg']);
    });

    it('nên trả về 400 khi thiếu title', async () => {
        const req = mockReq({
            body: {
                // Thiếu title
                city: 'HCM',
                district: 'Q1',
                address: '123',
            },
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.createRental(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
    });

    it('nên trả về 400 khi thiếu city', async () => {
        const req = mockReq({
            body: {
                title: 'Test room',
                // Thiếu city
                district: 'Q1',
                address: '123',
            },
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.createRental(req, res);

        assert.equal(res.statusCode, 400);
    });

    it('nên trả về 400 khi thiếu district', async () => {
        const req = mockReq({
            body: {
                title: 'Test room',
                city: 'HCM',
                // Thiếu district
                address: '123',
            },
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.createRental(req, res);

        assert.equal(res.statusCode, 400);
    });

    it('nên trả về 400 khi thiếu address', async () => {
        const req = mockReq({
            body: {
                title: 'Test room',
                city: 'HCM',
                district: 'Q1',
                // Thiếu address
            },
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.createRental(req, res);

        assert.equal(res.statusCode, 400);
    });

    it('nên trim dữ liệu title, description, address, district, city', async () => {
        let capturedCreateArgs = null;
        const location = { id: 'loc-1', address: 'test', district: 'Q1', city: 'HCM' };

        mockPrisma.location.findFirst = async () => null;
        mockPrisma.location.create = async () => location;
        mockPrisma.rental.create = async (args) => {
            capturedCreateArgs = args;
            return {
                id: 'r-1', title: 'Test', description: 'Mô tả', status: 'PENDING',
                createdAt: new Date(), location, images: [],
            };
        };

        const req = mockReq({
            body: {
                title: '  Phòng trọ  ',
                description: '  Mô tả  ',
                city: '  HCM  ',
                district: '  Q1  ',
                address: '  test  ',
            },
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.createRental(req, res);

        assert.equal(res.statusCode, 201);
        // Controller trim title & description
        assert.equal(capturedCreateArgs.data.title, 'Phòng trọ');
        assert.equal(capturedCreateArgs.data.description, 'Mô tả');
    });

    it('nên set description = null khi không gửi', async () => {
        let capturedCreateArgs = null;
        const location = { id: 'loc-1', address: 'A', district: 'B', city: 'C' };

        mockPrisma.location.findFirst = async () => location;
        mockPrisma.rental.create = async (args) => {
            capturedCreateArgs = args;
            return {
                id: 'r-1', title: 'Test', description: null, status: 'PENDING',
                createdAt: new Date(), location, images: [],
            };
        };

        const req = mockReq({
            body: { title: 'Test', city: 'C', district: 'B', address: 'A' },
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.createRental(req, res);

        assert.equal(capturedCreateArgs.data.description, null);
    });

    it('nên trả về 500 khi có lỗi database', async () => {
        mockPrisma.location.findFirst = async () => { throw new Error('DB error'); };

        const req = mockReq({
            body: { title: 'Test', city: 'C', district: 'B', address: 'A' },
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.createRental(req, res);

        assert.equal(res.statusCode, 500);
        assert.equal(res.body.success, false);
    });
});

// =====================================================
// TEST: getRentals
// =====================================================
describe('Rental Controller - getRentals', () => {
    let controller;

    beforeEach(() => {
        controller = loadController();
    });

    it('nên trả về danh sách rentals với phân trang mặc định', async () => {
        const fakeRentals = [
            {
                id: 'r-1', title: 'Phòng 1', description: 'Desc', status: 'AVAILABLE',
                createdAt: new Date(),
                users: { id: 'u-1', fullName: 'Owner', avatarUrl: null },
                location: { id: 'l-1', address: '123', district: 'Q1', city: 'HCM' },
                images: [{ imageUrl: 'img1.jpg' }],
            },
        ];

        mockPrisma.rental.findMany = async () => fakeRentals;
        mockPrisma.rental.count = async () => 1;

        const req = mockReq({ query: {} });
        const res = mockRes();

        await controller.getRentals(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.length, 1);
        assert.equal(res.body.data[0].id, 'r-1');
        assert.equal(res.body.data[0].owner.fullName, 'Owner');
        assert.deepStrictEqual(res.body.data[0].images, ['img1.jpg']);
        assert.equal(res.body.pagination.page, 1);
        assert.equal(res.body.pagination.limit, 10);
    });

    it('nên xử lý phân trang đúng', async () => {
        mockPrisma.rental.findMany = async () => [];
        mockPrisma.rental.count = async () => 25;

        const req = mockReq({ query: { page: '3', limit: '5' } });
        const res = mockRes();

        await controller.getRentals(req, res);

        assert.equal(res.body.pagination.page, 3);
        assert.equal(res.body.pagination.limit, 5);
        assert.equal(res.body.pagination.total, 25);
        assert.equal(res.body.pagination.totalPages, 5);
    });

    it('nên lọc theo status', async () => {
        let capturedWhere = null;
        mockPrisma.rental.findMany = async (args) => { capturedWhere = args.where; return []; };
        mockPrisma.rental.count = async () => 0;

        const req = mockReq({ query: { status: 'AVAILABLE' } });
        const res = mockRes();

        await controller.getRentals(req, res);

        assert.equal(capturedWhere.status, 'AVAILABLE');
    });

    it('nên lọc theo owner_id', async () => {
        let capturedWhere = null;
        mockPrisma.rental.findMany = async (args) => { capturedWhere = args.where; return []; };
        mockPrisma.rental.count = async () => 0;

        const req = mockReq({ query: { owner_id: 'landlord-1' } });
        const res = mockRes();

        await controller.getRentals(req, res);

        assert.equal(capturedWhere.owner_id, 'landlord-1');
    });

    it('nên tìm kiếm theo title (case insensitive)', async () => {
        let capturedWhere = null;
        mockPrisma.rental.findMany = async (args) => { capturedWhere = args.where; return []; };
        mockPrisma.rental.count = async () => 0;

        const req = mockReq({ query: { search: 'phòng trọ' } });
        const res = mockRes();

        await controller.getRentals(req, res);

        assert.deepStrictEqual(capturedWhere.title, {
            contains: 'phòng trọ',
            mode: 'insensitive',
        });
    });

    it('nên xử lý rental không có owner (users = null)', async () => {
        const fakeRentals = [{
            id: 'r-1', title: 'Test', description: null, status: 'PENDING',
            createdAt: new Date(),
            users: null, // Không có owner
            location: null, // Không có location
            images: [],
        }];

        mockPrisma.rental.findMany = async () => fakeRentals;
        mockPrisma.rental.count = async () => 1;

        const req = mockReq({ query: {} });
        const res = mockRes();

        await controller.getRentals(req, res);

        assert.equal(res.body.data[0].owner, null);
        assert.equal(res.body.data[0].location, null);
    });

    it('nên trả về 500 khi có lỗi database', async () => {
        mockPrisma.rental.findMany = async () => { throw new Error('DB timeout'); };

        const req = mockReq({ query: {} });
        const res = mockRes();

        await controller.getRentals(req, res);

        assert.equal(res.statusCode, 500);
        assert.equal(res.body.success, false);
    });
});

// =====================================================
// TEST: getRentalById
// =====================================================
describe('Rental Controller - getRentalById', () => {
    let controller;

    beforeEach(() => {
        controller = loadController();
    });

    it('nên trả về chi tiết rental khi tìm thấy', async () => {
        const fakeRental = {
            id: 'r-1',
            title: 'Phòng đẹp',
            description: 'Rộng rãi',
            status: 'AVAILABLE',
            createdAt: new Date(),
            users: {
                id: 'u-1', fullName: 'Chủ nhà', avatarUrl: null,
                email: 'owner@test.com', phone: '0901234567',
            },
            location: { id: 'l-1', address: '123', district: 'Q1', city: 'HCM' },
            rooms: [{ id: 'room-1', name: 'Room A' }],
            images: [{ imageUrl: 'img1.jpg' }, { imageUrl: 'img2.jpg' }],
        };

        mockPrisma.rental.findUnique = async () => fakeRental;

        const req = mockReq({ params: { rentalId: 'r-1' } });
        const res = mockRes();

        await controller.getRentalById(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.id, 'r-1');
        assert.equal(res.body.data.owner.fullName, 'Chủ nhà');
        assert.equal(res.body.data.owner.email, 'owner@test.com');
        assert.equal(res.body.data.rooms.length, 1);
        assert.deepStrictEqual(res.body.data.images, ['img1.jpg', 'img2.jpg']);
    });

    it('nên trả về 404 khi không tìm thấy rental', async () => {
        mockPrisma.rental.findUnique = async () => null;

        const req = mockReq({ params: { rentalId: 'nonexistent' } });
        const res = mockRes();

        await controller.getRentalById(req, res);

        assert.equal(res.statusCode, 404);
        assert.equal(res.body.success, false);
        assert.ok(res.body.message.includes('Không tìm thấy'));
    });

    it('nên xử lý rental không có owner, location, rooms', async () => {
        const fakeRental = {
            id: 'r-1', title: 'Test', description: null, status: 'PENDING',
            createdAt: new Date(),
            users: null,
            location: null,
            rooms: null,
            images: [],
        };

        mockPrisma.rental.findUnique = async () => fakeRental;

        const req = mockReq({ params: { rentalId: 'r-1' } });
        const res = mockRes();

        await controller.getRentalById(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.owner, null);
        assert.equal(res.body.data.location, null);
    });

    it('nên trả về 500 khi có lỗi database', async () => {
        mockPrisma.rental.findUnique = async () => { throw new Error('DB error'); };

        const req = mockReq({ params: { rentalId: 'r-1' } });
        const res = mockRes();

        await controller.getRentalById(req, res);

        assert.equal(res.statusCode, 500);
    });
});

// =====================================================
// TEST: getMyRentals
// =====================================================
describe('Rental Controller - getMyRentals', () => {
    let controller;

    beforeEach(() => {
        controller = loadController();
    });

    it('nên trả về rentals của user đang đăng nhập', async () => {
        const fakeRentals = [
            {
                id: 'r-1', title: 'Phòng của tôi', description: null, status: 'AVAILABLE',
                createdAt: new Date(),
                location: { id: 'l-1', address: '123', district: 'Q1', city: 'HCM' },
                images: [],
            },
        ];

        let capturedWhere = null;
        mockPrisma.rental.findMany = async (args) => { capturedWhere = args.where; return fakeRentals; };
        mockPrisma.rental.count = async () => 1;

        const req = mockReq({
            query: {},
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.getMyRentals(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        // Kiểm tra filter theo owner_id = user đang đăng nhập
        assert.equal(capturedWhere.owner_id, 'landlord-1');
        assert.equal(res.body.data.length, 1);
    });

    it('nên lọc theo status kết hợp với owner_id', async () => {
        let capturedWhere = null;
        mockPrisma.rental.findMany = async (args) => { capturedWhere = args.where; return []; };
        mockPrisma.rental.count = async () => 0;

        const req = mockReq({
            query: { status: 'PENDING' },
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.getMyRentals(req, res);

        assert.equal(capturedWhere.owner_id, 'landlord-1');
        assert.equal(capturedWhere.status, 'PENDING');
    });

    it('nên phân trang đúng', async () => {
        mockPrisma.rental.findMany = async () => [];
        mockPrisma.rental.count = async () => 15;

        const req = mockReq({
            query: { page: '2', limit: '5' },
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.getMyRentals(req, res);

        assert.equal(res.body.pagination.page, 2);
        assert.equal(res.body.pagination.limit, 5);
        assert.equal(res.body.pagination.total, 15);
        assert.equal(res.body.pagination.totalPages, 3);
    });

    it('nên trả về danh sách rỗng khi user chưa có rental nào', async () => {
        mockPrisma.rental.findMany = async () => [];
        mockPrisma.rental.count = async () => 0;

        const req = mockReq({
            query: {},
            auth: { user: { id: 'new-landlord' } },
        });
        const res = mockRes();

        await controller.getMyRentals(req, res);

        assert.equal(res.body.data.length, 0);
        assert.equal(res.body.pagination.total, 0);
    });

    it('nên trả về 500 khi có lỗi database', async () => {
        mockPrisma.rental.findMany = async () => { throw new Error('DB error'); };

        const req = mockReq({
            query: {},
            auth: { user: { id: 'landlord-1' } },
        });
        const res = mockRes();

        await controller.getMyRentals(req, res);

        assert.equal(res.statusCode, 500);
        assert.equal(res.body.success, false);
    });
});

// =====================================================
// TEST: updateRentalStatus
// =====================================================
describe('Rental Controller - updateRentalStatus', () => {
    let controller;

    beforeEach(() => {
        controller = loadController();
    });

    it('nên cập nhật status rental thành công', async () => {
        const existingRental = { id: 'r-1', title: 'Test', status: 'PENDING' };
        const updatedRental = {
            id: 'r-1', title: 'Test', status: 'AVAILABLE',
            location: { id: 'l-1', address: '123', district: 'Q1', city: 'HCM' },
        };

        mockPrisma.rental.findUnique = async () => existingRental;
        mockPrisma.rental.update = async () => updatedRental;

        const req = mockReq({
            params: { rentalId: 'r-1' },
            body: { status: 'AVAILABLE' },
        });
        const res = mockRes();

        await controller.updateRentalStatus(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.data.status, 'AVAILABLE');
        assert.ok(res.body.message.includes('AVAILABLE'));
    });

    it('nên trả về 400 khi status không hợp lệ', async () => {
        const req = mockReq({
            params: { rentalId: 'r-1' },
            body: { status: 'INVALID_STATUS' },
        });
        const res = mockRes();

        await controller.updateRentalStatus(req, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.success, false);
    });

    it('nên trả về 400 khi không gửi status', async () => {
        const req = mockReq({
            params: { rentalId: 'r-1' },
            body: {},
        });
        const res = mockRes();

        await controller.updateRentalStatus(req, res);

        assert.equal(res.statusCode, 400);
    });

    it('nên trả về 404 khi rental không tồn tại', async () => {
        mockPrisma.rental.findUnique = async () => null;

        const req = mockReq({
            params: { rentalId: 'nonexistent' },
            body: { status: 'AVAILABLE' },
        });
        const res = mockRes();

        await controller.updateRentalStatus(req, res);

        assert.equal(res.statusCode, 404);
        assert.equal(res.body.success, false);
        assert.ok(res.body.message.includes('Không tìm thấy'));
    });

    it('nên test các status hợp lệ: PENDING, AVAILABLE, HIDDEN, RENTED', async () => {
        const validStatuses = ['PENDING', 'AVAILABLE', 'HIDDEN', 'RENTED'];

        for (const status of validStatuses) {
            controller = loadController(); // Reload mỗi lần
            const existingRental = { id: 'r-1', title: 'T', status: 'PENDING' };
            mockPrisma.rental.findUnique = async () => existingRental;
            mockPrisma.rental.update = async () => ({
                id: 'r-1', title: 'T', status,
                location: { id: 'l-1', address: 'A', district: 'B', city: 'C' },
            });

            const req = mockReq({
                params: { rentalId: 'r-1' },
                body: { status },
            });
            const res = mockRes();

            await controller.updateRentalStatus(req, res);
            assert.equal(res.statusCode, 200, `Status ${status} nên được chấp nhận`);
        }
    });

    it('nên xử lý rental không có location (null)', async () => {
        const existingRental = { id: 'r-1', title: 'T', status: 'PENDING' };
        mockPrisma.rental.findUnique = async () => existingRental;
        mockPrisma.rental.update = async () => ({
            id: 'r-1', title: 'T', status: 'AVAILABLE',
            location: null,
        });

        const req = mockReq({
            params: { rentalId: 'r-1' },
            body: { status: 'AVAILABLE' },
        });
        const res = mockRes();

        await controller.updateRentalStatus(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.location, null);
    });

    it('nên trả về 500 khi có lỗi database khi update', async () => {
        const existingRental = { id: 'r-1', title: 'T', status: 'PENDING' };
        mockPrisma.rental.findUnique = async () => existingRental;
        mockPrisma.rental.update = async () => { throw new Error('DB write error'); };

        const req = mockReq({
            params: { rentalId: 'r-1' },
            body: { status: 'AVAILABLE' },
        });
        const res = mockRes();

        await controller.updateRentalStatus(req, res);

        assert.equal(res.statusCode, 500);
        assert.equal(res.body.success, false);
    });
});
