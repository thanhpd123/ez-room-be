/**
 * middleware.test.js — Unit test cho middleware xác thực
 *
 * Modules được test:
 * - middleware/auth.js : verifyJWT, requireRole, optionalJWT
 *
 * Chiến lược mock:
 * - Mock module '../config/prisma' và '../config/supabase' bằng cách
 *   override require cache trước khi load middleware.
 * - Mock jsonwebtoken.verify() thay vì gọi thật.
 *
 * Sử dụng: node --test test/middleware.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { mockReq, mockRes } = require('./helpers');

// ═══════════════════════════════════════════════════════════
// Thiết lập mock modules
// ═══════════════════════════════════════════════════════════

// Mock prisma — có thể thay đổi behavior từng test
let mockPrismaUser = null; // findUnique sẽ trả về giá trị này
const fakePrisma = {
    user: {
        findUnique: async () => mockPrismaUser,
    },
};

// Mock supabase — mặc định trả về lỗi (không phải Supabase token)
let mockSupabaseResult = { data: { user: null }, error: new Error('not supabase') };
const fakeSupabase = {
    auth: {
        getUser: async () => mockSupabaseResult,
    },
};

// Mock jsonwebtoken — mặc định trả về payload
let mockJwtPayload = null;
let mockJwtError = null;
const fakeJwt = {
    verify: () => {
        if (mockJwtError) throw mockJwtError;
        return mockJwtPayload;
    },
    sign: (payload, secret, opts) => 'mock-token',
};

// ═══════════════════════════════════════════════════════════
// Override require cache để inject mocks
// ═══════════════════════════════════════════════════════════

const path = require('path');
const configPrismaPath = require.resolve('../config/prisma');
const configSupabasePath = require.resolve('../config/supabase');
const jwtPath = require.resolve('jsonwebtoken');

// Lưu lại module gốc
const originalPrisma = require.cache[configPrismaPath];
const originalSupabase = require.cache[configSupabasePath];
const originalJwt = require.cache[jwtPath];

// Thay thế bằng mock
require.cache[configPrismaPath] = { id: configPrismaPath, exports: fakePrisma };
require.cache[configSupabasePath] = { id: configSupabasePath, exports: fakeSupabase };
require.cache[jwtPath] = { id: jwtPath, exports: fakeJwt };

// Load middleware SAU KHI đã inject mock
const { verifyJWT, requireRole, optionalJWT } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════
// Dữ liệu test chung
// ═══════════════════════════════════════════════════════════

const ACTIVE_USER = {
    id: 'user-1',
    fullName: 'Test User',
    email: 'test@test.com',
    avatarUrl: null,
    createdAt: new Date(),
    role: 'TENANT',
    phone: '0912345678',
    status: 'ACTIVE',
};

const ADMIN_USER = { ...ACTIVE_USER, id: 'admin-1', role: 'ADMIN' };

// ═══════════════════════════════════════════════════════════
// 1. verifyJWT
// ═══════════════════════════════════════════════════════════

describe('verifyJWT', () => {
    beforeEach(() => {
        // Reset mock trước mỗi test
        mockPrismaUser = null;
        mockSupabaseResult = { data: { user: null }, error: new Error('not supabase') };
        mockJwtPayload = null;
        mockJwtError = null;
    });

    it('không có header Authorization — trả 401', async () => {
        const req = mockReq({ headers: {} });
        const res = mockRes();
        await verifyJWT(req, res, () => {});
        assert.equal(res._status, 401);
        assert.equal(res._json.success, false);
        assert.ok(res._json.message.includes('Authorization'));
    });

    it('header sai format (không có "Bearer ") — trả 401', async () => {
        const req = mockReq({ headers: { authorization: 'Token abc' } });
        const res = mockRes();
        await verifyJWT(req, res, () => {});
        assert.equal(res._status, 401);
    });

    it('Bearer nhưng token rỗng — trả 401', async () => {
        const req = mockReq({ headers: { authorization: 'Bearer ' } });
        const res = mockRes();
        await verifyJWT(req, res, () => {});
        assert.equal(res._status, 401);
    });

    it('Supabase token hợp lệ, user ACTIVE trong DB — gọi next()', async () => {
        // Giả lập: Supabase trả user hợp lệ
        mockSupabaseResult = {
            data: { user: { email: 'test@test.com', user_metadata: { full_name: 'Test' } } },
            error: null,
        };
        mockPrismaUser = ACTIVE_USER;

        const req = mockReq({ headers: { authorization: 'Bearer supabase-token' } });
        const res = mockRes();
        let nextCalled = false;
        await verifyJWT(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, true);
        assert.equal(req.auth.user.id, 'user-1');
        assert.equal(req.auth.user.email, 'test@test.com');
        assert.equal(req.auth.user.role, 'TENANT');
    });

    it('Supabase token hợp lệ, user KHÔNG có trong DB — trả 404 NEED_REGISTER', async () => {
        mockSupabaseResult = {
            data: { user: { email: 'new@test.com', user_metadata: {} } },
            error: null,
        };
        mockPrismaUser = null; // Không tìm thấy user

        const req = mockReq({ headers: { authorization: 'Bearer supabase-token' } });
        const res = mockRes();
        await verifyJWT(req, res, () => {});

        assert.equal(res._status, 404);
        assert.equal(res._json.code, 'NEED_REGISTER');
    });

    it('Supabase token hợp lệ, user bị SUSPENDED — trả 404 NEED_REGISTER', async () => {
        mockSupabaseResult = {
            data: { user: { email: 'test@test.com', user_metadata: {} } },
            error: null,
        };
        mockPrismaUser = { ...ACTIVE_USER, status: 'SUSPENDED' };

        const req = mockReq({ headers: { authorization: 'Bearer supabase-token' } });
        const res = mockRes();
        await verifyJWT(req, res, () => {});

        assert.equal(res._status, 404);
    });

    it('Backend JWT hợp lệ, user ACTIVE — gọi next()', async () => {
        // Supabase trả lỗi → fallback sang backend JWT
        mockSupabaseResult = { data: { user: null }, error: new Error('invalid') };
        mockJwtPayload = { userId: 'user-1', email: 'test@test.com', role: 'TENANT' };
        mockPrismaUser = ACTIVE_USER;

        const req = mockReq({ headers: { authorization: 'Bearer backend-jwt-token' } });
        const res = mockRes();
        let nextCalled = false;
        await verifyJWT(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, true);
        assert.equal(req.auth.user.id, 'user-1');
    });

    it('Backend JWT hợp lệ nhưng user BANNED — trả 401', async () => {
        mockSupabaseResult = { data: { user: null }, error: new Error('invalid') };
        mockJwtPayload = { userId: 'user-1' };
        mockPrismaUser = { ...ACTIVE_USER, status: 'BANNED' };

        const req = mockReq({ headers: { authorization: 'Bearer token' } });
        const res = mockRes();
        await verifyJWT(req, res, () => {});

        assert.equal(res._status, 401);
        assert.ok(res._json.message.includes('khóa'));
    });

    it('Backend JWT không có userId — trả 401', async () => {
        mockSupabaseResult = { data: { user: null }, error: new Error('invalid') };
        mockJwtPayload = { email: 'test@test.com' }; // Thiếu userId

        const req = mockReq({ headers: { authorization: 'Bearer token' } });
        const res = mockRes();
        await verifyJWT(req, res, () => {});

        assert.equal(res._status, 401);
        assert.ok(res._json.message.includes('payload'));
    });

    it('JWT hết hạn — trả 401 "đã hết hạn"', async () => {
        mockSupabaseResult = { data: { user: null }, error: new Error('invalid') };
        const expiredErr = new Error('jwt expired');
        expiredErr.name = 'TokenExpiredError';
        mockJwtError = expiredErr;

        const req = mockReq({ headers: { authorization: 'Bearer expired-token' } });
        const res = mockRes();
        await verifyJWT(req, res, () => {});

        assert.equal(res._status, 401);
        assert.ok(res._json.message.includes('hết hạn'));
    });

    it('JWT malformed — trả 401 "không hợp lệ"', async () => {
        mockSupabaseResult = { data: { user: null }, error: new Error('invalid') };
        const jwtErr = new Error('invalid signature');
        jwtErr.name = 'JsonWebTokenError';
        mockJwtError = jwtErr;

        const req = mockReq({ headers: { authorization: 'Bearer bad-token' } });
        const res = mockRes();
        await verifyJWT(req, res, () => {});

        assert.equal(res._status, 401);
        assert.ok(res._json.message.includes('không hợp lệ'));
    });
});

// ═══════════════════════════════════════════════════════════
// 2. requireRole
// ═══════════════════════════════════════════════════════════

describe('requireRole', () => {
    it('user có role phù hợp — gọi next()', () => {
        const middleware = requireRole('ADMIN', 'MODERATOR');
        const req = mockReq({ auth: { user: ADMIN_USER } });
        const res = mockRes();
        let nextCalled = false;
        middleware(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    it('user role không phù hợp — trả 403', () => {
        const middleware = requireRole('ADMIN');
        const req = mockReq({ auth: { user: { ...ACTIVE_USER, role: 'TENANT' } } });
        const res = mockRes();
        middleware(req, res, () => {});
        assert.equal(res._status, 403);
        assert.equal(res._json.success, false);
    });

    it('chưa xác thực (auth null) — trả 401', () => {
        const middleware = requireRole('ADMIN');
        const req = mockReq({ auth: null });
        const res = mockRes();
        middleware(req, res, () => {});
        assert.equal(res._status, 401);
    });

    it('nhiều role cho phép — user thuộc 1 trong các role — pass', () => {
        const middleware = requireRole('ADMIN', 'MODERATOR', 'LANDLORD');
        const req = mockReq({ auth: { user: { ...ACTIVE_USER, role: 'LANDLORD' } } });
        const res = mockRes();
        let nextCalled = false;
        middleware(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });
});

// ═══════════════════════════════════════════════════════════
// 3. optionalJWT
// ═══════════════════════════════════════════════════════════

describe('optionalJWT', () => {
    beforeEach(() => {
        mockPrismaUser = null;
        mockSupabaseResult = { data: { user: null }, error: new Error('not supabase') };
        mockJwtPayload = null;
        mockJwtError = null;
    });

    it('không có Authorization — auth = null, vẫn gọi next()', async () => {
        const req = mockReq({ headers: {} });
        const res = mockRes();
        let nextCalled = false;
        await optionalJWT(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
        assert.equal(req.auth, null);
    });

    it('có token hợp lệ — gắn user vào req.auth', async () => {
        mockSupabaseResult = { data: { user: null }, error: new Error('invalid') };
        mockJwtPayload = { userId: 'user-1' };
        mockPrismaUser = ACTIVE_USER;

        const req = mockReq({ headers: { authorization: 'Bearer valid-token' } });
        const res = mockRes();
        let nextCalled = false;
        await optionalJWT(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, true);
        assert.equal(req.auth.user.id, 'user-1');
    });

    it('token không hợp lệ — auth = null, vẫn gọi next() (không lỗi)', async () => {
        mockSupabaseResult = { data: { user: null }, error: new Error('invalid') };
        mockJwtError = new Error('bad token');
        mockJwtError.name = 'JsonWebTokenError';

        const req = mockReq({ headers: { authorization: 'Bearer bad-token' } });
        const res = mockRes();
        let nextCalled = false;
        await optionalJWT(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, true);
        assert.equal(req.auth, null);
    });
});
