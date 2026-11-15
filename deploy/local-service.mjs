// macOS user service: launches the existing installation after login, without rebuilding it.
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
const project = fileURLToPath(new URL('../', import.meta.url));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const listening = port => new Promise(done => {
  const socket = connect({ host: '127.0.0.1', port });
  const finish = value => { socket.destroy(); done(value); };
  socket.setTimeout(500); socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.once('timeout', () => finish(false));
});
export function servicePlist({ label = 'cn.tingmeng.tb-crm', directory = join(project, '.local/accounts'), webPort = 3000, basePort = 4300, node = process.execPath, source = project } = {}) {
  if (!/^[a-z][a-z0-9.-]{2,100}$/.test(label)) throw new Error('Invalid service label');
  if (![webPort, basePort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65525) || webPort >= basePort && webPort < basePort + 10) throw new Error('Invalid service ports');
  directory = resolve(directory); source = resolve(source); node = resolve(node);
  const string = value => '<string>' + escape(value) + '</string>';
  const fields = {
    Label: string(label),
    ProgramArguments: '<array>' + [node, join(source, 'scripts/start-local.mjs'), '--no-build'].map(string).join('') + '</array>',
    WorkingDirectory: string(source), RunAtLoad: '<true/>', KeepAlive: '<true/>', ThrottleInterval: '<integer>15</integer>',
    ProcessType: string('Background'), ExitTimeOut: '<integer>20</integer>',
    StandardOutPath: string(join(directory, 'service.stdout.log')), StandardErrorPath: string(join(directory, 'service.stderr.log')),
    EnvironmentVariables: '<dict>' + Object.entries({ PATH: [dirname(node), join(homedir(), '.local/bin'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':'),
      ACCOUNT_DIRECTORY: directory, ACCOUNT_WEB_PORT: String(webPort), ACCOUNT_BASE_PORT: String(basePort), TZ: 'Asia/Shanghai' })
      .map(([key, value]) => '<key>' + escape(key) + '</key>' + string(value)).join('') + '</dict>',
  };
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>' + Object.entries(fields).map(([key, value]) => '<key>' + key + '</key>' + value).join('') + '</dict></plist>\n';
}
async function main() {
  if (process.platform !== 'darwin') throw new Error('This service installer is macOS-only; Linux servers use the documented Docker restart policy');
  const command = process.argv[2] || 'status', label = process.env.CRM_SERVICE_LABEL || 'cn.tingmeng.tb-crm';
  const directory = resolve(process.env.ACCOUNT_DIRECTORY || join(project, '.local/accounts'));
  const options = { label, directory, webPort: Number(process.env.ACCOUNT_WEB_PORT || 3000), basePort: Number(process.env.ACCOUNT_BASE_PORT || 4300) };
  const plist = servicePlist(options);
  const path = join(homedir(), 'Library/LaunchAgents', label + '.plist');
  const service = 'gui/' + process.getuid() + '/' + label;
  const run = args => {
    const result = spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error('launchctl failed: ' + result.stderr.trim().slice(0, 300));
    return result.stdout;
  };
  if (command === 'render') { console.log(plist); return; }
  if (command === 'status') {
    const result = spawnSync('/bin/launchctl', ['print', service], { encoding: 'utf8' });
    const state = result.stdout.match(/^\s*state = (.+)$/m)?.[1];
    const pid = result.stdout.match(/^\s*pid = (\d+)$/m)?.[1];
    console.log(JSON.stringify({ installed: existsSync(path), loaded: result.status === 0, state, pid: pid ? Number(pid) : undefined })); return;
  }
  if (command === 'install') {
    if (!existsSync(join(directory, 'registry.json')) || !existsSync(join(project, 'apps/api/dist/main.js')) || !existsSync(join(project, 'apps/web/dist/index.html'))) throw new Error('Build and configure the installation before installing its service');
    if (existsSync(path)) throw new Error('Service configuration already exists; stop/uninstall it before replacing it');
    const registry = JSON.parse(readFileSync(join(directory, 'registry.json'), 'utf8'));
    if (registry.accounts.some(a => a.status !== 'ready')) throw new Error('Company initialization/recovery is incomplete');
    if (await listening(options.webPort)) throw new Error('Stop the manual gateway before installing its service');
    for (const account of registry.accounts) if (await listening(account.port)) throw new Error('Stop the manual company workers before installing their service');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, plist, { flag: 'wx', mode: 0o600 });
    try { run(['bootstrap', 'gui/' + process.getuid(), path]); }
    catch (e) { throw new Error(e.message + '; plist retained for inspection at ' + path); }
    console.log(JSON.stringify({ installed: true, label, webPort: options.webPort, directory })); return;
  }
  if (command === 'start') { run(['bootstrap', 'gui/' + process.getuid(), path]); return; }
  if (command === 'stop') { run(['bootout', service]); return; }
  if (command === 'uninstall') {
    // Refuse removal while loaded: stopping is a separate explicit operation.
    if (spawnSync('/bin/launchctl', ['print', service]).status === 0) throw new Error('Stop the service before uninstalling its configuration');
    unlinkSync(path); console.log('Service configuration removed; databases and accounts preserved'); return;
  }
  throw new Error('Usage: node deploy/local-service.mjs render|install|status|start|stop|uninstall');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
