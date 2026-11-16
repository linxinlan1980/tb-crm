// Destructive faults are restricted to newly provisioned synthetic companies.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalAccountStore, accountServer } from '../deploy/local-accounts.mjs';
import { backupInstallation, restoreInstallation, backupKey } from '../deploy/local-recovery.mjs';
import { encodeBackup, decodeBackup } from '../deploy/backup-format.mjs';
import { populateTestCompany } from './seed-test-company.mjs';
import { verifyTestCompany } from './verify-test-company.mjs';
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true');
assert(process.env.ACCOUNT_ROOT_DATABASE_URL);
assert(['127.0.0.1', 'localhost'].includes(new URL(process.env.ACCOUNT_ROOT_DATABASE_URL).hostname));
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const dir = mkdtempSync(join(tmpdir(), 'crm-installation-recovery-'));
const sourceDir = join(dir, 'source'), targetDir = join(dir, 'target'), archive = join(dir, 'installation.crmbackup'), keyFile = join(dir, 'installation.key');
const sqlAccountHost = process.env.ACCOUNT_TEST_MYSQL_HOST || '127.0.0.1';
const store = await new LocalAccountStore({ dir: sourceDir, rootUrl: process.env.ACCOUNT_ROOT_DATABASE_URL, webPort: 4180, basePort: 4181, test: true, sqlAccountHost, supervise: true }).init();
let sourceServer, restored, targetServer, checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const reject = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function request(port, company, path, body, token) {
  const response = await fetch('http://127.0.0.1:' + port + '/api/v1' + path, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
    headers: { 'X-Company-Code': company, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
try {
  const formal = await store.create({ code: 'TINGMENG', name: '【测试】恢复验收空公司' });
  const test = await store.create({ code: 'TEST', name: '【测试】恢复验收丰富业务', purpose: 'test' });
  for (const a of store.registry.accounts) assert.match(a.database, /^tbcrm_test_/);
  checks += 2;
  await store.startAll(); sourceServer = accountServer(store);
  await new Promise(resolve => sourceServer.listen(4180, '127.0.0.1', resolve));
  const fixtures = await populateTestCompany({ dir: sourceDir, url: 'http://127.0.0.1:4180' });
  eq(fixtures.result, 'PASS', 'rich business fixtures');
  const before = await verifyTestCompany({ dir: sourceDir, url: 'http://127.0.0.1:4180' });
  eq(before.result, 'PASS', 'source golden totals and role scopes');
  const sourceConfig = store.config('TEST').config;
  const oldSession = await request(4180, 'TEST', '/auth/login', { tenantCode: 'TEST', username: 'admin', password: test.initialPassword });
  eq(oldSession.status, 200);
  const oldToken = oldSession.body.data.accessToken;
  // A real worker crash must recover without disturbing the other company's process.
  const oldPid = store.workers.get('TEST').pid, formalPid = store.workers.get('TINGMENG').pid;
  store.workers.get('TEST').kill('SIGKILL');
  let recovered = false;
  for (let i = 0; i < 100; i++) {
    await delay(100);
    if (store.workers.get('TEST')?.pid !== oldPid && store.workers.get('TEST')) {
      try { if ((await request(4180, 'TEST', '/health/ready')).status === 200) { recovered = true; break; } } catch {}
    }
  }
  eq(recovered, true, 'crashed company recovers'); eq(store.workers.get('TINGMENG').pid, formalPid, 'other company not restarted');
  await reject(backupInstallation({ dir: sourceDir, file: archive, keyFile }), /Stop all company workers/);
  await new Promise(resolve => sourceServer.close(resolve)); sourceServer = undefined; await store.stop();
  const db = new PrismaClient({ datasourceUrl: sourceConfig.DATABASE_URL });
  let owner;
  try {
    owner = await db.user.findFirstOrThrow({ where: { username: 'admin' } });
    const bytes = Buffer.from('【测试】加密灾备附件原文');
    await db.evidenceAttachment.create({ data: { tenantId: owner.tenantId, subjectKind: 'project', subjectId: 1, filename: '【测试】恢复证据.txt', mediaType: 'text/plain', size: bytes.length, sha256: hash(bytes), contentBytes: bytes, createdBy: owner.id } });
    await db.calendarEntry.create({ data: { tenantId: owner.tenantId, ownerId: owner.id, title: '【测试】恢复日程', description: '', location: '', startsAt: new Date(), endsAt: new Date(Date.now() + 3600000) } });
    await db.activitySyncSetting.create({ data: { id: randomUUID(), tenantId: owner.tenantId, ownerId: owner.id, bindingHash: 'b'.repeat(64), calendarEnabled: true, todoEnabled: true, autoEnabled: true } });
    for (const status of ['prepared', 'dispatching']) await db.activitySyncJob.create({ data: { id: randomUUID(), tenantId: owner.tenantId, ownerId: owner.id, kind: 'calendar', sourceId: 1, sourceVersion: hash(status), bindingHash: 'b'.repeat(64), settingsVersion: new Date(), operation: 'create', payload: {}, status } });
    await db.systemSetting.create({data:{tenantId:owner.tenantId,settingKey:'crm.dingtalk-native-approval.v1',settingGroup:'integration',valueType:'json',settingValue:JSON.stringify({enabled:true,autoPoll:true,processCode:'PROC-SYNTHETIC',departmentId:1,flowId:1,fromDate:'2026-11-15'})}});
    for(const status of ['prepared','sending','sent']) await db.integrationRun.create({data:{id:randomUUID(),tenantId:owner.tenantId,actorId:owner.id,provider:'dws-oa',kind:'approval',bindingHash:'b'.repeat(64),status,snapshot:{synthetic:true},summary:{synthetic:true}}});
    await db.agentGrant.create({ data: { id: randomUUID(), tenantId: owner.tenantId, ownerId: owner.id, ownerSessionId: randomUUID(), name: '【测试】恢复后撤销', purpose: '【测试】', tokenHash: hash('synthetic'), contextHash: hash('context'), capabilities: [], maxCalls: 1, expiresAt: new Date(Date.now() + 600000) } });
  } finally { await db.$disconnect(); }
  const originalRegistry = readFileSync(join(sourceDir, 'registry.json'), 'utf8');
  const backedUp = await backupInstallation({ dir: sourceDir, file: archive, keyFile });
  eq(backedUp.companies, ['TINGMENG', 'TEST']);
  eq(readFileSync(archive).includes(Buffer.from('恢复证据')), false, 'no plaintext customer payload in archive');
  const options = { dir: targetDir, file: archive, keyFile, rootUrl: process.env.ACCOUNT_ROOT_DATABASE_URL, webPort: 4194, basePort: 4195, test: true, sqlAccountHost };
  const tampered = join(dir, 'tampered'); const bytes = readFileSync(archive); bytes[80] ^= 1; writeFileSync(tampered, bytes);
  await reject(restoreInstallation({ ...options, file: tampered }), /authenticate|authentication/i); eq(existsSync(targetDir), false);
  const snapshot = decodeBackup(readFileSync(archive), backupKey(keyFile));
  snapshot.schemaSha256 = '0'.repeat(64); const wrongSchema = join(dir, 'wrong-schema'); writeFileSync(wrongSchema, encodeBackup(snapshot, backupKey(keyFile)));
  await reject(restoreInstallation({ ...options, file: wrongSchema }), /matching source schema/); eq(existsSync(targetDir), false);
  const invalidSql = decodeBackup(readFileSync(archive), backupKey(keyFile));
  invalidSql.configuration.accounts[0].sql = 'USE mysql;';
  invalidSql.configuration.accounts[0].sqlSha256 = hash('USE mysql;');
  const invalidSqlFile = join(dir, 'invalid-sql'); writeFileSync(invalidSqlFile, encodeBackup(invalidSql, backupKey(keyFile)));
  await reject(restoreInstallation({ ...options, file: invalidSqlFile }), /single-database/); eq(existsSync(targetDir), false);
  const mismatch = decodeBackup(readFileSync(archive), backupKey(keyFile));
  mismatch.configuration.accounts[0].inventory.counts.users++;
  const mismatchFile = join(dir, 'mismatch'); writeFileSync(mismatchFile, encodeBackup(mismatch, backupKey(keyFile)));
  const failedDir = join(dir, 'failed-target');
  await reject(restoreInstallation({ ...options, dir: failedDir, file: mismatchFile }), /Recovery incomplete/);
  eq(existsSync(join(failedDir, 'registry.json')), false, 'partial failure never publishes a company registry');
  eq(JSON.parse(readFileSync(join(failedDir, 'restore-receipt.json'))).status, 'failed');
  await reject(new LocalAccountStore({ dir: failedDir }).init(), /禁止启动/);
  const result = await restoreInstallation(options);
  eq(result.status, 'verified-offline'); eq(result.promoted, false);
  eq(result.companies.every(a => a.status === 'verified'), true);
  eq(readFileSync(join(sourceDir, 'registry.json'), 'utf8'), originalRegistry, 'source registry untouched');
  await reject(restoreInstallation(options), /already exists/);
  restored = await new LocalAccountStore({ dir: targetDir, rootUrl: process.env.ACCOUNT_ROOT_DATABASE_URL, webPort: 4194, basePort: 4195, test: true, sqlAccountHost, supervise: true }).init();
  const targetConfig = restored.config('TEST').config;
  eq(targetConfig.DWS_PROFILE, undefined); eq(targetConfig.SEED_ADMIN_PASSWORD, undefined);
  assert.notEqual(targetConfig.JWT_SECRET, sourceConfig.JWT_SECRET); assert.notEqual(targetConfig.BACKUP_KEY, sourceConfig.BACKUP_KEY); checks += 2;
  eq(targetConfig.ENCRYPTION_KEY, sourceConfig.ENCRYPTION_KEY, 'encrypted integration fields remain decryptable');
  assert.notEqual(targetConfig.DATABASE_URL, sourceConfig.DATABASE_URL); checks++;
  const targetDb = new PrismaClient({ datasourceUrl: targetConfig.DATABASE_URL });
  try {
    eq(await targetDb.authSession.count({ where: { revokedAt: null } }), 0);
    eq(await targetDb.agentGrant.count({ where: { revokedAt: null } }), 0);
    eq(await targetDb.activitySyncSetting.count({ where: { OR: [{ calendarEnabled: true }, { todoEnabled: true }, { autoEnabled: true }] } }), 0);
    eq(await targetDb.activitySyncJob.count({ where: { status: 'cancelled' } }), 1);
    eq(await targetDb.activitySyncJob.count({ where: { status: 'uncertain' } }), 1);
    const nativePolicy=JSON.parse((await targetDb.systemSetting.findFirstOrThrow({where:{settingKey:'crm.dingtalk-native-approval.v1'}})).settingValue);
    eq(nativePolicy.enabled,false);eq(nativePolicy.autoPoll,false);eq(nativePolicy.processCode,'PROC-SYNTHETIC','original native evidence configuration retained disabled');
    for(const status of ['cancelled','uncertain','sent']) eq(await targetDb.integrationRun.count({where:{provider:'dws-oa',status}}),1);
    const attachment = await targetDb.evidenceAttachment.findFirstOrThrow(); eq(hash(attachment.contentBytes), attachment.sha256);
    const sourceDbName = new URL(sourceConfig.DATABASE_URL).pathname.slice(1);
    await reject(targetDb.$queryRawUnsafe('SELECT COUNT(*) FROM `' + sourceDbName + '`.customers'));
    const formalDb = restored.config('TINGMENG').account.database;
    await reject(targetDb.$queryRawUnsafe('SELECT COUNT(*) FROM `' + formalDb + '`.customers'));
  } finally { await targetDb.$disconnect(); }
  await restored.startAll(); targetServer = accountServer(restored); await new Promise(resolve => targetServer.listen(4194, '127.0.0.1', resolve));
  eq((await request(4194, 'TEST', '/workspace/overview', undefined, oldToken)).status, 401, 'old JWT rejected');
  const newLogin = await request(4194, 'TEST', '/auth/login', { tenantCode: 'TEST', username: 'admin', password: test.initialPassword }); eq(newLogin.status, 200, 'restored existing password works');
  eq((await request(4194, 'TINGMENG', '/workspace/overview', undefined, newLogin.body.data.accessToken)).status, 401);
  eq((await request(4194, 'TINGMENG', '/auth/login', { tenantCode: 'TINGMENG', username: 'admin', password: formal.initialPassword })).status, 200);
  // Fixture manifest is a test harness input, not an installation secret restored by the product.
  copyFileSync(join(sourceDir, 'TEST-fixtures-v1.json'), join(targetDir, 'TEST-fixtures-v1.json'));
  const after = await verifyTestCompany({ dir: targetDir, url: 'http://127.0.0.1:4194', adminPassword: test.initialPassword });
  eq(after.result, 'PASS'); eq(after.golden, before.golden, 'money, business relationships and permissions unchanged');
  if (process.env.SAVE_RECOVERY_UI === 'true') {
    writeFileSync(new URL('../.local/recovery-ui-context.json', import.meta.url), JSON.stringify({ dir: targetDir, archive, keyFile, username: 'admin', password: test.initialPassword, code: 'TEST', webPort: 4194, basePort: 4195 }), { mode: 0o600 });
  }
  console.log(JSON.stringify({ result: 'PASS', checks, sourceBusinessChecks: before.checks, restoredBusinessChecks: after.checks,
    sourceFixtureChecks: fixtures.checks, workerCrashRecovery: true, companies: 2, freshSqlUsers: true, sessionRevocation: true, externalSyncDisabled: true, attachmentHashes: true, originalPreserved: true }));
} finally {
  if (targetServer) await new Promise(resolve => targetServer.close(resolve));
  if (sourceServer) await new Promise(resolve => sourceServer.close(resolve));
  if (restored) await restored.stop(); await store.stop();
}
