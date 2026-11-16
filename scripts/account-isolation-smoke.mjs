import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { LocalAccountStore, accountServer } from '../deploy/local-accounts.mjs';
import { populateTestCompany } from './seed-test-company.mjs';
import { verifyTestCompany } from './verify-test-company.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert(process.env.ACCOUNT_ROOT_DATABASE_URL, 'Set an explicit MySQL provisioning connection for the isolated test');
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const dir = mkdtempSync(join(tmpdir(), 'crm-account-test-'));
const store = await new LocalAccountStore({
  dir,
  rootUrl: process.env.ACCOUNT_ROOT_DATABASE_URL,
  webPort: 3019,
  basePort: 4510,
  test: true,
  sqlAccountHost: process.env.ACCOUNT_TEST_MYSQL_HOST || '127.0.0.1',
}).init();
let server,
  checks = 0;
const eq = (a, b, label) => {
  assert.deepEqual(a, b, label);
  checks++;
};
try {
  const a = await store.create({ code: 'COMPANY_A', name: 'Company A synthetic isolation test' });
  const b = await store.create({ code: 'COMPANY_B', name: 'Company B synthetic isolation test' });
  assert.notEqual(a.account.database, b.account.database);
  assert.notEqual(a.account.dbUser, b.account.dbUser);
  checks += 2;
  const ca = store.config('COMPANY_A').config,
    cb = store.config('COMPANY_B').config;
  assert.notEqual(ca.JWT_SECRET, cb.JWT_SECRET);
  checks++;
  const da = new PrismaClient({ datasourceUrl: ca.DATABASE_URL }),
    db = new PrismaClient({ datasourceUrl: cb.DATABASE_URL });
  try {
    for (const client of [da, db]) {
      for (const table of [
        'customer',
        'opportunity',
        'contract',
        'order',
        'project',
        'paymentPlan',
        'receipt',
        'followUp',
        'actionPlan',
        'invoice',
      ])
        eq(await client[table].count(), 0, 'empty business table ' + table);
      eq(await client.user.count(), 1, 'initial admin only');
      eq(await client.role.count(), 4, 'four roles');
    }
    await da.customer.create({
      data: { tenantId: 1, code: 'SYNTHETIC', name: 'Account A test-only customer', ownerId: 1, poolType: 'private' },
    });
    eq(await db.customer.count(), 0, 'other database remains empty');
    await assert.rejects(da.$queryRawUnsafe(`SELECT COUNT(*) FROM \`${b.account.database}\`.customers`));
    checks++;
    await assert.rejects(db.$queryRawUnsafe(`SELECT COUNT(*) FROM \`${a.account.database}\`.customers`));
    checks++;
  } finally {
    await da.$disconnect();
    await db.$disconnect();
  }
  await assert.rejects(store.create({ code: 'COMPANY_A', name: 'Do not overwrite' }));
  checks++;
  await store.startAll();
  server = accountServer(store);
  await new Promise((done) => server.listen(store.webPort, '127.0.0.1', done));
  async function call(code, path, method = 'GET', body, token) {
    const r = await fetch('http://127.0.0.1:' + store.webPort + '/api/v1' + path, {
      method,
      headers: {
        'X-Company-Code': code,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  }
  const la = await call('COMPANY_A', '/auth/login', 'POST', {
    tenantCode: 'COMPANY_A',
    username: 'admin',
    password: a.initialPassword,
  });
  eq(la.status, 200, 'A login');
  const lb = await call('COMPANY_B', '/auth/login', 'POST', {
    tenantCode: 'COMPANY_B',
    username: 'admin',
    password: b.initialPassword,
  });
  eq(lb.status, 200, 'B login');
  const aToken = la.body.data.accessToken,
    bToken = lb.body.data.accessToken;
  eq((await call('COMPANY_B', '/workspace/overview', 'GET', undefined, aToken)).status, 401, 'A token cannot enter B');
  eq((await call('COMPANY_A', '/workspace/overview', 'GET', undefined, bToken)).status, 401, 'B token cannot enter A');
  eq(
    (
      await call('COMPANY_B', '/auth/login', 'POST', {
        tenantCode: 'COMPANY_B',
        username: 'admin',
        password: a.initialPassword,
      })
    ).status,
    401,
    'A password cannot enter B',
  );
  const ra = await call('COMPANY_A', '/analytics/forecast?year=2026', 'GET', undefined, aToken);
  const rb = await call('COMPANY_B', '/analytics/collections?year=2026', 'GET', undefined, bToken);
  eq(ra.status, 200, 'A reporting ready');
  eq(rb.status, 200, 'B reporting ready');
  eq(rb.body.data.summary.received, '0.00', 'B clean cash');
  eq(
    (await call('UNREGISTERED', '/workspace/overview', 'GET', undefined, aToken)).status,
    400,
    'unregistered database rejected',
  );
  await store.create({ code: 'TEST', name: 'Persistent fixture workflow in isolated CI database', purpose: 'test' });
  await store.start('TEST');
  const fixtures = await populateTestCompany({ dir, url: 'http://127.0.0.1:' + store.webPort });
  eq(fixtures.result, 'PASS', 'rich test company workflow completes');
  eq(fixtures.counts.approvalFlow, 4, 'four published workflow templates');
  eq(fixtures.counts.customer, 33, 'rich synthetic customer pipeline');
  eq(fixtures.counts.user, 9, 'four roles and independent teams');
  const repeat = await populateTestCompany({ dir, url: 'http://127.0.0.1:' + store.webPort });
  eq(repeat.result, 'ALREADY_INITIALIZED', 'repeat fixture run never overwrites test edits');
  eq(repeat.counts, fixtures.counts, 'repeat fixture run does not multiply records');
  const verified = await verifyTestCompany({ dir, url: 'http://127.0.0.1:' + store.webPort });
  eq(verified.result, 'PASS', 'fixture relationships, money and role scopes');
  console.log(
    JSON.stringify({
      result: 'PASS',
      checks,
      isolation: 'separate database + user + signing keys + worker',
      fixtures: 'test-only databases',
      registry: dir,
    }),
  );
} finally {
  if (server) await new Promise((done) => server.close(done));
  await store.stop();
}
