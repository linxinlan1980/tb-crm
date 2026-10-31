import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// Requires a disposable, migrated and seeded MySQL database. Never run against production.
assert.equal(process.env.SMOKE_ALLOW_WRITES, 'true', 'Set SMOKE_ALLOW_WRITES=true for the disposable test database');
assert.match(new URL(process.env.DATABASE_URL).pathname, /test/, 'Smoke writes require a database name containing test');
const port = process.env.SMOKE_PORT || '4100';
const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: new URL('../apps/api/', import.meta.url), env: { ...process.env, PORT: port }, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
api.stdout.on('data', (chunk) => { log += chunk; });
api.stderr.on('data', (chunk) => { log += chunk; });
const base = `http://127.0.0.1:${port}/api/v1`;
async function call(path, method = 'GET', data, token) {
  const response = await fetch(base + path, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(5000) });
  return { status: response.status, body: await response.json() };
}
try {
  let ready = false;
  for (let index = 0; index < 50; index++) {
    if (api.exitCode !== null) throw new Error('API exited before readiness');
    try { ready = (await call('/health')).status === 200; } catch { /* Retry startup only. */ }
    if (ready) break;
    await delay(200);
  }
  assert(ready, 'API readiness timeout');
  assert.equal((await call('/customers')).status, 401);
  const login = await call('/auth/login', 'POST', { username: 'admin', password: process.env.SEED_ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  const token = login.body.data.accessToken;
  assert.equal((await call('/capabilities', 'GET', undefined, token)).body.data.length, 2);
  const name = `集成验证${Date.now()}`;
  const created = await call('/customers', 'POST', { name, industry: '制造/工业' }, token);
  assert.equal(created.status, 201);
  const customerId = created.body.data.id;
  const read = await call('/capabilities/customer.get/invoke', 'POST', { customerId }, token);
  assert.equal(read.status, 201);
  assert.equal(read.body.data.result.name, name);
  assert.equal(typeof read.body.data.executionId, 'string');
  assert.equal((await call('/capabilities/customer.search/invoke', 'POST', { tenantId: 999 }, token)).status, 400);
  console.log('PASS real MySQL: migration/seed + API boot + authentication + customer create + capability read + audit');
} catch (error) {
  process.stderr.write(log);
  throw error;
} finally {
  api.kill('SIGTERM');
}
