// Operator-only, authenticated installation recovery. No HTTP/agent entry point.
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, openSync, closeSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { connect } from 'node:net';
import { encodeBackup, decodeBackup, MAX_SQL_BYTES } from './backup-format.mjs';
import { accountInput, acquireInstallationLock } from './local-accounts.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const schema = () => hash(readFileSync(join(project, 'packages/database/prisma/schema.prisma')));
const listening = port => new Promise(done => {
  const socket = connect({ host: '127.0.0.1', port });
  const finish = value => { socket.destroy(); done(value); };
  socket.setTimeout(500); socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false)); socket.once('timeout', () => finish(false));
});
const identifier = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{1,64}$/.test(value)) throw new Error('Invalid database identifier');
  return '`' + value + '`';
};
function privateFile(path) {
  const stat = statSync(path);
  if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('Recovery keys must be private regular files (chmod 600)');
  return readFileSync(path, 'utf8').trim();
}
export function backupKey(file, create = false) {
  const path = resolve(file);
  if (!existsSync(path) && create) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, secret() + '\n', { mode: 0o600, flag: 'wx' });
  }
  const key = privateFile(path);
  if (!/^[a-f0-9]{64}$/.test(key) || new Set(key).size < 8) throw new Error('Invalid installation recovery key');
  return key;
}
function mysql(tool, urlText, args, input, bin = process.env.MYSQL_BIN_DIR) {
  const url = new URL(urlText);
  const native = join(homedir(), '.local/share/tb-crm-runtime/mysql-8.4.11-macos15-arm64/bin');
  const executable = bin ? join(bin, tool) : existsSync(join(native, tool)) ? join(native, tool) : tool;
  const result = spawnSync(executable, ['--protocol=TCP', '--host=' + url.hostname, '--port=' + (url.port || '3306'), '--user=' + decodeURIComponent(url.username), ...args], {
    input, encoding: 'utf8', timeout: 300000, maxBuffer: MAX_SQL_BYTES,
    env: { PATH: process.env.PATH, HOME: homedir(), LANG: process.env.LANG || 'en_US.UTF-8', MYSQL_PWD: decodeURIComponent(url.password) },
  });
  // Never print SQL or database credentials in errors.
  if (result.error || result.status !== 0) throw new Error('MySQL ' + tool + ' failed; inspect the private operation receipt');
  return result.stdout;
}
async function inventory(db) {
  const tables = await db.$queryRawUnsafe('SELECT table_name AS name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type=\'BASE TABLE\' ORDER BY table_name');
  const counts = {};
  for (const { name } of tables) counts[name] = Number((await db.$queryRawUnsafe('SELECT COUNT(*) AS n FROM ' + identifier(name)))[0].n);
  const evidence = counts.evidence_attachments === undefined ? [] : await db.$queryRawUnsafe('SELECT id, sha256, SHA2(content_bytes,256) AS actual FROM evidence_attachments ORDER BY id');
  if (evidence.some(row => row.sha256 !== row.actual)) throw new Error('Attachment checksum mismatch');
  return { counts, attachmentsSha256: hash(JSON.stringify(evidence)) };
}
export async function backupInstallation(options) {
  const directory = resolve(options.dir);
  if (!existsSync(join(directory, 'registry.json'))) throw new Error('Company registry does not exist');
  const release = acquireInstallationLock(directory);
  try { return await backupContents(options); } finally { release(); }
}
async function backupContents({ dir, file, keyFile, mysqlBin }) {
  dir = resolve(dir); file = resolve(file);
  if (existsSync(file)) throw new Error('Backup output already exists');
  const registryFile = join(dir, 'registry.json');
  const registryRaw = readFileSync(registryFile, 'utf8');
  const registry = JSON.parse(registryRaw);
  if (registry.version !== 1 || !registry.accounts?.length || registry.accounts.length > 10 || registry.accounts.some(a => a.status !== 'ready')) throw new Error('All companies must be ready before installation backup');
  for (const entry of registry.accounts) {
    if (!Number.isInteger(entry.port) || entry.port < 1024 || entry.port > 65535 || await listening(entry.port)) throw new Error('Stop all company workers before installation backup');
  }
  const accounts = [];
  let totalBytes = 0;
  for (const entry of registry.accounts) {
    accountInput({ code: entry.code, name: entry.name, purpose: entry.purpose || 'business' });
    const configRaw = readFileSync(entry.configFile, 'utf8');
    const config = JSON.parse(configRaw);
    if (config.TENANT_CODE !== entry.code || config.DEMO_MODE !== 'false') throw new Error('Company configuration mismatch');
    const gatewayPort = Number(config.WEB_PORT || 3000);
    if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65535 || await listening(gatewayPort)) throw new Error('Stop the installation gateway before backup');
    const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
    try {
      const tenant = await db.tenant.findMany({ select: { code: true } });
      if (tenant.length !== 1 || tenant[0].code !== entry.code) throw new Error('Expected exactly one matching company');
      const sql = mysql('mysqldump', config.DATABASE_URL, ['--single-transaction', '--skip-lock-tables', '--no-tablespaces', '--set-gtid-purged=OFF', '--hex-blob', new URL(config.DATABASE_URL).pathname.slice(1)], undefined, mysqlBin);
      totalBytes += Buffer.byteLength(sql);
      if (totalBytes > MAX_SQL_BYTES) throw new Error('Installation SQL exceeds 128MiB supported limit');
      // Counts in the dump describe its consistent snapshot, unlike live post-dump counts.
      // A separate inventory supplies attachment hashes; restoration validates the dump itself.
      const before = await inventory(db);
      if (readFileSync(entry.configFile, 'utf8') !== configRaw) throw new Error('Company configuration changed during backup');
      accounts.push({ code: entry.code, name: entry.name, purpose: entry.purpose || 'business',
        encryptionKey: config.ENCRYPTION_KEY, sql, sqlSha256: hash(sql), inventory: before });
    } finally { await db.$disconnect(); }
  }
  if (readFileSync(registryFile, 'utf8') !== registryRaw) throw new Error('Company registry changed during backup');
  const configuration = { kind: 'local-installation', version: 1, accounts,
    remote: registry.remote, consistency: 'per-company; writes must be paused for exact inventory comparison' };
  const snapshot = { format: 1, sql: '', sqlSha256: hash(''), schemaSha256: schema(), createdAt: new Date().toISOString(), configuration };
  const bytes = encodeBackup(snapshot, backupKey(keyFile, true));
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  const receipt = { action: 'installation-backup', file, encrypted: true, companies: accounts.map(a => a.code), createdAt: snapshot.createdAt, schemaSha256: snapshot.schemaSha256, archiveSha256: hash(bytes) };
  writeFileSync(file + '.receipt.json', JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
  return receipt;
}
function validateSnapshot(snapshot) {
  const data = snapshot.configuration;
  if (snapshot.schemaSha256 !== schema()) throw new Error('Restore requires the matching source schema version');
  if (data.kind !== 'local-installation' || data.version !== 1 || !Array.isArray(data.accounts) || data.accounts.length < 1 || data.accounts.length > 10) throw new Error('Invalid installation backup');
  const seen = new Set(); let bytes = 0;
  for (const a of data.accounts) {
    accountInput({ code: a.code, name: a.name, purpose: a.purpose });
    if (seen.has(a.code)) throw new Error('Duplicate company code'); seen.add(a.code);
    if (!/^[a-f0-9]{64}$/.test(a.encryptionKey || '') || typeof a.sql !== 'string' || hash(a.sql) !== a.sqlSha256) throw new Error('Invalid company snapshot');
    bytes += Buffer.byteLength(a.sql);
    if (bytes > MAX_SQL_BYTES || /^\s*(?:USE\s|CREATE\s+DATABASE|DROP\s+DATABASE|SOURCE\s|\\!)/im.test(a.sql)) throw new Error('Invalid single-database dump');
    if (!a.inventory?.counts || !Object.keys(a.inventory.counts).length) throw new Error('Missing source inventory');
    if (!/^[a-f0-9]{64}$/.test(a.inventory.attachmentsSha256 || '')) throw new Error('Invalid attachment inventory');
    for (const [table, count] of Object.entries(a.inventory.counts)) {
      identifier(table); if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid source count');
    }
  }
  return data;
}
export async function restoreInstallation({ dir, file, keyFile, rootUrl, webPort = 3000, basePort = 4300, mysqlBin, test = false, sqlAccountHost = '127.0.0.1' }) {
  dir = resolve(dir);
  if (existsSync(dir)) throw new Error('Restore directory already exists; original installation is never overwritten');
  if (![webPort, basePort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65525) || webPort >= basePort && webPort < basePort + 10) throw new Error('Invalid or overlapping service ports');
  if (statSync(file).size > 192 * 1024 * 1024) throw new Error('Backup exceeds supported limit');
  // Authentication and complete manifest validation happen before any directory/SQL mutation.
  const snapshot = decodeBackup(readFileSync(file), backupKey(keyFile));
  const data = validateSnapshot(snapshot);
  if (!rootUrl) {
    const credentials = JSON.parse(privateFile(join(homedir(), '.local/share/tb-crm-runtime/.credentials.json')));
    const u = new URL('mysql://root@127.0.0.1:3307/mysql'); u.password = credentials.rootPassword; rootUrl = u.href;
  }
  if (sqlAccountHost !== '127.0.0.1' && !(test && sqlAccountHost === '%')) throw new Error('Unsafe SQL account host');
  const host = new URL(rootUrl).hostname;
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Local recovery requires a loopback MySQL server');
  mkdirSync(dir, { mode: 0o700 });
  const lock = openSync(join(dir, 'restore.lock'), 'wx', 0o600); closeSync(lock);
  const root = new PrismaClient({ datasourceUrl: rootUrl });
  const journal = { action: 'installation-restore', status: 'restoring', createdAt: new Date().toISOString(), sourceCreatedAt: snapshot.createdAt, schemaSha256: snapshot.schemaSha256, promoted: false, companies: [] };
  const record = () => writeFileSync(join(dir, 'restore-receipt.json'), JSON.stringify(journal, null, 2), { mode: 0o600 });
  const registry = { version: 1, accounts: [], remote: { mode: 'none', url: '' } };
  record();
  try {
    for (const source of data.accounts) {
      const suffix = randomBytes(8).toString('hex');
      const database = (test ? 'tbcrm_test_' : 'tbcrm_c_') + suffix, dbUser = 'crm_' + suffix, password = secret();
      const item = { code: source.code, database, dbUser, status: 'creating', stage: 'create-database' }; journal.companies.push(item); record();
      await root.$executeRawUnsafe('CREATE DATABASE ' + identifier(database) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
      item.stage = 'create-user'; record();
      await root.$executeRawUnsafe(`CREATE USER '${dbUser}'@'${sqlAccountHost}' IDENTIFIED BY '${password}'`);
      await root.$executeRawUnsafe(`GRANT ALL PRIVILEGES ON ${identifier(database)}.* TO '${dbUser}'@'${sqlAccountHost}'`);
      const u = new URL(rootUrl); u.username = dbUser; u.password = password; u.pathname = '/' + database;
      // Import using only this new company's SQL account, never the root account.
      item.stage = 'import'; record();
      mysql('mysql', u.href, [database], source.sql, mysqlBin);
      const db = new PrismaClient({ datasourceUrl: u.href });
      try {
        item.stage = 'verify-inventory'; record();
        const actual = await inventory(db);
        if (JSON.stringify(actual) !== JSON.stringify(source.inventory)) throw new Error('Restored row counts or attachment hashes differ; source writes may not have been paused');
        const tenants = await db.tenant.findMany({ select: { code: true } });
        if (tenants.length !== 1 || tenants[0].code !== source.code) throw new Error('Restored company identity mismatch');
        item.stage = 'revoke-sessions-and-external-consent'; record();
        await db.$executeRawUnsafe('UPDATE auth_sessions SET revoked_at=NOW(3) WHERE revoked_at IS NULL');
        await db.$executeRawUnsafe("UPDATE agent_grants SET revoked_at=NOW(3),revoke_reason='Installation restored',updated_at=NOW(3) WHERE revoked_at IS NULL");
        await db.$executeRawUnsafe('UPDATE activity_sync_settings SET calendar_enabled=0,todo_enabled=0,auto_enabled=0,updated_at=NOW(3)');
        await db.$executeRawUnsafe("UPDATE activity_sync_jobs SET status='uncertain',error='Installation restored; reconcile interrupted delivery',updated_at=NOW(3) WHERE status='dispatching'");
        await db.$executeRawUnsafe("UPDATE activity_sync_jobs SET status='cancelled',error='Installation restored; fresh consent required',updated_at=NOW(3) WHERE status='prepared'");
        item.counts = actual.counts; item.attachmentsSha256 = actual.attachmentsSha256;
      } finally { await db.$disconnect(); }
      const configFile = join(dir, source.code + '.json');
      const config = { DEMO_MODE: 'false', ACCOUNT_PURPOSE: source.purpose, TENANT_CODE: source.code, TENANT_NAME: source.name,
        DATABASE_URL: u.href, JWT_SECRET: secret(), ENCRYPTION_KEY: source.encryptionKey, BACKUP_KEY: secret(),
        APP_URL: 'http://localhost:' + webPort, WEB_PORT: String(webPort) };
      // No primary DWS binding, employee profiles, initial password or remote ingress is inherited.
      writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
      registry.accounts.push({ code: source.code, name: source.name, purpose: source.purpose, database, dbUser, port: basePort + registry.accounts.length,
        configFile, createdAt: new Date().toISOString(), status: 'ready' });
      item.status = 'verified'; item.stage = 'complete'; record();
    }
    writeFileSync(join(dir, 'management-token.txt'), secret(), { mode: 0o600, flag: 'wx' });
    // Publish the complete registry only after every company has passed all recovery checks.
    writeFileSync(join(dir, 'registry.json'), JSON.stringify(registry, null, 2), { mode: 0o600, flag: 'wx' });
    journal.status = 'verified-offline'; journal.finishedAt = new Date().toISOString(); record();
    return journal;
  } catch {
    journal.status = 'failed'; journal.error = 'Recovery incomplete. No registry published; original installation unchanged.'; record();
    // Driver errors may contain generated CREATE USER SQL. Never expose them or new passwords.
    throw new Error(journal.error + ' See restore-receipt.json for the failed stage.');
  } finally { await root.$disconnect(); }
}
async function main() {
  const [command, file, keyFile, dir] = process.argv.slice(2);
  if (!file || !keyFile || !dir || !['backup', 'restore'].includes(command)) throw new Error('Usage: node deploy/local-recovery.mjs backup|restore ARCHIVE KEY_FILE ACCOUNT_DIRECTORY');
  const options = { file, keyFile, dir, rootUrl: process.env.ACCOUNT_ROOT_DATABASE_URL,
    webPort: Number(process.env.ACCOUNT_WEB_PORT || 3000), basePort: Number(process.env.ACCOUNT_BASE_PORT || 4300) };
  console.log(JSON.stringify(command === 'backup' ? await backupInstallation(options) : await restoreInstallation(options)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
