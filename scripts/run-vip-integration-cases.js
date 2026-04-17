#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.SYSTEM_TEST_BASE_URL || 'http://localhost:3000';
const OUTPUT = path.resolve(__dirname, '../../vip-integration-latest.json');

async function api(method, urlPath, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(`${BASE_URL}${urlPath}`, init);
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, data: { message: err.message } };
  }
}

function pass(module, id, title, passed, actualStatus, expected, details = '') {
  return { module, id, title, passed, actualStatus, expected, details };
}

async function run() {
  const seed = Date.now();
  const email = `vip_int_${seed}@example.com`;
  const password = 'System@123';

  const reg = await api('POST', '/auth/register', {
    body: { fullName: 'VIP Integration Tenant', email, password, confirmPassword: password, role: 'TENANT' },
  });
  if (reg.status !== 201) {
    throw new Error(`Cannot register test user. status=${reg.status}`);
  }

  const login = await api('POST', '/auth/login', { body: { email, password } });
  if (login.status !== 200) {
    throw new Error(`Cannot login test user. status=${login.status}`);
  }
  const token = login.data?.token || login.data?.accessToken;
  if (!token) {
    throw new Error('Missing token after login');
  }

  const results = [];

  // Module 1: View VIP packages
  const m1 = 'View VIP packages';
  const all = await api('GET', '/vip/packages');
  const allData = Array.isArray(all.data?.data) ? all.data.data : [];
  results.push(pass(m1, 1, 'Get all active VIP packages', all.status === 200, all.status, '200'));

  const tenantPk = await api('GET', '/vip/packages?targetRole=TENANT');
  const tenantData = Array.isArray(tenantPk.data?.data) ? tenantPk.data.data : [];
  const tenantRoleOk = tenantData.every((x) => x.targetRole === 'TENANT');
  results.push(pass(m1, 2, 'Filter packages by TENANT role', tenantPk.status === 200 && tenantRoleOk, tenantPk.status, '200 + all targetRole=TENANT'));

  const landlordPk = await api('GET', '/vip/packages?targetRole=LANDLORD');
  const landlordData = Array.isArray(landlordPk.data?.data) ? landlordPk.data.data : [];
  const landlordRoleOk = landlordData.every((x) => x.targetRole === 'LANDLORD');
  results.push(pass(m1, 3, 'Filter packages by LANDLORD role', landlordPk.status === 200 && landlordRoleOk, landlordPk.status, '200 + all targetRole=LANDLORD'));

  const invalidRole = await api('GET', '/vip/packages?targetRole=INVALID');
  const invalidData = Array.isArray(invalidRole.data?.data) ? invalidRole.data.data : null;
  const invalidPass = invalidRole.status === 400 || (invalidRole.status === 200 && invalidData && invalidData.length === 0);
  results.push(pass(m1, 4, 'Invalid role filter', invalidPass, invalidRole.status, '400 OR 200 with empty data'));

  // Module 2: Create VIP purchase
  const m2 = 'Create VIP purchase';
  const tenantPackage = allData.find((x) => x.targetRole === 'TENANT') || tenantData[0];
  const landlordPackage = allData.find((x) => x.targetRole === 'LANDLORD') || landlordData[0];

  const createMatch = await api('POST', '/vip/purchase', { token, body: { packageId: tenantPackage?.id || '' } });
  const createdOrderCode = createMatch.data?.data?.payment?.orderCode;
  results.push(pass(m2, 1, 'Create purchase for matching role package', createMatch.status === 201, createMatch.status, '201'));

  const createMismatch = await api('POST', '/vip/purchase', { token, body: { packageId: landlordPackage?.id || '00000000-0000-0000-0000-000000000000' } });
  results.push(pass(m2, 2, 'Reject when package role mismatch', createMismatch.status === 403, createMismatch.status, '403'));

  const createInvalid = await api('POST', '/vip/purchase', { token, body: { packageId: '00000000-0000-0000-0000-000000000000' } });
  results.push(pass(m2, 3, 'Reject invalid packageId', createInvalid.status === 400 || createInvalid.status === 404, createInvalid.status, '400/404'));

  const createNoToken = await api('POST', '/vip/purchase', { body: { packageId: tenantPackage?.id || '' } });
  results.push(pass(m2, 4, 'Reject missing token', createNoToken.status === 401, createNoToken.status, '401'));

  // Module 3: Verify VIP purchase
  const m3 = 'Verify VIP purchase';

  let verifyFromCreated = { status: 0, data: { message: 'No orderCode from create purchase' } };
  if (createdOrderCode) {
    verifyFromCreated = await api('GET', `/vip/verify?orderCode=${createdOrderCode}`, { token });
  }

  const paidActivated = verifyFromCreated.status === 200 && (
    verifyFromCreated.data?.data?.isVip === true ||
    verifyFromCreated.data?.data?.activated === true ||
    verifyFromCreated.data?.activated === true
  );
  results.push(pass(m3, 1, 'Verify paid order successfully', paidActivated, verifyFromCreated.status, '200 + activated=true', JSON.stringify(verifyFromCreated.data || {}).slice(0, 300)));

  const verifyPending = verifyFromCreated.status === 200 && !paidActivated;
  results.push(pass(m3, 2, 'Verify pending order', verifyPending, verifyFromCreated.status, '200 + not activated'));

  const verifyInvalid = await api('GET', '/vip/verify?orderCode=invalid', { token });
  results.push(pass(m3, 3, 'Verify with invalid orderCode', verifyInvalid.status === 400 || verifyInvalid.status === 404, verifyInvalid.status, '400/404'));

  const verifyNoToken = await api('GET', '/vip/verify?orderCode=123456');
  results.push(pass(m3, 4, 'Verify without token', verifyNoToken.status === 401, verifyNoToken.status, '401'));

  const summary = {};
  for (const row of results) {
    if (!summary[row.module]) summary[row.module] = { pass: 0, fail: 0, total: 0 };
    summary[row.module].total += 1;
    if (row.passed) summary[row.module].pass += 1;
    else summary[row.module].fail += 1;
  }

  const payload = {
    executedAt: new Date().toISOString(),
    base: BASE_URL,
    totals: {
      total: results.length,
      pass: results.filter((x) => x.passed).length,
      fail: results.filter((x) => !x.passed).length,
    },
    summary,
    results,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Saved: ${OUTPUT}`);
  console.log(`Total=${payload.totals.total} Pass=${payload.totals.pass} Fail=${payload.totals.fail}`);
}

run().catch((err) => {
  console.error('VIP integration run failed:', err.message);
  process.exit(1);
});
