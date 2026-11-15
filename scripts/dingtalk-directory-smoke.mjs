import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeProduction } from '../deploy/initialize-production.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/tb_crm_test_[a-z0-9_]+$/);
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const db = new PrismaClient();
const password = 'Directory-' + randomBytes(12).toString('hex');
const directory = mkdtempSync(join(tmpdir(), 'crm-dws-'));
const executable = join(directory, 'fixture-dws');
writeFileSync(executable, `#!/usr/bin/env node
const a=process.argv.slice(2); let r;
if(a[2]==='get-self')r={success:true,result:[{orgEmployeeModel:{corpId:'fixture-corp',userId:'fixture-reader',orgName:'Synthetic directory',orgUserName:'Fixture Reader'}}]};
else if(a[2]==='get-info')r={success:true,result:{deptId:1,deptName:'Synthetic directory'}};
else if(a[2]==='list-children')r={success:true,result:a[4]==='1'?[{deptId:2,deptName:'Directory sales'}]:a[4]==='2'?[{deptId:3,deptName:'Directory east'}]:[]};
else if(a[2]==='list-members')r={success:true,deptUserList:a[4]==='3'?[{userInfo:{userId:'new-person',name:'New inactive colleague'}}]:a[4]==='1'?[{userInfo:{userId:'fixture-reader',name:'Fixture Reader'}}]:[]};
else if(a[2]==='get')r={success:true,result:[{orgEmployeeModel:{orgUserId:a[4],orgUserName:a[4]==='fixture-reader'?'Fixture Reader':'New inactive colleague',orgTitle:'Sales'}}]};
else r={success:false}; console.log(JSON.stringify(r));
`, { mode: 0o700 });
const env = { ...process.env, APP_URL: 'http://localhost:3000', CRM_ACCOUNT_WORKER: 'true', DEMO_MODE: 'false', TENANT_CODE: 'DIRECTORYTEST', TENANT_NAME: 'Synthetic directory CRM', ADMIN_USERNAME: 'admin', SEED_ADMIN_PASSWORD: password,
  JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), BACKUP_KEY: randomBytes(32).toString('hex'),
  DWS_BINARY: executable, DWS_PROFILE: 'fixture-profile', DWS_EXPECTED_CORP_ID: 'fixture-corp', DWS_EXPECTED_USER_ID: 'fixture-reader',
  HOST: '127.0.0.1', PORT: process.env.DIRECTORY_SMOKE_PORT || '4142' };
