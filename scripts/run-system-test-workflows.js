#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.SYSTEM_TEST_BASE_URL || 'http://localhost:3000';
const OUTPUT_PATH = path.resolve(__dirname, '../../system-test-execution-latest.json');
const DEFAULT_TIMEOUT_MS = Number(process.env.SYSTEM_TEST_TIMEOUT_MS || 20000);
const FAKE_ID = '00000000-0000-0000-0000-000000000000';

function nowIso() {
  return new Date().toISOString();
}

function expectedToString(expected) {
  if (Array.isArray(expected)) return expected.join('/');
  if (typeof expected === 'string') return expected;
  return String(expected);
}

function isExpectedStatus(status, expected) {
  if (Array.isArray(expected)) return expected.includes(status);
  if (typeof expected === 'string') {
    if (expected === '2xx') return status >= 200 && status < 300;
    if (expected === '4xx') return status >= 400 && status < 500;
    return false;
  }
  return status === expected;
}

function authHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function withTimeout(promise, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return Promise.resolve({ controller, timer, promise });
}

async function sendRequest({ method = 'GET', pathName, token, body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = `${BASE_URL}${pathName}`;
  const finalHeaders = {
    Accept: 'application/json',
    ...authHeader(token),
    ...headers,
  };

  const init = {
    method,
    headers: finalHeaders,
  };

  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const { controller, timer } = await withTimeout(null, timeoutMs);
  init.signal = controller.signal;

  const startedAt = Date.now();
  try {
    const res = await fetch(url, init);
    const durationMs = Date.now() - startedAt;

    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text.slice(0, 500);
      }
    }

    clearTimeout(timer);
    return {
      ok: true,
      status: res.status,
      durationMs,
      data,
      url,
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      error: error?.message || 'Request failed',
      url,
    };
  }
}

function pickFirstId(payload, keys) {
  if (!payload || typeof payload !== 'object') return null;

  const candidates = [];
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      candidates.push(...value);
    } else if (value && typeof value === 'object') {
      candidates.push(value);
    }
  }

  for (const item of candidates) {
    if (item && typeof item === 'object' && item.id) {
      return item.id;
    }
  }

  return null;
}

