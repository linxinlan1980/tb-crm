import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { accountInput, remoteInput, accountServer, proxyConfiguration } from './local-accounts.mjs';
const cases = [null, [], { code: 'x', name: 'X' }, { code: 'A;DROP_DB', name: 'X' }, { code: 'AA', name: '' }, { code: 'AA', name: 'X', database: 'mysql' }, { code: 'AA', name: 'X\nY' }];
for (const value of cases) test('reject invalid account input ' + JSON.stringify(value), () => assert.throws(() => accountInput(value)));
test('company name remains data, code has strict grammar', () => assert.deepEqual(accountInput({ code: 'MY_COMPANY', name: " A 'quoted' company " }), { code: 'MY_COMPANY', name: "A 'quoted' company" }));
for (const input of [{ mode: 'bad' }, { mode: 'https-proxy', url: 'http://crm.example.com' }, { mode: 'vpn', url: 'https://u:p@crm.example.com' }, { mode: 'https-proxy', url: 'https://crm.example.com/path' }]) test('reject unsafe remote config ' + JSON.stringify(input), () => assert.throws(() => remoteInput(input)));
test('remote config records an origin without claiming connection', () => { assert.deepEqual(remoteInput({ mode: 'none', url: 'unused' }), { mode: 'none', url: '' }); assert.equal(remoteInput({ mode: 'https-proxy', url: 'https://crm.example.com' }).url, 'https://crm.example.com'); });
test('proxy output preserves authority and denies remote account administration', () => {
  const config = proxyConfiguration({ mode: 'https-proxy', url: 'https://crm.example.com:8443' }, 3000);
  assert.match(config, /listen 8443 ssl/); assert.match(config, /server_name crm.example.com;/); assert.match(config, /location \^~ \/__accounts \{ deny all; \}/); assert.match(config, /proxy_set_header Host \$http_host;/);
  assert.throws(() => proxyConfiguration({ mode: 'https-proxy', url: 'https://x;evil' }, 3000));
  assert.throws(() => proxyConfiguration({ mode: 'none', url: '' }, 3000));
});
test('control plane requires separate token, trusted host and origin', async () => {
  const store = { webPort: 0, token: 'a'.repeat(64), registry: { accounts: [], remote: { mode: 'none', url: '' } }, workers: new Map(), records: () => [], persist() {} };
  const server = accountServer(store); await new Promise((done) => server.listen(0, '127.0.0.1', done)); store.webPort = server.address().port;
  const url = 'http://127.0.0.1:' + store.webPort;
  try {
    assert.equal((await fetch(url + '/__accounts/api')).status, 401);
    assert.equal((await fetch(url + '/__accounts/api', { headers: { Authorization: 'Bearer ' + 'é'.repeat(64) } })).status, 401);
    const headers = { Authorization: 'Bearer ' + store.token };
    assert.equal((await fetch(url + '/__accounts/api', { headers })).status, 200);
    assert.equal((await fetch(url + '/__accounts/api', { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    const badHostStatus = await new Promise((done, fail) => { const req = request(url + '/__accounts/api', { headers: { ...headers, Host: 'evil.example' } }, (res) => { res.resume(); done(res.statusCode); }); req.on('error', fail); req.end(); });
    assert.equal(badHostStatus, 403);
    assert.equal((await fetch(url + '/api/v1/health/ready', { headers: { 'X-Company-Code': 'UNKNOWN' } })).status, 400);
    assert.equal((await fetch(url + '/__accounts/remote', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'none', url: '' }) })).status, 200);
  } finally { await new Promise((done) => server.close(done)); }
});
