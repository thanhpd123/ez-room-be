/**
 * Test helpers — mock utilities for unit tests.
 * Uses require.cache injection to replace real modules with mocks.
 * Node.js 22+ built-in test runner (node:test + node:assert).
 */

/**
 * Create a mock Express request object.
 */
function mockReq(overrides = {}) {
    return {
        auth: { user: { id: 'user-1', email: 'test@test.com', full_name: 'Test User', role: 'TENANT', gender: 'Nam' } },
        params: {},
        query: {},
        body: {},
        ...overrides,
    };
}

/**
 * Create a mock Express response object that captures status, json, and headers.
 */
function mockRes() {
    const res = {
        _status: 200,
        _json: null,
        _headers: {},
        status(code) {
            res._status = code;
            return res;
        },
        json(data) {
            res._json = data;
            return res;
        },
        setHeader(key, value) {
            res._headers[key] = value;
            return res;
        },
    };
    return res;
}

/**
 * Create a mock PrismaClient with common model stubs.
 * Each model method returns a chainable promise by default.
 */
function createMockPrisma() {
    const noop = async () => null;
    const noopArr = async () => [];

    function modelMock() {
        return {
            findMany: noopArr,
            findUnique: noop,
            findFirst: noop,
            create: noop,
            update: noop,
            updateMany: noop,
            delete: noop,
            deleteMany: noop,
            upsert: noop,
            count: async () => 0,
            groupBy: noopArr,
        };
    }

    return {
        user: modelMock(),
        wallet: modelMock(),
        walletTransaction: modelMock(),
        favoriteRoom: modelMock(),
        rooms: modelMock(),
        message: modelMock(),
        roommateMatch: modelMock(),
        amenities: modelMock(),
        location: modelMock(),
        notification: modelMock(),
        feedback: modelMock(),
        rental: modelMock(),
        roomImage: modelMock(),
        roomAmenity: modelMock(),
        userPreference: modelMock(),
        lifestyleProfile: modelMock(),
        $transaction: async (fn) => fn(createMockPrisma()),
    };
}

/**
 * Inject a mock module into require.cache so that subsequent require() calls
 * return the mock instead of the real module.
 */
function injectMock(modulePath, mockExports) {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: mockExports,
    };
}

/**
 * Remove a module from require.cache (to force re-require).
 */
function clearModule(modulePath) {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
}

module.exports = {
    mockReq,
    mockRes,
    createMockPrisma,
    injectMock,
    clearModule,
};
