import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeProduction } from '../deploy/initialize-production.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/tb_crm_test_[a-z0-9_]+$/);
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client'), bcrypt = require('bcrypt');
const db = new PrismaClient(), password = 'Access-' + randomBytes(12).toString('hex');
const env = { ...process.env, CRM_ACCOUNT_WORKER: 'true', APP_URL: 'http://localhost:4144', DEMO_MODE: 'false', TENANT_CODE: 'ACCESSTEST', TENANT_NAME: '【测试】权限与分配验证', ADMIN_USERNAME: 'admin', SEED_ADMIN_PASSWORD: password, JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex'), BACKUP_KEY: randomBytes(32).toString('hex'), HOST: '127.0.0.1', PORT: process.env.ACCESS_SMOKE_PORT || '4143' };
let api, log = '', checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const ok = (value, label) => { assert(value, label); checks++; };
const base = 'http://127.0.0.1:' + env.PORT + '/api/v1';
function sql(statement) {
  const url = new URL(process.env.DATABASE_URL);
  execFileSync(process.env.MYSQL_BIN || 'mysql', ['--no-defaults', '--protocol=TCP', '--host=' + url.hostname, '--port=' + (url.port || '3306'), '--user=' + decodeURIComponent(url.username), '--database=' + url.pathname.slice(1), '--execute=' + statement], { env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) }, encoding: 'utf8' });
}
async function call(path, token, expected = 200, body, method) {
  const r = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const j = await r.json(); if (expected === null) return { status: r.status, data: j.data };
  eq(r.status, expected, path + ': ' + String(j.message ?? '')); return j.data;
}
try {
  await initializeProduction(db, env);
  const tenant = await db.tenant.findFirstOrThrow({ where: { code: env.TENANT_CODE } }), tid = tenant.id;
  const hash = await bcrypt.hash(password, 10);
  const departments = await Promise.all(['华东', '华南'].map((name) => db.department.create({ data: { tenantId: tid, name: '【测试】' + name } })));
  async function user(username, roleCode, deptId, status = 'active') {
    const role = await db.role.findFirstOrThrow({ where: { tenantId: tid, code: roleCode } });
    return db.user.create({ data: { tenantId: tid, username, name: '【测试】' + username, passwordHash: hash, deptId, status, roles: { create: { tenantId: tid, roleId: role.id } } } });
  }
  const a = await user('sales_a', 'sales', departments[0].id), a2 = await user('sales_a2', 'sales', departments[0].id), b = await user('sales_b', 'sales', departments[1].id), manager = await user('manager', 'sales_manager', departments[0].id), boss = await user('boss', 'gm', departments[0].id);
  const inactive = await user('inactive', 'sales', departments[0].id, 'inactive'), noDepartment = await user('no_department', 'sales', null);
  const admin = await db.user.findFirstOrThrow({ where: { tenantId: tid, username: 'admin' } });
  async function customer(name, ownerId) { return db.customer.create({ data: { tenantId: tid, code: 'CA' + randomBytes(5).toString('hex'), name: '【测试】' + name, ownerId, poolType: ownerId ? 'private' : 'public' } }); }
  const ca = await customer('华东销售A客户', a.id), ca2 = await customer('华东销售B客户', a2.id), cb = await customer('华南销售客户', b.id), publicCustomer = await customer('公海未分配', null), linked = await customer('含商机须整体交接', a.id);
  await db.opportunity.create({ data: { tenantId: tid, customerId: linked.id, ownerId: a.id, code: 'OP' + randomBytes(5).toString('hex'), name: '【测试】关联商机', stage: 'new', amount: '100.00' } });
  const foreignLead = await db.lead.create({ data: { tenantId: tid, code: 'LE' + randomBytes(5).toString('hex'), companyName: '【测试】华南线索', source: 'test', assigneeId: b.id, createdBy: b.id } });
  const foreignProject = await db.project.create({ data: { tenantId: tid, projectNo: 'PR' + randomBytes(5).toString('hex'), name: '【测试】华南已完项目', customerId: cb.id, pmId: b.id, salesOwnerId: b.id, status: 'completed', plannedStartDate: new Date('2026-01-01'), plannedEndDate: new Date('2026-02-01') } });
  const foreignTask = await db.projectTask.create({ data: { tenantId: tid, projectId: foreignProject.id, title: '【测试】华南已完任务', assigneeId: b.id, status: 'done' } });
  const foreignContact = await db.contact.create({ data: { tenantId: tid, customerId: cb.id, name: '【测试】华南联系人' } });
  api = spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  api.stdout.on('data', (b) => { log += b; }); api.stderr.on('data', (b) => { log += b; });
  let ready = false;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/health/ready')).ok) { ready = true; break; } } catch {} await delay(150); }
  ok(ready, 'server ready: ' + log.slice(-600));
  const login = async (username) => (await call('/auth/login', undefined, 200, { tenantCode: tenant.code, username, password })).accessToken;
  const token = await login('admin'); let at = await login(a.username), a2t = await login(a2.username), bt = await login(b.username), mt = await login(manager.username); const gt = await login(boss.username);
  const configPath = '/system/access-policy';
  await call(configPath, undefined, 401); await call(configPath, at, 403); await call(configPath, gt, 403);
  const state = await call(configPath, token), salesRole = state.roles.find((r) => r.code === 'sales'), managerRole = state.roles.find((r) => r.code === 'sales_manager');
  const defaultSales = salesRole.configuredPoints, defaultManager = managerRole.configuredPoints;
  const ownedSales = await call('/system/users/' + a.id, token);
  for (const data of [{ status: 'inactive' }, { deptId: departments[1].id }, { roleIds: [state.roles.find((r) => r.code === 'gm').id] }])
    await call('/system/users/' + a.id, token, 409, { requestKey: randomUUID(), expectedUpdatedAt: ownedSales.updatedAt, data }, 'PUT');
  const save = async (code, scope, permissions, expected = 201) => { const r = (await call(configPath, token)).roles.find((r) => r.code === code); return call(configPath + '/roles/' + r.id, token, expected, { requestKey: randomUUID(), expectedUpdatedAt: r.updatedAt, dataScope: scope, permissions }); };
  const names = async (t) => (await call('/workspace/customers', t)).items.map((c) => c.name);
  ok(!(await names(at)).includes(cb.name), 'self scope does not reveal another team');
  ok(!(await names(at)).includes(ca2.name), 'self scope does not reveal colleague');
  await save('sales', 'dept', defaultSales);
  await call('/workspace/customers', at, 401); await call('/workspace/customers', a2t, 401); await call('/workspace/customers', bt, 401);
  at = await login(a.username); a2t = await login(a2.username); bt = await login(b.username);
  ok((await names(at)).includes(ca2.name), 'configured department scope applies to sales'); ok(!(await names(at)).includes(cb.name), 'department boundary remains');
  await save('sales', 'all', defaultSales); at = await login(a.username);
  ok((await names(at)).includes(cb.name), 'configured company scope applies');
  for (const [kind, record] of [['leads', foreignLead], ['projects', foreignProject], ['tasks', foreignTask], ['contacts', foreignContact]])
    ok((await call('/workspace/' + kind, at)).items.some((r) => r.id === record.id), 'company scope covers ' + kind + ', including empty-OR policy cases');
  ok((await call('/analytics/options', at)).owners.some((u) => u.id === b.id), 'report filter follows configured company scope');
  const tool = await call('/capabilities/customer.search/invoke', at, 201, { keyword: cb.name, pageSize: 10 });
  ok(JSON.stringify(tool.result).includes(cb.name), 'agent adapter uses same company scope');
  await save('sales', 'self', defaultSales); at = await login(a.username);
  ok(!(await names(at)).includes(cb.name), 'narrowing immediately removes foreign customer');
  for (const [kind, record] of [['leads', foreignLead], ['projects', foreignProject], ['tasks', foreignTask], ['contacts', foreignContact]])
    ok(!(await call('/workspace/' + kind, at)).items.some((r) => r.id === record.id), 'self scope hides foreign ' + kind);
  const minimal = ['customer:read', 'customer:create', 'customer:update', 'pool:claim', 'pool:return'];
  await save('sales', 'self', minimal); at = await login(a.username);
  await call('/workspace/opportunities', at, 403); await call('/analytics/forecast?year=2026', at, 403);
  const overview = await call('/workspace/overview', at); ok(overview.restrictedModules.includes('opportunities'), 'dashboard omits unauthorized module instead of leaking totals');
  const profile = await call('/auth/me', at); ok(!profile.permissions.includes('opportunity:*'), 'effective profile excludes removed functions');
  const personPolicy = await call(configPath + '/people/' + a.id, token);
  eq(personPolicy.permissions, profile.permissions, 'person inspector and login use identical effective authority'); eq(personPolicy.dataScope, profile.dataScope, 'person inspector has actual scope'); eq(personPolicy.assignedCustomers, 2, 'person inspector shows current customer ownership');
  await call(configPath + '/people/' + a.id, at, 403);
  await save('sales', 'self', defaultSales); at = await login(a.username); a2t = await login(a2.username);
  await save('sales', 'self', ['*'], 400); await save('sales', 'self', ['customer:update'], 400);
  const frozen = state.roles.find((r) => r.code === 'super_admin'); await call(configPath + '/roles/' + frozen.id, token, 400, { requestKey: randomUUID(), expectedUpdatedAt: frozen.updatedAt, dataScope: 'self', permissions: [] });
  await call(configPath + '/roles/' + salesRole.id, token, 409, { requestKey: randomUUID(), expectedUpdatedAt: salesRole.updatedAt, dataScope: 'self', permissions: defaultSales });
  const other = await db.tenant.create({ data: { code: 'OTHERACCESS', name: '【测试】另一公司', status: 'active' } });
  const otherRole = await db.role.create({ data: { tenantId: other.id, code: 'sales', name: 'Other role', dataScope: 'self', permissions: [] } });
  await call(configPath + '/roles/' + otherRole.id, token, 404, { requestKey: randomUUID(), expectedUpdatedAt: otherRole.updatedAt.toISOString(), dataScope: 'self', permissions: defaultSales });
  const makeBody = (records, userId = a2.id) => ({ records: records.map((r) => ({ id: r.id, expectedUpdatedAt: r.updatedAt.toISOString() })), userId, reason: '【测试】客户分配闭环' });
  const batch = makeBody([publicCustomer, ca]);
  await call('/customer-allocation/preview', at, 403, batch);
  await call('/customer-allocation/preview', mt, 400, makeBody([publicCustomer], b.id));
  await call('/customer-allocation/preview', token, 400, makeBody([publicCustomer], inactive.id));
  await call('/customer-allocation/preview', token, 400, makeBody([publicCustomer], noDepartment.id));
  await call('/customer-allocation/preview', token, 400, { ...batch, actorId: admin.id });
  await call('/customer-allocation/preview', token, 400, { ...batch, records: [...batch.records, batch.records[0]] });
  const preview = await call('/customer-allocation/preview', token, 201, batch); eq(preview.count, 2, 'preview covers two customers'); eq((await db.customer.findUniqueOrThrow({ where: { id: ca.id } })).ownerId, a.id, 'preview changes no ownership');
  await call('/customer-allocation/commit', token, 409, { ...makeBody([publicCustomer, linked]), requestKey: randomUUID() });
  eq((await db.customer.findUniqueOrThrow({ where: { id: publicCustomer.id } })).ownerId, null, 'late linked-customer failure rolls back earlier assignment'); eq(await db.privateHolding.count({ where: { customerId: publicCustomer.id } }), 0, 'holding also rolled back');
  const commit = { ...batch, requestKey: randomUUID() };
  const [one, two] = await Promise.all([call('/customer-allocation/commit', token, 201, commit), call('/customer-allocation/commit', token, 201, commit)]); eq(one, two, 'concurrent batch is idempotent'); eq(one.count, 2, 'both assigned');
  for (const row of [publicCustomer, ca]) { const saved = await db.customer.findUniqueOrThrow({ where: { id: row.id } }); eq(saved.ownerId, a2.id, 'owner assigned'); eq(saved.ownerDeptId, departments[0].id, 'owner department follows person'); eq(await db.privateHolding.count({ where: { customerId: row.id, userId: a2.id } }), 1, 'exactly one holding'); }
  eq(await db.auditLog.count({ where: { tenantId: tid, action: 'customer.allocation.batch@1.0' } }), 1, 'one committed audit');
  await call('/customer-allocation/commit', token, 409, { ...commit, requestKey: randomUUID() });
  await call('/customer-allocation/commit', token, 409, { ...commit, reason: '【测试】换参重放拒绝' });
  ok(!(await names(at)).includes(ca.name), 'former sales loses former ownership access'); ok((await names(a2t)).includes(ca.name), 'new owner sees assigned customer');
  eq((await call('/customer-allocation/history', token))[0].items.length, 2, 'visible history includes batch evidence');
  const single = await customer('客户页单条分配证据', null);
  const singleResult = await call('/workspace/customers/' + single.id + '/assign', token, 201, { requestKey: randomUUID(), expectedUpdatedAt: single.updatedAt.toISOString(), userId: a2.id });
  eq(singleResult.assignment.toUserId, a2.id, 'original customer action uses the same guarded assignment service');
  ok((await call('/customer-allocation/history', token)).some((h) => h.items.some((i) => i.id === single.id)), 'single-action evidence appears in assignment history');
  const managerCustomer = await customer('主管分配后收窄范围', null);
  const managerCommit = { ...makeBody([managerCustomer]), requestKey: randomUUID() };
  await call('/customer-allocation/commit', mt, 201, managerCommit);
  eq((await call('/customer-allocation/history', mt)).length, 1, 'manager sees own visible batch');
  await save('sales_manager', 'dept', defaultManager.filter((p) => p !== 'customer:assign')); await call('/customer-allocation/people', mt, 401); mt = await login(manager.username); await call('/customer-allocation/people', mt, 403);
  await save('sales_manager', 'self', defaultManager); mt = await login(manager.username); ok(!(await names(mt)).includes(ca2.name), 'configured manager self scope is genuinely narrow');
  eq((await call('/customer-allocation/history', mt)).length, 0, 'history does not reveal now-hidden customer names');
  await call('/customer-allocation/commit', mt, 404, managerCommit);
  await save('sales_manager', 'dept', defaultManager);
  const approval = await db.approval.create({ data: { tenantId: tid, approvalNo: 'AP' + randomBytes(5).toString('hex'), bizType: 'general', bizId: 0, title: '【测试】待处理审批阻断', applicantId: admin.id, nodes: { create: { tenantId: tid, nodeOrder: 1, nodeName: '待处理', approverId: a.id } } } });
  await save('sales', 'all', defaultSales, 409); await db.approval.update({ where: { id: approval.id }, data: { status: 'withdrawn' } });
  const activeProject = await db.project.create({ data: { tenantId: tid, projectNo: 'PR' + randomBytes(5).toString('hex'), name: '【测试】交付责任保护', customerId: ca2.id, pmId: a2.id, salesOwnerId: a2.id, status: 'active', plannedStartDate: new Date('2026-11-01'), plannedEndDate: new Date('2026-12-31') } });
  await save('sales', 'self', defaultSales.filter((p) => p !== 'project:update'), 409);
  await db.project.update({ where: { id: activeProject.id }, data: { status: 'completed' } });
  sql("CREATE TRIGGER access_revoke_failure BEFORE UPDATE ON auth_sessions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic permission revoke failure'");
  try { await save('sales', 'all', defaultSales, 500); } finally { sql('DROP TRIGGER access_revoke_failure'); }
  eq((await db.role.findUniqueOrThrow({ where: { id: salesRole.id } })).dataScope, 'self', 'revocation failure rolls back role change');
  const handover = await call('/commercial/customers/' + linked.id + '/handover/preview', token, 201, { userId: a2.id });
  await call('/commercial/customers/' + linked.id + '/handover', token, 201, { requestKey: randomUUID(), userId: a2.id, expectedUpdatedAt: handover.expectedUpdatedAt, digest: handover.digest, reason: '【测试】停用前销售归属交接' });
  let employee = await call('/system/users/' + a.id, token);
  await call('/auth/me', at);
  await call('/system/users/' + a.id, token, 200, { requestKey: randomUUID(), expectedUpdatedAt: employee.updatedAt, data: { status: 'inactive' } }, 'PUT');
  await call('/auth/me', at, 401);
  employee = await call('/system/users/' + a.id, token);
  await call('/system/users/' + a.id, token, 200, { requestKey: randomUUID(), expectedUpdatedAt: employee.updatedAt, data: { status: 'active' } }, 'PUT');
  const racingSales = await user('racing_sales', 'sales', departments[0].id), racingCustomer = await customer('分配与停用并发', null);
  const racingUserRow = await call('/system/users/' + racingSales.id, token);
  const raced = await Promise.all([
    call('/customer-allocation/commit', token, null, { ...makeBody([racingCustomer], racingSales.id), requestKey: randomUUID() }),
    call('/system/users/' + racingSales.id, token, null, { requestKey: randomUUID(), expectedUpdatedAt: racingUserRow.updatedAt, data: { status: 'inactive' } }, 'PUT'),
  ]);
  ok([201, 400, 409].includes(raced[0].status), 'assignment race has a declared business result');
  ok([200, 409].includes(raced[1].status), 'offboarding race has a declared business result');
  ok(raced.some((r) => [200, 201].includes(r.status)), 'one serialized concurrent operation succeeds');
  const racingSaved = await db.customer.findUniqueOrThrow({ where: { id: racingCustomer.id } }), racingPerson = await db.user.findUniqueOrThrow({ where: { id: racingSales.id } });
  ok(racingSaved.ownerId !== racingSales.id || racingPerson.status === 'active', 'concurrent assignment cannot leave a newly inactive owner');
  eq((await call(configPath + '/schema', token)).length, 3, 'policy contract'); eq((await call('/customer-allocation/schema', token)).length, 2, 'allocation contracts');
  if (process.env.SAVE_TEST_UI === 'true') { mkdirSync('.local/permissions-test', { recursive: true, mode: 0o700 }); writeFileSync('.local/permissions-test/ui-context.json', JSON.stringify({ env, password }), { mode: 0o600 }); }
  console.log(JSON.stringify({ result: 'PASS', checks, fixtures: 'marked synthetic data, isolated MySQL only', database: new URL(process.env.DATABASE_URL).pathname }));
} finally { api?.kill('SIGTERM'); await db.$disconnect(); }
