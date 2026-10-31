import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
assert.equal(process.env.DEMO_MODE, 'true', 'Only explicit demo environments can create a fresh copy');
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const previous = new URL(process.env.DATABASE_URL);
assert(['localhost', '127.0.0.1'].includes(previous.hostname), 'Only local disposable databases are supported');
assert(/^\/tb_crm_(demo|test)(?:_\d+)?$/.test(previous.pathname), 'Refusing non-demo/test database');
const test = process.argv.includes('--test'),
  name = `tb_crm_${test ? 'test' : 'demo'}_${Date.now()}`;
const next = new URL(previous);
next.pathname = '/' + name;
let adminUrl = process.env.DEMO_ADMIN_DATABASE_URL;
if (!adminUrl) {
  const path = join(homedir(), '.local/share/tb-crm-runtime/.credentials.json');
  const password =
    existsSync(path) && previous.port === '3307'
      ? JSON.parse(readFileSync(path, 'utf8')).rootPassword
      : process.env.MYSQL_ROOT_PASSWORD;
  if (!password) throw new Error('请配置本机数据库管理凭证，以便新建演示副本');
  const url = new URL(previous);
  url.username = 'root';
  url.password = password;
  url.pathname = '/mysql';
  adminUrl = url.href;
}
const app = new PrismaClient({ datasourceUrl: previous.href }),
  root = new PrismaClient({ datasourceUrl: adminUrl });
try {
  const [{ account }] = await app.$queryRaw`SELECT CURRENT_USER() AS account`;
  const [user, host] = String(account).split('@');
  assert(/^[a-zA-Z0-9_]+$/.test(user) && /^[a-zA-Z0-9.%_:]+$/.test(host), 'Unexpected database account identifier');
  // Identifier is generated locally from a fixed prefix and digits. No existing database is modified or deleted.
  await root.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.$executeRawUnsafe(`GRANT ALL ON \`${name}\`.* TO '${user}'@'${host}'`);
} finally {
  await app.$disconnect();
  await root.$disconnect();
}
const env = {
  ...process.env,
  DATABASE_URL: next.href,
  DEMO_MODE: 'true',
  ...(test ? { SMOKE_ALLOW_WRITES: 'true' } : {}),
};
for (const args of [['--filter', '@partneros/database', 'migrate:deploy'], ['demo:seed']]) {
  const r = spawnSync('pnpm', args, { env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
mkdirSync('.local', { recursive: true });
if (test) {
  writeFileSync('.local/last-test.json', JSON.stringify({ database: name, createdAt: new Date().toISOString() }));
  if (process.argv.includes('--verify')) {
    const r = spawnSync(process.execPath, ['scripts/smoke.mjs'], { env, stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
} else {
  const historyPath = '.local/database-history.json';
  const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, 'utf8')) : [];
  history.push({ databaseUrl: previous.href, replacedAt: new Date().toISOString() });
  writeFileSync(historyPath, JSON.stringify(history, null, 2), { mode: 0o600 });
  const envText = readFileSync('.env', 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('DATABASE_URL='))
    .join('\n');
  writeFileSync('.env', envText + `\nDATABASE_URL="${next.href}"\n`, { mode: 0o600 });
  console.log('已建立干净演示副本，旧库保留；请重新启动演示系统。');
}
