import { verifyAgentReports } from './agent-report-scenarios.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeProduction } from '../deploy/initialize-production.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/tb_crm_test_[a-z0-9_]+$/);
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const db = new PrismaClient();
const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const password = 'Analytics-' + randomBytes(12).toString('hex');
const env = { ...process.env, DEMO_MODE: 'false', TENANT_CODE: 'ANALYTICSTEST', TENANT_NAME: 'Analytics synthetic test', ADMIN_USERNAME: 'admin', SEED_ADMIN_PASSWORD: password,
  APP_URL: 'http://localhost:3000', JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), BACKUP_KEY: randomBytes(32).toString('hex') };
let api, checks = 0, log = '';
const ok = (value, label) => { assert(value, label); checks++; };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const url = 'http://127.0.0.1:' + (process.env.ANALYTICS_SMOKE_PORT || '4137') + '/api/v1';
async function call(path, token, expected = 200, body) {
  const r = await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const j = await r.json(); if(r.status !== expected)console.error(log); eq(r.status, expected, path); return j.data;
}
try {
  if (!(await db.tenant.count())) await initializeProduction(db, env);
  const tenant = await db.tenant.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const tid = tenant.id;
  const deptA = await db.department.create({ data: { tenantId: tid, code: 'ARA' + suffix, name: 'Report A' } });
  const deptB = await db.department.create({ data: { tenantId: tid, code: 'ARB' + suffix, name: 'Report B' } });
  const hash = await bcrypt.hash(password, 10);
  async function user(code, deptId, username) {
    const role = await db.role.findFirstOrThrow({ where: { tenantId: tid, code } });
    return db.user.create({ data: { tenantId: tid, username: username + suffix, name: username, deptId, passwordHash: hash, roles: { create: { tenantId: tid, roleId: role.id } } } });
  }
  const a = await user('sales', deptA.id, 'reportSales');
  const b = await user('sales', deptB.id, 'reportOther');
  const manager = await user('sales_manager', deptA.id, 'reportManager');
  const admin = await user('super_admin', deptA.id, 'reportAdmin');
  const boss = await user('gm', deptA.id, 'reportBoss');
  const customer = await db.customer.create({ data: { tenantId: tid, code: 'AC' + suffix, name: 'Synthetic analytics A', ownerId: a.id, poolType: 'private' } });
  const customerB = await db.customer.create({ data: { tenantId: tid, code: 'BC' + suffix, name: 'Synthetic analytics B', ownerId: b.id, poolType: 'private' } });
  const stage = await db.opportunityStage.create({ data: { tenantId: tid, code: 'astage' + suffix, name: 'Synthetic 50%', probability: 50, sortOrder: 999 } });
  const future = new Date('2059-07-01');
  const makeOpp = (code, ownerId, customerId, extra = {}) => db.opportunity.create({ data: { tenantId: tid, code: code + suffix, name: 'Synthetic ' + code, ownerId, customerId, amount: '100.01', stage: stage.code, expectedCloseDate: future, ...extra } });
  await makeOpp('AO', a.id, customer.id);
  await makeOpp('AW', a.id, customer.id, { status: 'won', amount: '200', closedAt: new Date('2059-06-01') });
  await makeOpp('AL', a.id, customer.id, { status: 'lost', amount: '999', closedAt: new Date('2059-06-01') });
  await makeOpp('AU', a.id, customer.id, { expectedCloseDate: null });
  await makeOpp('BO', b.id, customerB.id, { amount: '999999' });
  const contract = await db.contract.create({ data: { tenantId: tid, contractNo: 'AR' + suffix, name: 'Synthetic report contract', customerId: customer.id, ownerId: a.id, contractType: 'implementation', amount: '100', status: 'signed', signDate: future } });
  await db.paymentPlan.create({ data: { tenantId: tid, contractId: contract.id, planNo: 'AP' + suffix, amount: '100', receivedAmount: '40', outstandingAmount: '60', dueDate: future, status: 'partial' } });
  const usd = await db.contract.create({ data: { tenantId: tid, contractNo: 'AU' + suffix, name: 'Synthetic USD excluded', customerId: customer.id, ownerId: a.id, contractType: 'implementation', currency: 'USD', amount: '10000', status: 'signed' } });
  async function receipt(code, amount, extra = {}) {
    return db.receipt.create({ data: { tenantId: tid, customerId: customer.id, contractId: contract.id, receiptNo: code + suffix, amount, allocatedAmount: '0', unallocatedAmount: amount, receiptDate: future, status: 'confirmed', ledgerManaged: true, ...extra } });
  }
  await receipt('RC', '50', { allocatedAmount: '40', unallocatedAmount: '10' });
  await receipt('RD', '700', { status: 'draft' }); await receipt('RV', '800', { status: 'voided' });
  await receipt('RL', '900', { ledgerManaged: false }); await receipt('RU', '11', { contractId: null }); await receipt('RX', '10000', { contractId: usd.id });
  const otherTenant = await db.tenant.create({ data: { code: 'AX' + suffix, name: 'Other analytics tenant', status: 'active' } });
  const otherRole = await db.role.create({ data: { tenantId: otherTenant.id, code: 'super_admin', name: 'Synthetic admin', dataScope: 'all', permissions: ['*'] } });
  const alien = await db.user.create({ data: { tenantId: otherTenant.id, username: 'alien', name: 'Synthetic alien', passwordHash: hash, roles: { create: { tenantId: otherTenant.id, roleId: otherRole.id } } } });
  const foreignCustomer = await db.customer.create({ data: { tenantId: otherTenant.id, code: 'X', name: 'Foreign customer', ownerId: alien.id } });
  await db.opportunity.create({ data: { tenantId: otherTenant.id, code: 'X', name: 'Forbidden foreign record', customerId: foreignCustomer.id, ownerId: alien.id, amount: '777777', expectedCloseDate: future } });
  api = spawn(process.execPath, ['apps/api/dist/main.js'], { env: { ...env, PORT: process.env.ANALYTICS_SMOKE_PORT || '4137', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  api.stdout.on('data', (b) => { log = (log + b).slice(-6000); }); api.stderr.on('data', (b) => { log = (log + b).slice(-6000); });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { ready = (await fetch(url + '/health/ready')).ok; } catch {} if (ready) break; if (api.exitCode !== null) throw new Error(log); await delay(150); }
  ok(ready, 'API ready');
  const login = async (u, tenantCode = tenant.code) => (await call('/auth/login', undefined, 200, { tenantCode, username: u.username, password })).accessToken;
  const [at, bt, mt, adt, gt, xt] = await Promise.all([login(a), login(b), login(manager), login(admin), login(boss), login(alien, otherTenant.code)]);
  await call('/analytics/forecast?year=2059', undefined, 401);
  const f = await call('/analytics/forecast?year=2059', at);
  eq(f.summary.open, '100.01', 'own open only'); eq(f.summary.weighted, '50.01', 'exact projection'); eq(f.summary.won, '200.00', 'won not double counted'); eq(f.summary.winRate, '50.0', 'won / closed');
  eq((await call('/analytics/forecast?year=2059&bucket=won', at)).details.items.length, 1, 'won drill');
  await call('/analytics/forecast?year=2059&ownerId=' + b.id, at, 403);
  await call('/analytics/forecast?year=2059&deptId=' + deptB.id, mt, 403);
  eq((await call('/analytics/forecast?year=2059&deptId=' + deptA.id, mt)).summary.open, '100.01', 'manager team');
  await call('/analytics/forecast?year=2059&ownerId=' + a.id, bt, 403);
  await call('/analytics/forecast?year=2059&ownerId=' + a.id, xt, 403);
  await call('/analytics/forecast?year=2059&tenantId=' + otherTenant.id, at, 400);
  await call('/analytics/forecast?year=2059&pageSize=101', at, 400);
  const cash = await call('/analytics/collections?year=2059', at);
  eq(cash.summary.received, '50.00', 'personal cash excludes unbound'); eq(cash.summary.currentAllocatedOfReceipts, '40.00', 'allocation separate'); eq(cash.summary.currentUnallocatedOfReceipts, '10.00', 'unallocated separate');
  eq(cash.summary.currentOutstanding, '60.00', 'balance not duplicate receipt'); eq(cash.summary.unboundReceived, '0.00', 'unbound excluded from personal reports'); eq(cash.excludedCurrencyContracts, 1, 'currency separation');
  eq(cash.matrix.items[0].months[6].received, '50.00', 'contract month cash'); eq(cash.monthly[6].received, '50.00', 'personal month excludes unbound');
  eq(cash.owners.find((u) => u.ownerId === a.id).received, '50.00', 'sales attribution excludes unbound');
  for (const token of [at, mt, adt, gt]) eq((await call('/analytics/collections?year=2059&ownerId=' + a.id, token)).summary.received, '50.00', 'four role scoped totals');
  eq((await call('/analytics/collections?year=2059&source=legacy', at)).summary.received, '900.00', 'legacy separate');
  await call('/analytics/collections?year=2059&ownerId=' + a.id, xt, 403);
  const schemas = await call('/analytics/schema', at); eq(schemas.length, 2, 'versioned report catalog');
  const options = await call('/analytics/options', mt); ok(!options.owners.some((u) => u.id === b.id), 'no other-team options');
  for (const token of [mt, adt, gt]) {
    const own = await call('/analytics/forecast?year=2059', token);
    eq(own.summary.open, '0.00', 'even managers and admins default self');
    eq(own.audience.personRange, 'self');
    eq((await call('/workspace/overview?from=2059-01-01&to=2059-12-31', token)).openOpportunities, 0, 'dashboard default self');
  }
  for (const token of [adt, gt]) {
    eq((await call('/analytics/forecast?year=2059&personRange=company', token)).summary.open, '1000099.01', 'company explicitly authorized');
    eq((await call('/analytics/collections?year=2059&personRange=company', token)).summary.received, '61.00', 'company includes unbound once');
  }
  for (const path of ['/analytics/forecast?year=2059&personRange=company', '/analytics/collections?year=2059&personRange=company', '/workspace/overview?personRange=company', '/workspace/opportunities?personRange=company']) await call(path, at, 403);
  await call('/analytics/forecast?year=2059&personRange=person', adt, 400);
  await call('/analytics/forecast?year=2059&personRange=self&ownerId='+b.id, adt, 400);
  await call('/workspace/opportunities?personRange=person&ownerId='+b.id, at, 403);
  const list = await call('/workspace/opportunities?personRange=person&ownerId='+a.id+'&from=2059-01-01&to=2059-12-31', adt);
  eq(list.meta.total, 3, 'drilldown preserves selected owner/date');
  eq(list.items.every(r=>r.ownerId===a.id), true);
  eq((await call('/workspace/overview?personRange=person&ownerId='+a.id+'&from=2059-01-01&to=2059-12-31', adt)).pipeline, '100.01', 'dashboard person matches report');
  const selfOptions = await call('/workspace/statistics-options', at);
  eq(selfOptions.owners.map(u=>u.id), [a.id]);eq(selfOptions.canCompany,false);eq(selfOptions.departments,[]);
  const adminOptions = await call('/workspace/statistics-options', adt);
  eq(adminOptions.defaultRange,'self');eq(adminOptions.canCompany,true);
  const delegatedReports = await verifyAgentReports({db,url,actors:[{token:at,userId:a.id},{token:mt,userId:manager.id},{token:adt,userId:admin.id},{token:gt,userId:boss.id}],owner:a,outsider:b,password,hash,tenantId:tid,deptId:deptA.id,alienToken:xt});
  await db.opportunity.createMany({ data: Array.from({ length: 10001 }, (_, i) => ({ tenantId: tid, code: 'B' + suffix + i, name: 'Synthetic bounded query', ownerId: b.id, customerId: customerB.id, stage: stage.code, amount: '0.01', expectedCloseDate: future })) });
  await call('/analytics/forecast?year=2059', bt, 400);
  await db.user.update({ where: { id: a.id }, data: { status: 'inactive' } });
  const revoked = await fetch(url + '/analytics/forecast?year=2059', { headers: { Authorization: 'Bearer ' + at } }); ok([401, 403].includes(revoked.status), 'revoked principal denied');
  console.log(JSON.stringify({ result: 'PASS', checks, delegatedReports, database: new URL(process.env.DATABASE_URL).pathname, fixtures: 'synthetic only', port: process.env.ANALYTICS_SMOKE_PORT || '4137' }));
} finally { api?.kill('SIGTERM'); await db.$disconnect(); }
