const test = require('node:test');
const assert = require('node:assert/strict');
const { authorize } = require('../middleware/auth');
const { mockReq, mockRes } = require('./helpers');

test('authorize allows access when role and context both match', async () => {
    const req = mockReq({
        auth: { user: { id: 'admin-1', role: 'ADMIN' } },
        params: { userId: 'user-2' },
    });
    const res = mockRes();
    let nextCalled = false;

    const middleware = authorize({
        roles: ['ADMIN'],
        allowIf: ({ req, user }) => req.params.userId !== user.id,
    });

    await middleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res._status, 200);
});

test('authorize denies access when attribute condition fails', async () => {
    const req = mockReq({
        auth: { user: { id: 'admin-1', role: 'ADMIN' } },
        params: { userId: 'admin-1' },
    });
    const res = mockRes();
    let nextCalled = false;

    const middleware = authorize({
        roles: ['ADMIN'],
        allowIf: ({ req, user }) => req.params.userId !== user.id,
    });

    await middleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res._status, 403);
    assert.equal(res._json.success, false);
});

test('authorize denies access when role is not allowed', async () => {
    const req = mockReq({
        auth: { user: { id: 'user-1', role: 'TENANT' } },
        params: { userId: 'user-2' },
    });
    const res = mockRes();
    let nextCalled = false;

    const middleware = authorize({
        roles: ['ADMIN'],
        allowIf: () => true,
    });

    await middleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res._status, 403);
});
