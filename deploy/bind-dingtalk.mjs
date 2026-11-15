// Operator-only local binding. Never expose profile enumeration through company HTTP APIs.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const code = process.argv[2];
if (!code || !/^[A-Z][A-Z0-9_-]{1,29}$/.test(code) || process.argv.length !== 3) throw new Error('用法：node deploy/bind-dingtalk.mjs 公司编码');
const dir = join(project, '.local/accounts');
const registry = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'));
const account = registry.accounts.find((item) => item.code === code && item.status === 'ready');
if (!account) throw new Error('公司帐套不存在或未就绪');
const profiles = JSON.parse(execFileSync(process.env.DWS_BINARY || 'dws', ['profile', 'list', '--format', 'json'], { encoding: 'utf8', timeout: 30000 }));
if (profiles.success !== true || !Array.isArray(profiles.profiles)) throw new Error('无法读取钉钉授权账号');
const matches = profiles.profiles.filter((item) => item.isOrgCurrent === true && item.corpName === account.name);
if (matches.length !== 1) throw new Error('公司名称下没有唯一的当前授权账号；先在钉钉授权正确企业，不会选择第一个账号');
const selected = matches[0];
if (![selected.profile, selected.corpId, selected.userId].every((item) => typeof item === 'string' && item.length > 0)) throw new Error('授权身份信息不完整');
const configuration = JSON.parse(readFileSync(account.configFile, 'utf8'));
if (configuration.DWS_EXPECTED_CORP_ID && (configuration.DWS_EXPECTED_CORP_ID !== selected.corpId || configuration.DWS_EXPECTED_USER_ID !== selected.userId))
  throw new Error('已有其他企业或账号的绑定，拒绝静默改绑；请先核对旧对应关系');
Object.assign(configuration, { DWS_PROFILE: selected.profile, ...(process.env.DWS_BINARY ? { DWS_BINARY: process.env.DWS_BINARY } : {}), DWS_EXPECTED_CORP_ID: selected.corpId, DWS_EXPECTED_USER_ID: selected.userId });
const temp = account.configFile + '.dws.tmp';
writeFileSync(temp, JSON.stringify(configuration, null, 2), { mode: 0o600, flag: 'wx' });
renameSync(temp, account.configFile);
console.log(JSON.stringify({ company: code, companyName: selected.corpName, readerName: selected.userName, message: '绑定已保存；重启该公司服务后，在集成页面启用并预览。未导入任何数据。' }));
