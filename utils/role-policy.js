const DEFAULT_ROLE_POLICIES = [
    {
        key: 'ADMIN',
        label: 'Admin',
        color: 'red',
        permissions: ['manageUsers', 'manageFinance', 'manageSettings', 'manageContent', 'moderateContent'],
    },
    {
        key: 'MODERATOR',
        label: 'Moderator',
        color: 'purple',
        permissions: ['moderateContent', 'manageContent'],
    },
    {
        key: 'LANDLORD',
        label: 'Landlord',
        color: 'blue',
        permissions: ['manageListings', 'manageBookings'],
    },
    {
        key: 'TENANT',
        label: 'Tenant',
        color: 'green',
        permissions: ['bookRooms', 'manageFavorites'],
    },
    {
        key: 'GUEST',
        label: 'Guest',
        color: 'default',
        permissions: ['browsePublic'],
    },
];

function normalizeRolePolicies(policies = []) {
    const normalized = [];
    for (const entry of policies) {
        if (!entry || typeof entry !== 'object') continue;
        const key = String(entry.key || '').trim().toUpperCase();
        if (!key) continue;
        normalized.push({
            key,
            label: String(entry.label || key).trim(),
            color: String(entry.color || 'default').trim(),
            permissions: Array.isArray(entry.permissions) ? entry.permissions.map(String) : [],
        });
    }
    return normalized;
}

function resolveRolePolicies(customPolicies = []) {
    const custom = normalizeRolePolicies(customPolicies);
    const merged = [...DEFAULT_ROLE_POLICIES, ...custom];
    const map = new Map();
    for (const policy of merged) {
        if (!map.has(policy.key)) {
            map.set(policy.key, policy);
        }
    }
    return Array.from(map.values());
}

function getRolePolicy(role, policies = []) {
    const normalizedRole = String(role || '').trim().toUpperCase();
    const resolvedPolicies = resolveRolePolicies(policies);
    return resolvedPolicies.find((policy) => policy.key === normalizedRole) || null;
}

function getRolePermissions(role, policies = []) {
    const policy = getRolePolicy(role, policies);
    return policy?.permissions || [];
}

function getRolePolicyConfig(policies = []) {
    return resolveRolePolicies(policies).map((policy) => ({
        value: policy.key,
        label: policy.label,
        color: policy.color,
        permissions: policy.permissions,
    }));
}

module.exports = {
    DEFAULT_ROLE_POLICIES,
    normalizeRolePolicies,
    resolveRolePolicies,
    getRolePolicy,
    getRolePermissions,
    getRolePolicyConfig,
};
