import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { backupKey, restoreInstallation } from './local-recovery.mjs';
import { encodeBackup } from './backup-format.mjs';
import { servicePlist } from './local-service.mjs';
import { acquireInstallationLock, LocalAccountStore } from './local-accounts.mjs';
const hash = s => createHash('sha256').update(s).digest('hex');
test('installation recovery authenticates before creating target or connecting MySQL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-recovery-key-'));
  const keyFile = join(dir, 'key'), archive = join(dir, 'archive'), target = join(dir, 'target');
  backupKey(keyFile, true);
  const bytes = encodeBackup({ format: 1, sql: '', sqlSha256: hash(''), configuration: {} }, randomBytes(32).toString('hex'));
  writeFileSync(archive, bytes);
  await assert.rejects(restoreInstallation({ dir: target, file: archive, keyFile }), /authenticate|authentication/i);
  assert.equal(existsSync(target), false);
});
test('private recovery keys refuse broad file permissions and malformed keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-recovery-permissions-')), file = join(dir, 'key');
  const key = backupKey(file, true);
  assert.equal(backupKey(file), key);
  chmodSync(file, 0o644); assert.throws(() => backupKey(file), /private/);
  chmodSync(file, 0o600); writeFileSync(file, '0'.repeat(64)); assert.throws(() => backupKey(file), /Invalid/);
});
test('recovery refuses existing directory and overlapping ports before writes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-recovery-target-'));
  await assert.rejects(restoreInstallation({ dir }), /already exists/);
  await assert.rejects(restoreInstallation({ dir: join(dir, 'new'), webPort: 4301, basePort: 4300 }), /overlapping/);
  assert.equal(existsSync(join(dir, 'new')), false);
});
test('service uses literal argument arrays, escapes XML and has no shell or embedded secrets', () => {
  const xml = servicePlist({ source: '/tmp/project & <crm>', directory: '/tmp/accounts & <test>', node: '/tmp/node', webPort: 4174, basePort: 4175 });
  assert(xml.includes('project &amp; &lt;crm&gt;'));
  assert(xml.includes('<string>--no-build</string>'));
  assert(xml.includes('<key>KeepAlive</key><true/>'));
  assert.doesNotMatch(xml, /DATABASE_URL|JWT_SECRET|BACKUP_KEY|\/bin\/sh/);
  assert.throws(() => servicePlist({ label: '../injection' }));
  assert.throws(() => servicePlist({ webPort: 4305, basePort: 4300 }));
});
test('duplicate installation process is refused and release preserves a replacement lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-process-lock-'));
  const release = acquireInstallationLock(dir);
  assert.throws(() => acquireInstallationLock(dir), /已有运行进程/);
  release(); const next = acquireInstallationLock(dir);
  release(); assert(existsSync(join(dir, 'gateway.lock'))); next();
});
test('failed recovery cannot be opened as an empty installation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-failed-recovery-'));
  writeFileSync(join(dir, 'restore-receipt.json'), JSON.stringify({ status: 'failed' }));
  await assert.rejects(new LocalAccountStore({ dir }).init(), /禁止启动/);
  assert.equal(existsSync(join(dir, 'registry.json')), false);
});
