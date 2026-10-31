// Read-only acceptance against a running deployment. No business mutations.
import assert from 'node:assert/strict';
const base = process.env.DEMO_URL || 'http://127.0.0.1:3000';
const ui = await fetch(base);
assert.equal(ui.status, 200);
assert.match(await ui.text(), /伴圆 CRM/);
const health = await fetch(base + '/api/v1/health');
assert.equal(health.status, 200);
for (const username of ['admin', 'manager', 'sales', 'boss']) {
  const login = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: process.env.SEED_ADMIN_PASSWORD }) });
  assert.equal(login.status, 200, username + ' login');
  const token = (await login.json()).data.accessToken;
  for (const path of ['/workspace/overview', '/workspace/schema', '/approvals/schema']) {
    const res = await fetch(base + '/api/v1' + path, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200, username + path);
    const data = (await res.json()).data;
    if (path === '/workspace/overview') assert(data.customers > 0, 'Seeded data visible');
  }
  console.log(username + ': login, overview and schemas OK');
}
console.log('Deployment read-only acceptance passed.');