const url = 'http://127.0.0.1:' + env.PORT + '/api/v1';
let checks = 0, api, log = '';
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const ok = (a, label) => { assert(a, label); checks++; };
async function call(path, token, expected = 200, body) {
  const r = await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const j = await r.json(); eq(r.status, expected, path + ' ' + String(j.message ?? '')); return j.data;
}
const base = '/integrations/dingtalk-bridge';
try {
  if (!(await db.tenant.count())) await initializeProduction(db, env);
  const tenant = await db.tenant.findFirstOrThrow({ where: { code: env.TENANT_CODE } });
  const admin = await db.user.findFirstOrThrow({ where: { tenantId: tenant.id, username: 'admin' } });
  const interrupted = await db.integrationRun.create({ data: { id: randomUUID(), tenantId: tenant.id, provider: 'dws-dingtalk', kind: 'directory', actorId: admin.id, bindingHash: '0'.repeat(64), status: 'reading' } });
  const other = await db.tenant.create({ data: { code: 'DOTHER' + randomBytes(4).toString('hex'), name: 'Other synthetic tenant', status: 'active' } });
  const role = await db.role.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'sales' } });
  const seller = await db.user.create({ data: { tenantId: tenant.id, username: 'directory-sales', name: 'Directory sales role', passwordHash: await bcrypt.hash(password, 10), roles: { create: { tenantId: tenant.id, roleId: role.id } } } });
  api = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  api.stdout.on('data', (b) => { log += b; }); api.stderr.on('data', (b) => { log += b; });
  let ready = false;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(url + '/health/ready')).ok) { ready = true; break; } } catch {} await delay(150); }
  ok(ready, 'server ready: ' + log.slice(-600));
  eq((await db.integrationRun.findUniqueOrThrow({ where: { id: interrupted.id } })).status, 'interrupted', 'restart never resumes or applies an unfinished read');
  async function login(username) { return (await call('/auth/login', undefined, 200, { tenantCode: tenant.code, username, password })).accessToken; }
  const token = await login('admin'), sales = await login(seller.username);
  await call(base, undefined, 401); await call(base, sales, 403);
  const before = await db.user.findUniqueOrThrow({ where: { id: admin.id }, include: { roles: true } });
  const initial = await call(base, token); eq(initial.bound, true, 'bound only by server');
  await call(base + '/settings', token, 400, { requestKey: randomUUID(), enabled: true, tenantId: other.id });
  const configure = { requestKey: randomUUID(), enabled: true };
  eq(await call(base + '/settings', token, 201, configure), await call(base + '/settings', token, 201, configure), 'configuration idempotency');
  const requested = { requestKey: randomUUID() };
  const run = await call(base + '/directory/preview', token, 201, requested);
  let state;
  for (let i = 0; i < 100; i++) { state = await call(base, token); if (state.runs[0].status !== 'reading') break; await delay(100); }
  eq(state.runs[0].status, 'ready', 'background preview completed'); eq(state.runs[0].snapshot.complete, true, 'complete projection');
  eq(state.runs[0].snapshot.departments.length, 3, 'nested department traversal'); eq(state.runs[0].snapshot.people.length, 2, 'root and leaf people');
  const snapshot = state.runs[0].snapshot;
  const body = { requestKey: randomUUID(), runId: run.id, departments: [{ externalId: '2', localId: null }, { externalId: '3', localId: null }],
    people: [{ externalId: 'fixture-reader', localId: admin.id, departmentExternalId: null }, { externalId: 'new-person', localId: null, departmentExternalId: '3' }] };
  const deptCount = await db.department.count({ where: { tenantId: tenant.id } });
  await call(base + '/directory/apply', token, 409, { ...body, requestKey: randomUUID(), people: [body.people[0], { ...body.people[1], departmentExternalId: 'unmapped' }] });
  eq(await db.department.count({ where: { tenantId: tenant.id } }), deptCount, 'all new departments rollback after invalid personnel');
  eq(await db.integrationMapping.count(), 0, 'all mappings rollback');
  await call(base + '/directory/apply', token, 400, { ...body, requestKey: randomUUID(), people: [] });
  const privateRun = await db.integrationRun.create({ data: { id: randomUUID(), tenantId: other.id, provider: 'dws-dingtalk', kind: 'directory', actorId: admin.id, bindingHash: initial.bindingHash, status: 'ready', snapshot } });
  await call(base + '/directory/apply', token, 409, { ...body, requestKey: randomUUID(), runId: privateRun.id });
  for (const [label, data] of [['partial', { status: 'partial' }], ['changed-binding', { bindingHash: 'f'.repeat(64) }], ['expired', { snapshot: { ...snapshot, capturedAt: '2000-01-01T00:00:00.000Z' } }]]) {
    const blocked = await db.integrationRun.create({ data: { id: randomUUID(), tenantId: tenant.id, provider: 'dws-dingtalk', kind: 'directory', actorId: admin.id, bindingHash: initial.bindingHash, status: 'ready', snapshot, ...data } });
    await call(base + '/directory/apply', token, 409, { ...body, requestKey: randomUUID(), runId: blocked.id });
    eq(await db.integrationMapping.count(), 0, label + ' leaves no crosswalks');
  }
  const [result, concurrent] = await Promise.all([call(base + '/directory/apply', token, 201, body), call(base + '/directory/apply', token, 201, body)]);
  eq(result, concurrent, 'concurrent identical request imports once');
  eq(result.createdDepartments, 2, 'created departments'); eq(result.createdPeople, 1, 'one inactive person'); eq(result.linkedPeople, 1, 'explicit self-to-admin mapping');
  eq(await call(base + '/directory/apply', token, 201, body), result, 'apply idempotency');
  await call(base + '/directory/apply', token, 409, { ...body, requestKey: randomUUID() });
  const after = await db.user.findUniqueOrThrow({ where: { id: admin.id }, include: { roles: true } });
  eq(after, before, 'existing administrator state/hash/roles/department untouched');
  const imported = await db.user.findFirstOrThrow({ where: { tenantId: tenant.id, dingtalkUserid: 'new-person' }, include: { roles: { include: { role: true } } } });
  eq(imported.status, 'inactive', 'new user cannot log in'); eq(imported.roles.map((r) => r.role.code), ['sales'], 'no imported privilege escalation');
  eq(await db.authSession.count({ where: { userId: imported.id } }), 0, 'no generated external sessions');
  eq(await db.customer.count(), 0, 'no synthetic customer imports');
  const maps = await db.integrationMapping.findMany({ where: { tenantId: tenant.id } }); eq(maps.length, 4, 'two department/two personnel crosswalks');
  eq(imported.deptId, maps.find((m) => m.kind === 'department' && m.externalId === '3').localId, 'selected primary department');
  eq((await call(base + '/directory/preview', token, 201, requested)).id, run.id, 'cached preview remains same receipt');
  await delay(250); eq((await db.integrationRun.findUniqueOrThrow({ where: { id: run.id } })).status, 'applied', 'cached preview never overwrites applied outcome');
  const pendingSnapshot = { ...snapshot, capturedAt: new Date().toISOString(), people: [...snapshot.people, { externalId: 'unassigned-person', name: 'Explicit unassigned colleague', departmentIds: ['2', '3'], position: null }] };
  const unassignedRun = await db.integrationRun.create({ data: { id: randomUUID(), tenantId: tenant.id, provider: 'dws-dingtalk', kind: 'directory', actorId: admin.id, bindingHash: initial.bindingHash, status: 'ready', snapshot: pendingSnapshot } });
  const mapped = (kind, externalId) => maps.find((m) => m.kind === kind && m.externalId === externalId).localId;
  await call(base + '/directory/apply', token, 201, { requestKey: randomUUID(), runId: unassignedRun.id, departments: body.departments.map((d) => ({ ...d, localId: mapped('department', d.externalId) })), people: [...body.people.map((p) => ({ ...p, localId: mapped('user', p.externalId) })), { externalId: 'unassigned-person', localId: null, departmentExternalId: null }] });
  const unassigned = await db.user.findFirstOrThrow({ where: { dingtalkUserid: 'unassigned-person' } });
  eq(unassigned.deptId, null, 'explicit unassigned choice does not invent primary department'); eq(unassigned.status, 'inactive', 'unassigned account remains inactive');
  const c = (await call(base, token)).connection;
  await call(base + '/settings', token, 201, { requestKey: randomUUID(), enabled: false, expectedUpdatedAt: c.updatedAt });
  await call(base + '/directory/preview', token, 409, { requestKey: randomUUID() });
  const schema = await call(base + '/schema', token); eq(schema.length, 4, 'stable capability contracts');
  eq(await db.auditLog.count({ where: { tenantId: tenant.id, action: 'integration.dingtalk.directory.apply@1.0' } }), 2, 'one audit per successful batch, no duplicate concurrent audit');
  console.log(JSON.stringify({ result: 'PASS', checks, externalProtocol: 'fixture CLI, no real DingTalk writes', database: new URL(process.env.DATABASE_URL).pathname }));
} finally { api?.kill('SIGTERM'); await db.$disconnect(); }
