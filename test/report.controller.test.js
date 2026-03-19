const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes, createMockPrisma, injectMock, clearModule } = require('./helpers');

const mockPrisma = createMockPrisma();

function loadController() {
    clearModule('../controllers/report.controller');
    injectMock('../config/prisma', mockPrisma);
    return require('../controllers/report.controller');
}

const fakeReport = {
    id: 'rpt-1',
    reporterId: 'user-1',
    targetType: 'USER',
    targetId: 'user-2',
    reason: 'Spam',
    description: 'Gửi tin nhắn spam',
    status: 'PENDING',
    reviewedBy: null,
    moderatorNote: null,
    createdAt: new Date(),
    reporter: { id: 'user-1', fullName: 'Test User', email: 'test@test.com', phone: '0901234567', avatarUrl: null },
    moderator: null,
};

/* ================================================================
   createReport
   ================================================================ */
describe('Report > createReport', () => {
    beforeEach(() => {
        mockPrisma.$transaction = async (fn) => fn(mockPrisma);
        mockPrisma.report.create = async () => fakeReport;
        mockPrisma.moderation_queue.create = async () => ({});
    });

    it('should create a report successfully', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { targetType: 'USER', targetId: 'user-2', reason: 'Spam', description: 'Gửi tin nhắn spam' } });
        const res = mockRes();
        await ctrl.createReport(req, res);
        assert.equal(res._status, 201);
        assert.equal(res._json.success, true);
    });

    it('should return 400 if targetType missing', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { targetId: 'user-2', reason: 'Spam' } });
        const res = mockRes();
        await ctrl.createReport(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /targetType/);
    });

    it('should return 400 if targetId missing', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { targetType: 'USER', reason: 'Spam' } });
        const res = mockRes();
        await ctrl.createReport(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /targetId/);
    });

    it('should return 400 if reason missing', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { targetType: 'USER', targetId: 'user-2' } });
        const res = mockRes();
        await ctrl.createReport(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /reason/);
    });

    it('should return 400 if targetType invalid', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { targetType: 'INVALID', targetId: 'user-2', reason: 'Spam' } });
        const res = mockRes();
        await ctrl.createReport(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /targetType không hợp lệ/);
    });

    it('should return 400 if self-report on USER type', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { targetType: 'USER', targetId: 'user-1', reason: 'Spam' } });
        const res = mockRes();
        await ctrl.createReport(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /tự báo cáo/);
    });

    it('should allow reporting non-self USER', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { targetType: 'USER', targetId: 'user-2', reason: 'Spam' } });
        const res = mockRes();
        await ctrl.createReport(req, res);
        assert.equal(res._status, 201);
    });

    it('should allow reporting ROOM type', async () => {
        const ctrl = loadController();
        const req = mockReq({ body: { targetType: 'ROOM', targetId: 'room-1', reason: 'Sai thông tin' } });
        const res = mockRes();
        await ctrl.createReport(req, res);
        assert.equal(res._status, 201);
    });

    it('should handle P2002 duplicate report', async () => {
        mockPrisma.$transaction = async () => { const e = new Error('dup'); e.code = 'P2002'; throw e; };
        const ctrl = loadController();
        const req = mockReq({ body: { targetType: 'USER', targetId: 'user-2', reason: 'Spam' } });
        const res = mockRes();
        await ctrl.createReport(req, res);
        assert.equal(res._status, 409);
        assert.match(res._json.message, /đã báo cáo/);
    });

    it('should return 500 on unexpected error', async () => {
        mockPrisma.$transaction = async () => { throw new Error('unexpected'); };
        const ctrl = loadController();
        const req = mockReq({ body: { targetType: 'USER', targetId: 'user-2', reason: 'Spam' } });
        const res = mockRes();
        await ctrl.createReport(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   getReports
   ================================================================ */
describe('Report > getReports', () => {
    beforeEach(() => {
        mockPrisma.report.findMany = async () => [fakeReport];
        mockPrisma.report.count = async () => 1;
        mockPrisma.user.findMany = async () => [{ id: 'user-2', fullName: 'Target User', email: 't@t.com', phone: '09012', avatarUrl: null }];
    });

    it('should return paginated reports', async () => {
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getReports(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
        assert.ok(Array.isArray(res._json.data));
        assert.ok(res._json.pagination);
    });

    it('should filter by status', async () => {
        let capturedWhere = null;
        mockPrisma.report.findMany = async (args) => { capturedWhere = args?.where; return []; };
        mockPrisma.report.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { status: 'PENDING' } });
        const res = mockRes();
        await ctrl.getReports(req, res);
        assert.equal(capturedWhere.status, 'PENDING');
    });

    it('should ignore invalid status filter', async () => {
        let capturedWhere = null;
        mockPrisma.report.findMany = async (args) => { capturedWhere = args?.where; return []; };
        mockPrisma.report.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { status: 'INVALID' } });
        const res = mockRes();
        await ctrl.getReports(req, res);
        assert.equal(capturedWhere.status, undefined);
    });

    it('should support pagination params', async () => {
        let capturedSkip = null;
        mockPrisma.report.findMany = async (args) => { capturedSkip = args?.skip; return []; };
        mockPrisma.report.count = async () => 0;
        const ctrl = loadController();
        const req = mockReq({ query: { page: '3', limit: '5' } });
        const res = mockRes();
        await ctrl.getReports(req, res);
        assert.equal(capturedSkip, 10);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.report.findMany = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ query: {} });
        const res = mockRes();
        await ctrl.getReports(req, res);
        assert.equal(res._status, 500);
    });
});

/* ================================================================
   handleReport
   ================================================================ */
describe('Report > handleReport', () => {
    beforeEach(() => {
        mockPrisma.report.findUnique = async () => ({ ...fakeReport, status: 'PENDING' });
        mockPrisma.report.update = async () => ({ ...fakeReport, status: 'APPROVED', reviewedBy: 'user-1', moderator: { id: 'user-1', fullName: 'Mod' } });
    });

    it('should handle report with APPROVED status', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-1' }, body: { status: 'APPROVED', moderatorNote: 'Confirmed violation' } });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.success, true);
    });

    it('should handle report with REJECTED status', async () => {
        mockPrisma.report.update = async () => ({ ...fakeReport, status: 'REJECTED' });
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-1' }, body: { status: 'REJECTED' } });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 200);
    });

    it('should handle report with DISMISSED status', async () => {
        mockPrisma.report.update = async () => ({ ...fakeReport, status: 'DISMISSED' });
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-1' }, body: { status: 'DISMISSED' } });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 200);
    });

    it('should return 400 if status missing', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-1' }, body: {} });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /status không hợp lệ/);
    });

    it('should return 400 if status is PENDING', async () => {
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-1' }, body: { status: 'PENDING' } });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 400);
    });

    it('should return 404 if report not found', async () => {
        mockPrisma.report.findUnique = async () => null;
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-999' }, body: { status: 'APPROVED' } });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 404);
    });

    it('should return 400 if report already handled', async () => {
        mockPrisma.report.findUnique = async () => ({ ...fakeReport, status: 'APPROVED' });
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-1' }, body: { status: 'REJECTED' } });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 400);
        assert.match(res._json.message, /đã được xử lý/);
    });

    it('should return 500 on DB error', async () => {
        mockPrisma.report.findUnique = async () => { throw new Error('db fail'); };
        const ctrl = loadController();
        const req = mockReq({ params: { id: 'rpt-1' }, body: { status: 'APPROVED' } });
        const res = mockRes();
        await ctrl.handleReport(req, res);
        assert.equal(res._status, 500);
    });
});
