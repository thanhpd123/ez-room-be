/**
 * helpers.js — Hàm tiện ích dùng chung cho tất cả file test
 *
 * Cung cấp:
 * - mockReq()  : Tạo đối tượng request giả
 * - mockRes()  : Tạo đối tượng response giả (có ghi lại status + json)
 * - mockPrisma : Đối tượng prisma giả với các method thường dùng
 */

/**
 * Tạo mock request object
 * @param {object} overrides - Ghi đè các thuộc tính (body, params, query, headers, auth)
 * @returns {object} Đối tượng request giả lập
 */
function mockReq(overrides = {}) {
    return {
        body: {},
        params: {},
        query: {},
        headers: {},
        auth: null,
        ...overrides,
    };
}

/**
 * Tạo mock response object
 * Ghi lại:
 * - res._status : HTTP status code đã gọi
 * - res._json   : Dữ liệu JSON đã trả về
 *
 * @returns {object} Đối tượng response giả lập
 */
function mockRes() {
    const res = {
        _status: 200,
        _json: null,
    };

    // res.status(code) trả về chính res để chain được: res.status(400).json(...)
    res.status = (code) => {
        res._status = code;
        return res;
    };

    // res.json(data) ghi lại dữ liệu và trả về res
    res.json = (data) => {
        res._json = data;
        return res;
    };

    return res;
}

/**
 * Tạo mock prisma với các model/method cơ bản
 * Mỗi method trả về Promise.resolve(null) mặc định
 * Có thể ghi đè từng method khi cần
 *
 * @param {object} overrides - Ghi đè model/method
 * @returns {object} Đối tượng prisma giả lập
 */
function createMockPrisma(overrides = {}) {
    const defaultModel = {
        findUnique: async () => null,
        findFirst: async () => null,
        findMany: async () => [],
        create: async (args) => ({ id: 'mock-id', ...args.data }),
        update: async (args) => ({ id: 'mock-id', ...args.data }),
        updateMany: async () => ({ count: 0 }),
        delete: async () => ({}),
        deleteMany: async () => ({ count: 0 }),
        count: async () => 0,
        upsert: async (args) => ({ id: 'mock-id', ...args.create }),
    };

    return {
        user: { ...defaultModel, ...(overrides.user || {}) },
        verificationCode: { ...defaultModel, ...(overrides.verificationCode || {}) },
        notification: { ...defaultModel, ...(overrides.notification || {}) },
        lifestyleProfile: { ...defaultModel, ...(overrides.lifestyleProfile || {}) },
        userPreference: { ...defaultModel, ...(overrides.userPreference || {}) },
        rental: { ...defaultModel, ...(overrides.rental || {}) },
        location: { ...defaultModel, ...(overrides.location || {}) },
        rentalImage: { ...defaultModel, ...(overrides.rentalImage || {}) },
        $connect: async () => {},
        $disconnect: async () => {},
    };
}

module.exports = { mockReq, mockRes, createMockPrisma };
