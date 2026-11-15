import { createRequire } from 'node:module';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync, rmdirSync } from 'node:fs';
import { resolve, join, dirname, sep, extname } from 'node:path';
import { homedir, networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer, request as httpRequest } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initializeProduction } from './initialize-production.mjs';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(project, 'packages/database/package.json'));
const { PrismaClient } = require('@prisma/client');
const hex = () => randomBytes(32).toString('hex');
const error = (status, message) => Object.assign(new Error(message), { status });
export function acquireInstallationLock(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'gateway.lock');
  const value = JSON.stringify({ pid: process.pid, nonce: hex() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { writeFileSync(path, value, { mode: 0o600, flag: 'wx' }); return () => { if (existsSync(path) && readFileSync(path, 'utf8') === value) unlinkSync(path); }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const old = readFileSync(path, 'utf8'); let pid;
      try { pid = JSON.parse(old).pid; } catch { throw new Error('安装进程锁损坏，请由运维检查'); }
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('安装进程锁无效');
      try { process.kill(pid, 0); throw new Error('同一帐套目录已有运行进程；请使用本机管理页面或先停止服务'); }
      catch (probe) {
        if (probe.code !== 'ESRCH') throw probe;
        const recoveryLock = join(dir, 'gateway-lock-recovery');
        try { mkdirSync(recoveryLock, { mode: 0o700 }); } catch { throw new Error('安装进程锁正在恢复，请稍后重试'); }
        try {
          if (readFileSync(path, 'utf8') !== old) throw new Error('安装进程锁发生变化，请重试');
          unlinkSync(path);
        } finally { rmdirSync(recoveryLock); }
      }
    }
  }
  throw new Error('无法取得安装进程锁');
}
export function accountInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => !['code', 'name', 'purpose'].includes(k))) throw error(400, '只允许公司编码、名称和用途');
  if (typeof value.code !== 'string' || !/^[A-Z][A-Z0-9_-]{1,29}$/.test(value.code)) throw error(400, '公司编码为2至30位大写字母、数字、下划线或短横线');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 || /[\x00-\x1f\x7f]/.test(value.name)) throw error(400, '公司名称为1至100位有效文字');
  if (value.purpose !== undefined && !['business', 'test'].includes(value.purpose)) throw error(400, '帐套用途无效');
  return { code: value.code, name: value.name.trim(), ...(value.purpose ? { purpose: value.purpose } : {}) };
}
export function remoteInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => !['mode', 'url'].includes(k))) throw error(400, '入口参数无效');
  if (!['none', 'https-proxy', 'vpn'].includes(value.mode)) throw error(400, '请选择有效的访问方式');
  if (value.mode === 'none') return { mode: 'none', url: '' };
  let u; try { u = new URL(value.url); } catch { throw error(400, '请输入有效的访问地址'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw error(400, '远程入口应为不含账号、路径和查询参数的HTTPS地址');
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(u.hostname)) throw error(400, '请输入有效的域名或IPv4地址');
  return { mode: value.mode, url: u.origin };
}
export function proxyConfiguration(remote, port) {
  const validated = remoteInput(remote);
  if (validated.mode === 'none') throw error(400, '请先保存远程入口地址');
  const url = new URL(validated.url);
  return `# 部署前先安装证书并验证 nginx -t；此配置不会自动生效。\nserver {\n    listen ${url.port || 443} ssl;\n    server_name ${url.hostname};\n    ssl_certificate /etc/nginx/certs/crm.crt;\n    ssl_certificate_key /etc/nginx/certs/crm.key;\n    ssl_protocols TLSv1.2 TLSv1.3;\n    client_max_body_size 3m;\n    location ^~ /__accounts { deny all; }\n    location / {\n        proxy_pass http://127.0.0.1:${port};\n        proxy_set_header Host $http_host;\n        proxy_set_header X-Forwarded-Proto https;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_read_timeout 60s;\n    }\n}\n`;
}
export class LocalAccountStore {
  constructor({ dir = join(project, '.local/accounts'), rootUrl, webPort = 3000, basePort = 4300, test = false, sqlAccountHost = '127.0.0.1', supervise = false } = {}) {
    this.dir = resolve(dir); this.rootUrl = rootUrl; this.webPort = webPort; this.basePort = basePort; this.test = test;
    if (![webPort, basePort].every((p) => Number.isInteger(p) && p >= 1024 && p <= 65525)) throw error(400, '端口配置无效');
    this.workers = new Map(); this.tail = Promise.resolve(); this.supervise = supervise; this.stopping = false; this.restartTimers = new Set(); this.restartFailures = new Map();
    if (sqlAccountHost !== '127.0.0.1' && !(test && sqlAccountHost === '%')) throw error(400, '正式安装仅允许本机数据库账号；通配主机仅用于隔离CI容器测试');
    this.sqlAccountHost = sqlAccountHost;
  }
  async init() {
    const recovery = join(this.dir, 'restore-receipt.json');
    if (existsSync(recovery) && JSON.parse(readFileSync(recovery, 'utf8')).status !== 'verified-offline') throw error(503, '帐套恢复尚未验证完成，禁止启动或新建公司');
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.registryFile = join(this.dir, 'registry.json');
    this.tokenFile = join(this.dir, 'management-token.txt');
    if (!existsSync(this.tokenFile)) writeFileSync(this.tokenFile, hex(), { flag: 'wx', mode: 0o600 });
    this.token = readFileSync(this.tokenFile, 'utf8').trim();
    this.registry = existsSync(this.registryFile) ? JSON.parse(readFileSync(this.registryFile, 'utf8')) : { version: 1, accounts: [], remote: { mode: 'none', url: '' } };
    if (this.registry.version !== 1 || !Array.isArray(this.registry.accounts)) throw new Error('Unsupported company registry');
    if (!this.rootUrl) {
      const credentials = JSON.parse(readFileSync(join(homedir(), '.local/share/tb-crm-runtime/.credentials.json'), 'utf8'));
      const u = new URL('mysql://root@127.0.0.1:3307/mysql'); u.password = credentials.rootPassword; this.rootUrl = u.href;
    }
    this.root = new PrismaClient({ datasourceUrl: this.rootUrl }); await this.root.$connect();
    return this;
  }
  persist() {
    const temp = this.registryFile + '.tmp'; writeFileSync(temp, JSON.stringify(this.registry, null, 2), { mode: 0o600 }); renameSync(temp, this.registryFile);
  }
  records() { return this.registry.accounts.map(({ code, name, database, dbUser, createdAt, status, port, purpose }) => ({ code, name, database, dbUser, createdAt, status, purpose: purpose || 'business', running: this.workers.has(code), port })); }
  create(value) {
    const input = accountInput(value);
    const work = this.tail.then(() => this.provision(input)); this.tail = work.catch(() => {}); return work;
  }
  async provision({ code, name, purpose = 'business' }) {
    if (this.registry.accounts.some((a) => a.code === code)) throw error(409, '公司编码已存在；不会覆盖已有帐套');
    if (this.registry.accounts.length >= 10) throw error(409, '本机已达到10个帐套的容量配置，请先评估资源再扩容');
    const id = createHash('sha256').update(code + randomBytes(16).toString('hex')).digest('hex').slice(0, 16);
    const database = (this.test ? 'tbcrm_test_' : 'tbcrm_c_') + id;
    const dbUser = 'crm_' + id;
    const dbPassword = hex();
    const u = new URL(this.rootUrl); u.username = dbUser; u.password = dbPassword; u.pathname = '/' + database;
    const initialPassword = 'CrmA7' + randomBytes(16).toString('hex');
    const config = { DEMO_MODE: 'false', ACCOUNT_PURPOSE: purpose, TENANT_CODE: code, TENANT_NAME: name, ADMIN_USERNAME: 'admin', SEED_ADMIN_PASSWORD: initialPassword,
      DATABASE_URL: u.href, JWT_SECRET: hex(), ENCRYPTION_KEY: hex(), BACKUP_KEY: hex(), APP_URL: `http://localhost:${this.webPort}`, WEB_PORT: String(this.webPort) };
    const entry = { code, name, database, dbUser, purpose, port: this.basePort + this.registry.accounts.length,
      configFile: join(this.dir, code + '.json'), createdAt: new Date().toISOString(), status: 'creating' };
    // All SQL identifiers and passwords below are generated ASCII, never interpolated company input.
    writeFileSync(entry.configFile, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
    this.registry.accounts.push(entry); this.persist();
    try {
      await this.root.$executeRawUnsafe(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await this.root.$executeRawUnsafe(`CREATE USER '${dbUser}'@'${this.sqlAccountHost}' IDENTIFIED BY '${dbPassword}'`);
      await this.root.$executeRawUnsafe(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${dbUser}'@'${this.sqlAccountHost}'`);
      await new Promise((done, fail) => {
        const output = openSync(join(this.dir, code + '-初始化.log'), 'a', 0o600);
        const migration = spawn('pnpm', ['--filter', '@partneros/database', 'migrate:deploy'], { cwd: project, env: { ...process.env, ...config }, stdio: ['ignore', output, output] });
        closeSync(output);
        const timeout = setTimeout(() => { migration.kill('SIGTERM'); fail(new Error('数据库结构初始化超时')); }, 120000);
        migration.once('error', (e) => { clearTimeout(timeout); fail(e); });
        migration.once('exit', (status) => { clearTimeout(timeout); status === 0 ? done() : fail(new Error('数据库结构初始化失败，请查看本机初始化日志')); });
      });
      const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
      try { await initializeProduction(db, config); } finally { await db.$disconnect(); }
      entry.status = 'ready'; this.persist();
      writeFileSync(join(this.dir, code + '-账号说明.txt'), `伴圆CRM公司帐套\n公司：${name}\n编码：${code}\n账号：admin\n初始密码：${initialPassword}\n本机：http://localhost:${this.webPort}/login?company=${code}\n公司业务数据为空。请在系统管理中创建员工账号。\n`, { mode: 0o600, flag: 'wx' });
      return { account: this.records().find((a) => a.code === code), username: 'admin', initialPassword };
    } catch (e) {
      entry.status = 'failed'; this.persist();
      writeFileSync(join(this.dir, code + '-失败记录.txt'), e.message, { mode: 0o600 });
      throw error(500, '帐套初始化未完成，已有帐套未受影响；请检查本机失败记录');
    }
  }
  config(code) {
    const account = this.registry.accounts.find((a) => a.code === code && a.status === 'ready');
    if (!account) throw error(404, '公司帐套不存在或尚未完成初始化');
    return { account, config: JSON.parse(readFileSync(account.configFile, 'utf8')) };
  }
  async start(code) {
    if (this.stopping) throw error(503, '服务正在停止');
    if (this.workers.has(code)) return;
    const { account, config } = this.config(code);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'HOME', 'SystemRoot', 'TEMP', 'TMPDIR', 'LANG', 'TZ'].includes(key)));
    // Workers receive only their own database credentials; no provisioning/root or other-company secrets.
    for (const [key, value] of Object.entries(config)) {
      if (!['SEED_ADMIN_PASSWORD', 'BACKUP_KEY', 'WEB_PORT'].includes(key)) env[key] = value;
    }
    env.PORT = String(account.port); env.HOST = '127.0.0.1'; env.CRM_ACCOUNT_WORKER = 'true';
    const log = openSync(join(this.dir, code + '.log'), 'a', 0o600);
    const child = spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: project, env, stdio: ['ignore', 'pipe', log] });
    closeSync(log);
    let listening = false;
    child.stdout.on('data', (b) => { if (String(b).includes('API running on http')) listening = true; });
    this.workers.set(code, child);
    const startedAt = Date.now();
    child.once('exit', () => {
      if (this.workers.get(code) === child) this.workers.delete(code);
      if (Date.now() - startedAt > 60000) this.restartFailures.delete(code);
      if (this.supervise && !this.stopping) this.scheduleRestart(code);
    });
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw error(503, '帐套服务启动失败，请查看本机日志');
      if (listening) {
        try { if ((await fetch(`http://127.0.0.1:${account.port}/api/v1/health/ready`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
      }
      await delay(100);
    }
    child.kill('SIGTERM'); throw error(503, '帐套服务启动超时');
  }
  scheduleRestart(code) {
    const failures = (this.restartFailures.get(code) || 0) + 1;
    this.restartFailures.set(code, failures);
    const timer = setTimeout(() => {
      this.restartTimers.delete(timer);
      if (!this.stopping && !this.workers.has(code)) void this.start(code).catch(() => {
        // Exit handler schedules the next attempt; no credentials or raw errors in logs.
        console.error(`公司帐套 ${code} 重启未完成，请检查本机日志`);
      });
    }, Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5)));
    this.restartTimers.add(timer); timer.unref();
  }
  async startAll() { for (const a of this.registry.accounts) if (a.status === 'ready') { try { await this.start(a.code); } catch { console.error(`公司帐套 ${a.code} 服务未启动，请查看本机日志`); } } }
  async stop() {
    this.stopping = true;
    for (const timer of this.restartTimers) clearTimeout(timer);
    this.restartTimers.clear();
    await Promise.all([...this.workers.values()].map(child => new Promise(done => {
      if (child.exitCode !== null || child.signalCode !== null) { done(); return; }
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => { clearTimeout(timeout); done(); });
      child.kill('SIGTERM');
    })));
    this.workers.clear(); await this.root?.$disconnect();
  }
}
const isLoopback = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
function body(req) {
  return new Promise((resolveBody, reject) => {
    let text = ''; req.on('data', (chunk) => { text += chunk; if (Buffer.byteLength(text) > 65536) { reject(error(413, '请求过大')); req.destroy(); } });
    req.on('end', () => { try { resolveBody(JSON.parse(text || '{}')); } catch { reject(error(400, 'JSON格式无效')); } }); req.on('error', reject);
  });
}
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
export function lanAddresses(port) {
  return Object.values(networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address)).map((n) => `http://${n.address}:${port}`);
}
export function accountServer(store) {
  const staticRoot = join(project, 'apps/web/dist');
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      const allowedHosts = new Set([`localhost:${store.webPort}`, `127.0.0.1:${store.webPort}`, ...lanAddresses(store.webPort).map((u) => new URL(u).host)]);
      if (store.registry.remote?.url) allowedHosts.add(new URL(store.registry.remote.url).host);
      if (!allowedHosts.has(host)) throw error(403, '访问地址未配置');
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname.startsWith('/__accounts')) {
        if (!isLoopback(req.socket.remoteAddress) || ![`localhost:${store.webPort}`, `127.0.0.1:${store.webPort}`].includes(host)) throw error(403, '帐套管理仅允许在服务器本机操作');
        if (pathname === '/__accounts' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' }); res.end(readFileSync(join(project, 'deploy/accounts-admin.html'))); return;
        }
        const supplied = req.headers.authorization?.replace(/^Bearer /, '') || '';
        if (!/^[a-f0-9]{64}$/.test(supplied) || supplied.length !== store.token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(store.token))) throw error(401, '请输入本机帐套管理口令');
        if (req.headers.origin && ![`http://localhost:${store.webPort}`, `http://127.0.0.1:${store.webPort}`].includes(req.headers.origin)) throw error(403, '不允许跨站管理请求');
        if (pathname === '/__accounts/api' && req.method === 'GET') { json(res, 200, { accounts: store.records(), remote: store.registry.remote, local: `http://localhost:${store.webPort}`, lan: lanAddresses(store.webPort) }); return; }
        if (pathname === '/__accounts/proxy-config' && req.method === 'GET') { json(res, 200, { configuration: proxyConfiguration(store.registry.remote, store.webPort) }); return; }
        if (pathname === '/__accounts/check' && req.method === 'GET') {
          const checks = await Promise.all(store.records().map(async (a) => { let ready = false; if (a.running) { try { ready = (await fetch(`http://127.0.0.1:${a.port}/api/v1/health/ready`, { signal: AbortSignal.timeout(2000) })).ok; } catch {} } return { code: a.code, ready }; }));
          json(res, 200, { checks, remote: '外网连通尚未验证；请在外部手机网络实际访问后确认', checkedAt: new Date().toISOString() }); return;
        }
        if (pathname === '/__accounts/api' && req.method === 'POST') { const created = await store.create(await body(req)); await store.start(created.account.code); json(res, 201, created); return; }
        if (pathname === '/__accounts/remote' && req.method === 'PUT') { store.registry.remote = remoteInput(await body(req)); store.persist(); json(res, 200, { ...store.registry.remote, status: '入口配置已保存，外部联通尚未验证' }); return; }
        if (pathname === '/__accounts/start' && req.method === 'POST') { const input = await body(req); if (typeof input.code !== 'string') throw error(400, '公司编码无效'); await store.start(input.code); json(res, 200, { status: 'running' }); return; }
        throw error(404, '管理入口不存在');
      }
      if (pathname.startsWith('/api/')) {
        const header = req.headers['x-company-code'];
        const code = typeof header === 'string' && header ? header : store.registry.accounts.filter((a) => a.status === 'ready').length === 1 ? store.registry.accounts.find((a) => a.status === 'ready').code : '';
        const account = store.registry.accounts.find((a) => a.code === code && a.status === 'ready');
        if (!account || !store.workers.has(code)) throw error(400, '请选择有效的公司帐套后登录');
        const upstream = httpRequest({ hostname: '127.0.0.1', port: account.port, method: req.method, path: req.url,
          headers: { ...req.headers, host: `127.0.0.1:${account.port}` }, timeout: 30000 }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
        upstream.on('timeout', () => upstream.destroy());
        upstream.on('error', () => { if (!res.headersSent) json(res, 502, { code: 502, message: '公司帐套服务暂不可用，请重试' }); else res.end(); });
        req.pipe(upstream); return;
      }
      const decoded = decodeURIComponent(pathname);
      let file = resolve(staticRoot, '.' + decoded);
      if (file !== staticRoot && !file.startsWith(staticRoot + sep)) throw error(403, '路径无效');
      if (!existsSync(file) || file === staticRoot) file = join(staticRoot, 'index.html');
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-store' : 'public,max-age=3600', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' }); res.end(readFileSync(file));
    } catch (e) { if (!res.headersSent) json(res, e.status || 500, { code: e.status || 500, message: e.status ? e.message : '操作失败，请查看服务器日志' }); else res.end(); }
  });
  return server;
}
async function main() {
  const directory = resolve(process.env.ACCOUNT_DIRECTORY || join(project, '.local/accounts'));
  const release = acquireInstallationLock(directory);
  process.once('exit', release);
  const store = await new LocalAccountStore({ dir: directory, rootUrl: process.env.ACCOUNT_ROOT_DATABASE_URL, webPort: Number(process.env.ACCOUNT_WEB_PORT || 3000), basePort: Number(process.env.ACCOUNT_BASE_PORT || 4300), supervise: true }).init();
  const command = process.argv[2] || 'serve';
  if (command === 'create') {
    try {
      const created = await store.create({ code: process.env.NEW_COMPANY_CODE, name: process.env.NEW_COMPANY_NAME, purpose: process.env.NEW_COMPANY_PURPOSE });
      console.log(`帐套 ${created.account.code} 已创建；账号说明位于本机帐套目录。`);
    } finally { await store.stop(); }
    return;
  }
  if (command !== 'serve') throw new Error('Use serve or create');
  const server = accountServer(store);
  try { await new Promise((done, fail) => { server.once('error', fail); server.listen(store.webPort, '0.0.0.0', done); }); }
  catch (e) { await store.stop(); throw e; }
  const stop = async () => { server.close(); await store.stop(); }; process.on('SIGINT', stop); process.on('SIGTERM', stop);
  await store.startAll();
  console.log(`伴圆CRM：http://localhost:${store.webPort}；公司帐套管理：http://localhost:${store.webPort}/__accounts`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('启动失败，请检查本机数据库、帐套配置和日志。'); process.exitCode = 1; });
