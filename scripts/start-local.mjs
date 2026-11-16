import { existsSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const listening = () => new Promise((done) => { const socket = connect({ host: '127.0.0.1', port: 3307 }); socket.setTimeout(1000); socket.once('connect', () => { socket.destroy(); done(true); }); socket.once('error', () => done(false)); socket.once('timeout', () => { socket.destroy(); done(false); }); });
if (!process.env.ACCOUNT_ROOT_DATABASE_URL && !(await listening())) {
  const dir = join(homedir(), '.local/share/tb-crm-runtime');
  const base = join(dir, 'mysql-8.4.11-macos15-arm64'), data = join(dir, 'demo-data');
  if (!existsSync(join(base, 'bin/mysqld')) || !existsSync(data)) throw new Error('请先安装MySQL并配置ACCOUNT_ROOT_DATABASE_URL，参见本地安装说明。');
  const log = openSync(join(dir, 'mysql-launch.log'), 'a', 0o600);
  const mysql = spawn(join(base, 'bin/mysqld'), ['--no-defaults', '--basedir=' + base, '--datadir=' + data, '--bind-address=127.0.0.1', '--port=3307', '--mysqlx=OFF', '--socket=' + join(dir, 'mysql.sock'), '--log-error=' + join(dir, 'mysql.log'), '--pid-file=' + join(dir, 'mysql.pid')], { detached: true, stdio: ['ignore', log, log] }); mysql.unref();
  for (let i = 0; i < 60 && !(await listening()); i++) await delay(250);
  if (!(await listening())) throw new Error('MySQL未就绪，请查看本机运行日志。');
}
if (process.argv.includes('--no-build')) {
  if (!existsSync('apps/api/dist/main.js') || !existsSync('apps/web/dist/index.html')) throw new Error('请先运行pnpm build；守护服务不自动构建代码。');
} else {
  const built = spawnSync('pnpm', ['build'], { stdio: 'inherit' });
  if (built.status !== 0) process.exit(built.status ?? 1);
}
const app = spawn(process.execPath, [resolve('deploy/local-accounts.mjs'), 'serve'], { env: process.env, stdio: 'inherit' });
process.on('SIGINT', () => app.kill('SIGINT')); process.on('SIGTERM', () => app.kill('SIGTERM')); app.on('exit', (status) => { process.exitCode = status ?? 1; });
