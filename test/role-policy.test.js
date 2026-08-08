const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRolePolicies, getRolePolicy, getRolePermissions } = require('../utils/role-policy');

test('normalizeRolePolicies keeps custom role definitions usable', () => {
    const policies = normalizeRolePolicies([
        {
            key: 'CUSTOM_MANAGER',
            label: 'Custom Manager',
            color: 'orange',
            permissions: ['manageUsers', 'manageContent'],
        },
    ]);

    assert.equal(policies.length, 1);
    assert.equal(policies[0].key, 'CUSTOM_MANAGER');
    assert.deepEqual(policies[0].permissions, ['manageUsers', 'manageContent']);
});

test('getRolePolicy and getRolePermissions resolve custom role permissions', () => {
    const policies = normalizeRolePolicies([
        {
            key: 'CUSTOM_MANAGER',
            label: 'Custom Manager',
            color: 'orange',
            permissions: ['manageUsers', 'manageContent'],
        },
    ]);

    const policy = getRolePolicy('custom_manager', policies);
    assert.equal(policy?.label, 'Custom Manager');
    assert.deepEqual(getRolePermissions('custom_manager', policies), ['manageUsers', 'manageContent']);
});