async function run() {
  const seed = Date.now();
  const uniqueEmail = `sys_${seed}@example.com`;
  const password = 'System@123';

  const ctx = {
    token: null,
    userId: null,
    rentalId: FAKE_ID,
    roomId: FAKE_ID,
    vipPackageId: null,
    notificationId: FAKE_ID,
    uniqueEmail,
    password,
  };

  const cases = [
    {
      wf: 'Authentication', id: 'AUTH-01', feature: 'Health', name: 'Health check root endpoint',
      method: 'GET', pathName: '/', expected: 200,
    },
    {
      wf: 'Authentication', id: 'AUTH-02', feature: 'Password', name: 'Suggest strong password',
      method: 'GET', pathName: '/auth/suggest-password', expected: 200,
    },
    {
      wf: 'Authentication', id: 'AUTH-03', feature: 'Register', name: 'Register tenant account',
      method: 'POST', pathName: '/auth/register', expected: 201,
      body: () => ({ fullName: 'System User', email: ctx.uniqueEmail, password: ctx.password, confirmPassword: ctx.password, role: 'TENANT' }),
    },
    {
      wf: 'Authentication', id: 'AUTH-04', feature: 'Login', name: 'Login newly registered tenant',
      method: 'POST', pathName: '/auth/login', expected: 200,
      body: () => ({ email: ctx.uniqueEmail, password: ctx.password }),
      capture: (response) => {
        if (response?.data?.token) ctx.token = response.data.token;
        if (response?.data?.accessToken) ctx.token = response.data.accessToken;
        if (response?.data?.user?.id) ctx.userId = response.data.user.id;
      },
    },
    {
      wf: 'Authentication', id: 'AUTH-05', feature: 'Me', name: 'Get current user profile',
      method: 'GET', pathName: '/auth/me', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Authentication', id: 'AUTH-06', feature: 'Profile', name: 'Update profile basic fields',
      method: 'PATCH', pathName: '/auth/profile', expected: 200, auth: 'tenant',
      body: () => ({ fullName: 'System User Updated' }),
    },
    {
      wf: 'Authentication', id: 'AUTH-07', feature: 'Lifestyle', name: 'Get lifestyle profile',
      method: 'GET', pathName: '/auth/lifestyle', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Authentication', id: 'AUTH-08', feature: 'Preference', name: 'Get preference profile',
      method: 'GET', pathName: '/auth/preference', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Authentication', id: 'AUTH-09', feature: 'Security', name: 'Change password invalid payload validation',
      method: 'PATCH', pathName: '/auth/change-password', expected: 400, auth: 'tenant',
      body: () => ({ currentPassword: ctx.password, newPassword: 'weak', confirmNewPassword: 'weak' }),
    },
    {
      wf: 'Authentication', id: 'AUTH-10', feature: 'Refresh', name: 'Refresh token without cookie should fail',
      method: 'POST', pathName: '/auth/refresh', expected: [400, 401],
      body: () => ({ refreshToken: 'invalid-token' }),
    },

    {
      wf: 'Tenant', id: 'TEN-01', feature: 'Public listing', name: 'List public rentals',
      method: 'GET', pathName: '/public/rentals', expected: 200,
      capture: (response) => {
        const data = response?.data?.data;
        if (Array.isArray(data) && data.length && data[0]?.id) ctx.rentalId = data[0].id;
      },
    },
    {
      wf: 'Tenant', id: 'TEN-02', feature: 'Public search', name: 'Search public rentals by keyword',
      method: 'GET', pathName: '/public/search?keyword=phong', expected: 200,
    },
    {
      wf: 'Tenant', id: 'TEN-03', feature: 'Rental listing', name: 'List rentals aggregate endpoint',
      method: 'GET', pathName: '/rentals?page=1&limit=5', expected: 200,
    },
    {
      wf: 'Tenant', id: 'TEN-04', feature: 'Room listing', name: 'List rooms and cache first room id',
      method: 'GET', pathName: '/rooms?page=1&limit=5', expected: 200,
      capture: (response) => {
        const payload = response?.data;
        const roomId = pickFirstId(payload, ['data', 'rooms', 'items']);
        if (roomId) ctx.roomId = roomId;
      },
    },
    {
      wf: 'Tenant', id: 'TEN-05', feature: 'Recommendation', name: 'Get recommend list',
      method: 'GET', pathName: '/search/recommend', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-06', feature: 'Roommate', name: 'Get roommate suggestions',
      method: 'GET', pathName: '/roommate/suggestions', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-07', feature: 'Favorites', name: 'Get favorite list',
      method: 'GET', pathName: '/favorites', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-08', feature: 'Favorites', name: 'Get favorite ids',
      method: 'GET', pathName: '/favorites/ids', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-09', feature: 'Notifications', name: 'Get notification list',
      method: 'GET', pathName: '/notifications', expected: 200, auth: 'tenant',
      capture: (response) => {
        const items = response?.data?.data || response?.data?.notifications || response?.data?.items;
        if (Array.isArray(items) && items.length && items[0]?.id) {
          ctx.notificationId = items[0].id;
        }
      },
    },
    {
      wf: 'Tenant', id: 'TEN-10', feature: 'Notifications', name: 'Get unread notification count',
      method: 'GET', pathName: '/notifications/unread-count', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-11', feature: 'Wallet', name: 'Get wallet balance',
      method: 'GET', pathName: '/wallet', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-12', feature: 'Wallet', name: 'Get wallet transaction history',
      method: 'GET', pathName: '/wallet/transactions', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-13', feature: 'Preorder', name: 'Get tenant preorder history',
      method: 'GET', pathName: '/preorders/mine', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-14', feature: 'VIP', name: 'Get tenant VIP status',
      method: 'GET', pathName: '/vip/my-status', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-15', feature: 'Public listing', name: 'Get public room types',
      method: 'GET', pathName: '/public/room-types', expected: 200,
    },
    {
      wf: 'Tenant', id: 'TEN-16', feature: 'Public listing', name: 'Get public rental detail by cached rental id',
      method: 'GET', pathName: () => `/public/rentals/${ctx.rentalId || FAKE_ID}`, expected: [200, 404],
    },
    {
      wf: 'Tenant', id: 'TEN-17', feature: 'Blog public', name: 'Get public blog list',
      method: 'GET', pathName: '/blogs?page=1&limit=5', expected: 200,
    },
    {
      wf: 'Tenant', id: 'TEN-18', feature: 'Blog public', name: 'Get public blog detail with unknown slug',
      method: 'GET', pathName: '/blogs/non-existent-slug-system-test', expected: 404,
    },
    {
      wf: 'Tenant', id: 'TEN-19', feature: 'Notifications', name: 'Mark all notifications as read',
      method: 'PATCH', pathName: '/notifications/read-all', expected: [200, 400], auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-20', feature: 'Notifications', name: 'Mark one notification as read by fake id',
      method: 'PATCH', pathName: () => `/notifications/${ctx.notificationId || FAKE_ID}/read`, expected: [200, 404], auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-21', feature: 'Messaging', name: 'Get conversations list',
      method: 'GET', pathName: '/messages/conversations', expected: 200, auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-22', feature: 'Messaging', name: 'Get thread with fake user id',
      method: 'GET', pathName: () => `/messages/with/${FAKE_ID}`, expected: [200, 400, 404], auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-23', feature: 'Messaging', name: 'Send message invalid payload should fail validation',
      method: 'POST', pathName: '/messages', expected: [400, 404], auth: 'tenant',
      body: () => ({ receiverId: FAKE_ID, content: '' }),
    },
    {
      wf: 'Tenant', id: 'TEN-24', feature: 'Interaction tracking', name: 'Create interaction event',
      method: 'POST', pathName: '/interactions', expected: [200, 201, 400], auth: 'tenant',
      body: () => ({ roomId: ctx.roomId || FAKE_ID, interactionType: 'view' }),
    },
    {
      wf: 'Tenant', id: 'TEN-26', feature: 'Report', name: 'Create report with fake target id',
      method: 'POST', pathName: '/reports', expected: [201, 400, 404], auth: 'tenant',
      body: () => ({ targetType: 'ROOM', targetId: ctx.roomId || FAKE_ID, reason: 'SCAM', description: 'System test report case' }),
    },
    {
      wf: 'Tenant', id: 'TEN-27', feature: 'Feedback', name: 'Get room reviews by room id',
      method: 'GET', pathName: () => `/feedback/room/${ctx.roomId || FAKE_ID}`, expected: [200, 404],
    },
    {
      wf: 'Tenant', id: 'TEN-28', feature: 'Feedback', name: 'Get feedback by rental period with fake id',
      method: 'GET', pathName: () => `/feedback/by-rental-period/${FAKE_ID}`, expected: [200, 404], auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-29', feature: 'Feedback', name: 'Create feedback with invalid payload should fail validation',
      method: 'POST', pathName: '/feedback', expected: [400, 404], auth: 'tenant',
      body: () => ({ roomId: ctx.roomId || FAKE_ID, rating: 3 }),
    },
    {
      wf: 'Tenant', id: 'TEN-30', feature: 'Wallet', name: 'Deposit wallet with invalid amount',
      method: 'POST', pathName: '/wallet/deposit', expected: [400, 422], auth: 'tenant',
      body: () => ({ amount: -1 }),
    },
    {
      wf: 'Tenant', id: 'TEN-31', feature: 'Wallet', name: 'Withdraw wallet with invalid amount',
      method: 'POST', pathName: '/wallet/withdraw', expected: [400, 422], auth: 'tenant',
      body: () => ({ amount: -1 }),
    },
    {
      wf: 'Tenant', id: 'TEN-32', feature: 'Preorder', name: 'Create deposit payment invalid room should fail',
      method: 'POST', pathName: '/preorders/deposit/pay', expected: [400, 404], auth: 'tenant',
      body: () => ({ roomId: FAKE_ID, depositMonths: 1 }),
    },
    {
      wf: 'Tenant', id: 'TEN-33', feature: 'Preorder', name: 'Verify preorder payment with fake preorder id',
      method: 'GET', pathName: () => `/preorders/${FAKE_ID}/verify-payment`, expected: [400, 404], auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-34', feature: 'Upload', name: 'Upload image without file should fail',
      method: 'POST', pathName: '/upload/image', expected: [400, 415], auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-35', feature: 'Upload', name: 'Upload rental image without file should fail',
      method: 'POST', pathName: '/upload/rental-image', expected: [400, 415], auth: 'tenant',
    },
    {
      wf: 'Tenant', id: 'TEN-36', feature: 'VIP', name: 'Verify VIP purchase without orderCode should fail',
      method: 'GET', pathName: '/vip/verify', expected: [400, 404], auth: 'tenant',
    },

    {
      wf: 'Landlord', id: 'LL-01', feature: 'Landlord dashboard', name: 'Landlord dashboard gate with tenant token',
      method: 'GET', pathName: '/rentals/dashboard', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Landlord', id: 'LL-02', feature: 'Landlord performance', name: 'Landlord performance gate with tenant token',
      method: 'GET', pathName: '/rentals/performance', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Landlord', id: 'LL-03', feature: 'Landlord analytics', name: 'Top searched rooms gate with tenant token',
      method: 'GET', pathName: '/rentals/top-searched', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Landlord', id: 'LL-04', feature: 'Landlord inventory', name: 'My rentals gate with tenant token',
      method: 'GET', pathName: '/rentals/my-rentals', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Landlord', id: 'LL-05', feature: 'Tenant search', name: 'Search tenants gate with tenant token',
      method: 'GET', pathName: '/rooms/search-tenants?query=test', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Landlord', id: 'LL-06', feature: 'Preorder management', name: 'Landlord preorder queue gate with tenant token',
      method: 'GET', pathName: '/preorders/landlord', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Landlord', id: 'LL-07', feature: 'Favorite analytics', name: 'Landlord wishers endpoint gate with tenant token',
      method: 'GET', pathName: () => `/favorites/room/${ctx.roomId || FAKE_ID}/wishers`, expected: 403, auth: 'tenant',
    },
    {
      wf: 'Landlord', id: 'LL-08', feature: 'VIP packages', name: 'Get landlord-targeted VIP packages',
      method: 'GET', pathName: '/vip/packages?targetRole=LANDLORD', expected: 200,
    },
    {
      wf: 'Landlord', id: 'LL-09', feature: 'Room tenants', name: 'Get room tenants gate with tenant token',
      method: 'GET', pathName: () => `/rooms/${ctx.roomId || FAKE_ID}/tenants`, expected: 403, auth: 'tenant',
    },
    {
      wf: 'Landlord', id: 'LL-10', feature: 'Contract', name: 'Create rental contract gate with tenant token',
      method: 'POST', pathName: () => `/rooms/${ctx.roomId || FAKE_ID}/contracts`, expected: 403, auth: 'tenant',
      body: () => ({ tenantId: FAKE_ID, startDate: '2026-04-01', endDate: '2026-05-01' }),
    },
    {
      wf: 'Landlord', id: 'LL-11', feature: 'Document', name: 'Upload landlord document gate with tenant token',
      method: 'POST', pathName: '/documents/upload', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Landlord', id: 'LL-12', feature: 'Feedback management', name: 'Landlord reviews endpoint with tenant token',
      method: 'GET', pathName: '/feedback/landlord/reviews', expected: [200, 403], auth: 'tenant',
    },
    {
      wf: 'Landlord', id: 'LL-13', feature: 'Feedback reply', name: 'Reply review endpoint with tenant token',
      method: 'POST', pathName: () => `/feedback/${FAKE_ID}/reply`, expected: [400, 403, 404], auth: 'tenant',
      body: () => ({ content: 'System test reply' }),
    },
    {
      wf: 'Landlord', id: 'LL-14', feature: 'Rental ownership', name: 'Update rental gate with tenant token',
      method: 'PUT', pathName: () => `/rentals/${ctx.rentalId || FAKE_ID}`, expected: 403, auth: 'tenant',
      body: () => ({ title: 'System test title update' }),
    },
    {
      wf: 'Landlord', id: 'LL-15', feature: 'Rental ownership', name: 'Delete rental gate with tenant token',
      method: 'DELETE', pathName: () => `/rentals/${ctx.rentalId || FAKE_ID}`, expected: 403, auth: 'tenant',
    },
    {
      wf: 'Landlord', id: 'LL-16', feature: 'Room ownership', name: 'Update room gate with tenant token',
      method: 'PUT', pathName: () => `/rooms/${ctx.roomId || FAKE_ID}`, expected: 403, auth: 'tenant',
      body: () => ({ name: 'System test room update' }),
    },

    {
      wf: 'Admin', id: 'ADM-01', feature: 'Dashboard', name: 'Admin stats gate with tenant token',
      method: 'GET', pathName: '/admin/stats', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-02', feature: 'Settings', name: 'Admin settings gate with tenant token',
      method: 'GET', pathName: '/admin/settings', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-03', feature: 'Finance', name: 'Admin finance summary gate with tenant token',
      method: 'GET', pathName: '/admin/finance/summary', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-04', feature: 'User management', name: 'Admin users gate with tenant token',
      method: 'GET', pathName: '/admin/users', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-05', feature: 'Wallet management', name: 'Admin wallet stats gate with tenant token',
      method: 'GET', pathName: '/admin/wallets/stats', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-06', feature: 'VIP management', name: 'Admin VIP package management gate',
      method: 'GET', pathName: '/admin/vip/packages', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-07', feature: 'Amenity management', name: 'Create amenity gate with tenant token',
      method: 'POST', pathName: '/amenities', expected: 403, auth: 'tenant',
      body: () => ({ name: `System Amenity ${Date.now()}` }),
    },
    {
      wf: 'Admin', id: 'ADM-08', feature: 'Location management', name: 'Create location gate with tenant token',
      method: 'POST', pathName: '/locations', expected: 403, auth: 'tenant',
      body: () => ({ city: 'Ha Noi', district: 'Ba Dinh', address: 'Auto test' }),
    },
    {
      wf: 'Admin', id: 'ADM-09', feature: 'User management', name: 'Admin user detail gate with tenant token',
      method: 'GET', pathName: () => `/admin/users/${ctx.userId || FAKE_ID}`, expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-10', feature: 'User management', name: 'Admin update user status gate with tenant token',
      method: 'PATCH', pathName: () => `/admin/users/${ctx.userId || FAKE_ID}/status`, expected: 403, auth: 'tenant',
      body: () => ({ status: 'BANNED' }),
    },
    {
      wf: 'Admin', id: 'ADM-11', feature: 'Finance', name: 'Admin reconciliation gate with tenant token',
      method: 'GET', pathName: '/admin/finance/reconciliation', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-12', feature: 'Moderator KPI', name: 'Admin moderator KPI gate with tenant token',
      method: 'GET', pathName: '/admin/moderators/kpis', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-13', feature: 'Wallet management', name: 'Admin wallet list gate with tenant token',
      method: 'GET', pathName: '/admin/wallets', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-14', feature: 'Wallet management', name: 'Admin withdrawal queue gate with tenant token',
      method: 'GET', pathName: '/admin/wallets/withdrawals/pending', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-15', feature: 'Verification', name: 'Citizen card verification list gate with tenant token',
      method: 'GET', pathName: '/verifications/citizen-cards', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-16', feature: 'Blog management', name: 'Admin blog list gate with tenant token',
      method: 'GET', pathName: '/blogs/admin/posts', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-17', feature: 'Blog management', name: 'Create blog post gate with tenant token',
      method: 'POST', pathName: '/blogs/admin/posts', expected: 403, auth: 'tenant',
      body: () => ({ title: 'System test blog', content: 'System test content' }),
    },
    {
      wf: 'Admin', id: 'ADM-18', feature: 'Report management', name: 'Reports list gate with tenant token',
      method: 'GET', pathName: '/reports', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Admin', id: 'ADM-19', feature: 'Document verification', name: 'Verify document gate with tenant token',
      method: 'PATCH', pathName: () => `/documents/${FAKE_ID}/verify`, expected: 403, auth: 'tenant',
      body: () => ({ approved: true }),
    },
    {
      wf: 'Admin', id: 'ADM-20', feature: 'Document verification', name: 'Document logs gate with tenant token',
      method: 'GET', pathName: () => `/documents/${FAKE_ID}/logs`, expected: 403, auth: 'tenant',
    },

    {
      wf: 'Moderator', id: 'MOD-01', feature: 'Queue', name: 'Moderator queue gate with tenant token',
      method: 'GET', pathName: '/moderator/queue', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-02', feature: 'Logs', name: 'Moderator logs gate with tenant token',
      method: 'GET', pathName: '/moderator/logs', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-03', feature: 'Queue activity', name: 'Moderator queue activity gate with tenant token',
      method: 'GET', pathName: '/moderator/queue/activity', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-04', feature: 'User moderation', name: 'Moderator users gate with tenant token',
      method: 'GET', pathName: '/moderator/users', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-05', feature: 'Rental moderation', name: 'Moderator rentals stats gate with tenant token',
      method: 'GET', pathName: '/moderator/rentals/stats', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-06', feature: 'Rental moderation', name: 'Moderator rental queue gate with tenant token',
      method: 'GET', pathName: '/moderator/rentals/moderation', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-07', feature: 'Report moderation', name: 'Moderator reports gate with tenant token',
      method: 'GET', pathName: '/moderator/reports', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-08', feature: 'Review moderation', name: 'Moderator reviews gate with tenant token',
      method: 'GET', pathName: '/moderator/reviews', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-09', feature: 'Queue', name: 'Moderator queue check gate with tenant token',
      method: 'GET', pathName: '/moderator/queue/check?targetType=RENTAL&targetId=00000000-0000-0000-0000-000000000000', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-10', feature: 'Queue assignment', name: 'Assign queue item gate with tenant token',
      method: 'PATCH', pathName: () => `/moderator/queue/${FAKE_ID}/assign`, expected: 403, auth: 'tenant',
      body: () => ({ moderatorId: FAKE_ID }),
    },
    {
      wf: 'Moderator', id: 'MOD-11', feature: 'Queue assignment', name: 'Release queue item gate with tenant token',
      method: 'PATCH', pathName: () => `/moderator/queue/${FAKE_ID}/release`, expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-12', feature: 'User moderation', name: 'Moderator user detail gate with tenant token',
      method: 'GET', pathName: () => `/moderator/users/${ctx.userId || FAKE_ID}`, expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-13', feature: 'Room moderation', name: 'Moderator rooms gate with tenant token',
      method: 'GET', pathName: '/moderator/rooms', expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-14', feature: 'Room moderation', name: 'Moderate room gate with tenant token',
      method: 'PUT', pathName: () => `/moderator/rooms/${ctx.roomId || FAKE_ID}/moderate`, expected: 403, auth: 'tenant',
      body: () => ({ status: 'APPROVED' }),
    },
    {
      wf: 'Moderator', id: 'MOD-15', feature: 'Review moderation', name: 'Moderator review detail gate with tenant token',
      method: 'GET', pathName: () => `/moderator/reviews/${FAKE_ID}`, expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-16', feature: 'Review moderation', name: 'Moderator update review status gate with tenant token',
      method: 'PATCH', pathName: () => `/moderator/reviews/${FAKE_ID}`, expected: 403, auth: 'tenant',
      body: () => ({ status: 'APPROVED' }),
    },
    {
      wf: 'Moderator', id: 'MOD-17', feature: 'Review moderation', name: 'Moderator delete review gate with tenant token',
      method: 'DELETE', pathName: () => `/moderator/reviews/${FAKE_ID}`, expected: 403, auth: 'tenant',
    },
    {
      wf: 'Moderator', id: 'MOD-18', feature: 'Verification', name: 'Review citizen card gate with tenant token',
      method: 'PATCH', pathName: () => `/verifications/citizen-cards/${FAKE_ID}/review`, expected: 403, auth: 'tenant',
      body: () => ({ status: 'VERIFIED' }),
    },

    {
      wf: 'AI Assistant', id: 'AI-01', feature: 'Smart search', name: 'Search by text endpoint',
      method: 'GET', pathName: '/search/by-text?query=phong+tro', expected: [200, 400, 403], auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-02', feature: 'Advanced search', name: 'Advanced semantic search endpoint',
      method: 'GET', pathName: '/search/advanced?keyword=gan+truong', expected: [200, 400], auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-03', feature: 'Geo search', name: 'Nearby rooms search endpoint',
      method: 'GET', pathName: '/search/nearby?lat=21.0285&lng=105.8542', expected: [200, 400], auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-04', feature: 'POI analysis', name: 'Nearby POIs endpoint',
      method: 'GET', pathName: '/search/nearby-pois?lat=21.0285&lng=105.8542', expected: [200, 400], auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-05', feature: 'Roommate AI', name: 'Semantic roommate search endpoint',
      method: 'GET', pathName: '/roommate/search?q=sinh+vien+can+o+ghep', expected: [200, 400, 403], auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-06', feature: 'Translation', name: 'Translate valid payload',
      method: 'POST', pathName: '/translate', expected: [200, 400],
      body: () => ({ text: 'xin chao', targetLang: 'en' }),
    },
    {
      wf: 'AI Assistant', id: 'AI-07', feature: 'Translation', name: 'Translate invalid payload validation',
      method: 'POST', pathName: '/translate', expected: 400,
      body: () => ({}),
    },
    {
      wf: 'AI Assistant', id: 'AI-08', feature: 'Translation cache', name: 'Read translation cache stats',
      method: 'GET', pathName: '/translate/cache-stats', expected: 200,
    },
    {
      wf: 'AI Assistant', id: 'AI-09', feature: 'VIP discovery', name: 'Get VIP packages and cache package id',
      method: 'GET', pathName: '/vip/packages?targetRole=TENANT', expected: 200,
      capture: (response) => {
        const rows = response?.data?.data;
        if (Array.isArray(rows) && rows.length && rows[0]?.id) ctx.vipPackageId = rows[0].id;
      },
    },
    {
      wf: 'AI Assistant', id: 'AI-10', feature: 'VIP purchase', name: 'Create VIP purchase with package id',
      method: 'POST', pathName: '/vip/purchase', expected: [201, 400], auth: 'tenant',
      body: () => ({ packageId: ctx.vipPackageId || FAKE_ID }),
    },
    {
      wf: 'AI Assistant', id: 'AI-11', feature: 'VIP verify', name: 'Verify VIP purchase with placeholder order',
      method: 'GET', pathName: '/vip/verify?orderCode=123456', expected: 404, auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-12', feature: 'Smart search', name: 'Public search endpoint fallback',
      method: 'GET', pathName: '/search?query=phong', expected: [200, 400],
    },
    {
      wf: 'AI Assistant', id: 'AI-13', feature: 'CLIP diagnostics', name: 'CLIP diagnostics endpoint',
      method: 'GET', pathName: '/search/clip-diagnostics', expected: 200, auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-14', feature: 'Image search', name: 'Search by image without file should fail',
      method: 'POST', pathName: '/search/by-image', expected: [400, 403, 415, 500], auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-15', feature: 'Voice search', name: 'Transcribe without audio file should fail',
      method: 'POST', pathName: '/search/transcribe', expected: [400, 415, 500], auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-16', feature: 'Roommate AI', name: 'Top searchers by area endpoint',
      method: 'GET', pathName: '/roommate/top-searchers-by-area', expected: [200, 400], auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-17', feature: 'Roommate AI', name: 'Roommate match list endpoint',
      method: 'GET', pathName: '/roommate/matches', expected: [200, 400], auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-18', feature: 'Roommate AI', name: 'Roommate profile endpoint by fake user id',
      method: 'GET', pathName: () => `/roommate/profile/${FAKE_ID}`, expected: [200, 404], auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-19', feature: 'Recommendation', name: 'Roommate active rooms endpoint',
      method: 'GET', pathName: '/roommate/my-active-rooms', expected: [200, 400], auth: 'tenant',
    },
    {
      wf: 'AI Assistant', id: 'AI-20', feature: 'Translation cache', name: 'Translate cache stats repeatedly',
      method: 'GET', pathName: '/translate/cache-stats', expected: 200,
    },
  ];

  const results = [];

  for (const tc of cases) {
    const pathName = typeof tc.pathName === 'function' ? tc.pathName() : tc.pathName;
    const body = typeof tc.body === 'function' ? tc.body() : tc.body;
    const token = tc.auth === 'tenant' ? ctx.token : null;

    const res = await sendRequest({
      method: tc.method,
      pathName,
      token,
      body,
    });

    const passed = isExpectedStatus(res.status, tc.expected);
    const expectedText = expectedToString(tc.expected);

    const row = {
      wf: tc.wf,
      id: tc.id,
      feature: tc.feature,
      name: tc.name,
      method: tc.method,
      path: pathName,
      expected: expectedText,
      status: res.status,
      passed,
      durationMs: res.durationMs,
      executedAt: nowIso(),
      note: res.ok ? '' : res.error,
    };

    if (res.ok && res.data !== undefined) {
      row.data = res.data;
    }

    results.push(row);

    if (typeof tc.capture === 'function') {
      try {
        tc.capture(res);
      } catch (captureError) {
        row.note = row.note
          ? `${row.note}; capture error: ${captureError.message}`
          : `capture error: ${captureError.message}`;
      }
    }

    const marker = passed ? 'PASS' : 'FAIL';
    console.log(`[${marker}] ${tc.id} ${tc.method} ${pathName} -> ${res.status} (expected ${expectedText})`);
  }

  const summaryByWorkflow = {};
  for (const row of results) {
    if (!summaryByWorkflow[row.wf]) {
      summaryByWorkflow[row.wf] = { total: 0, passed: 0, failed: 0 };
    }
    summaryByWorkflow[row.wf].total += 1;
    if (row.passed) summaryByWorkflow[row.wf].passed += 1;
    else summaryByWorkflow[row.wf].failed += 1;
  }

  const payload = {
    executedAt: nowIso(),
    base: BASE_URL,
    totalCases: results.length,
    totalPassed: results.filter((r) => r.passed).length,
    totalFailed: results.filter((r) => !r.passed).length,
    summaryByWorkflow,
    results,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Saved artifact to: ${OUTPUT_PATH}`);
  console.log(`Total: ${payload.totalCases} | Passed: ${payload.totalPassed} | Failed: ${payload.totalFailed}`);
}

run().catch((error) => {
  console.error('System test workflow runner failed:', error);
  process.exitCode = 1;
});
