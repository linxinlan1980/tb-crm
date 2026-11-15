import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

export interface DwsBinding {
  profile: string;
  corpId: string;
  userId: string;
}
export interface RemoteDepartment {
  externalId: string;
  parentExternalId: string | null;
  name: string;
  depth: number;
}
export interface RemotePerson {
  externalId: string;
  name: string;
  departmentIds: string[];
  position: string | null;
  phone?: string;
}
export interface DirectorySnapshot {
  bindingHash: string;
  companyName: string;
  readerName: string;
  capturedAt: string;
  departments: RemoteDepartment[];
  people: RemotePerson[];
  complete: boolean;
  hasMore: boolean;
  stopReason: string | null;
  failures: string[];
}
export type DwsRead = (args: string[]) => Promise<unknown>;
const exec = promisify(execFile);
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('钉钉返回结构不符');
  return value as Record<string, unknown>;
}
function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : Object.values(record(value));
}
function required(value: unknown, max = 200): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim() || String(value).length > max)
    throw new Error('钉钉返回的编号或名称无效');
  return String(value).trim();
}
function success(value: unknown) {
  const result = record(value);
  if (result.success !== true) throw new Error('钉钉读取失败，请检查授权和可见范围');
  // No silent first-page success if a future CLI adds pagination.
  if (result.hasMore === true || result.has_more === true || result.nextCursor || result.nextToken)
    throw new Error('钉钉返回未读取分页，当前批次拒绝导入');
  return result;
}
export function bindingHash(binding: DwsBinding) {
  return createHash('sha256').update(JSON.stringify(binding)).digest('hex');
}
export function bindingFromEnvironment(): DwsBinding | null {
  const { DWS_PROFILE: profile, DWS_EXPECTED_CORP_ID: corpId, DWS_EXPECTED_USER_ID: userId } = process.env;
  if (!profile || !corpId || !userId) return null;
  return { profile, corpId, userId };
}
export function dwsReader(binding: DwsBinding): DwsRead {
  return async (args) => {
    // Fixed executable/operator binding; no shell, arbitrary executable, profile or flags from HTTP.
    const { stdout } = await exec(
      process.env.DWS_BINARY || 'dws',
      [...args, '--profile', binding.profile, '--format', 'json'],
      { timeout: 45000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    return JSON.parse(stdout) as unknown;
  };
}
export async function readDirectory(binding: DwsBinding, read: DwsRead): Promise<DirectorySnapshot> {
  const startedAt = Date.now(),
    execute = read;
  let calls = 0;
  read = async (args) => {
    if (++calls > 1000 || Date.now() - startedAt > 8 * 60000) throw new Error('通讯录读取超过调用或8分钟预算');
    return execute(args);
  };
  const identity = success(await read(['contact', 'user', 'get-self']));
  const entries = values(identity.result);
  if (entries.length !== 1) throw new Error('钉钉身份不唯一');
  const self = record(record(entries[0]).orgEmployeeModel);
  if (self.corpId !== binding.corpId || self.userId !== binding.userId)
    throw new Error('钉钉企业或账号与帐套绑定不一致');
  const snapshot: DirectorySnapshot = {
    bindingHash: bindingHash(binding),
    companyName: required(self.orgName, 100),
    readerName: required(self.orgUserName, 50),
    capturedAt: new Date().toISOString(),
    departments: [],
    people: [],
    complete: false,
    hasMore: false,
    stopReason: null,
    failures: [],
  };
  const root = record(success(await read(['contact', 'dept', 'get-info', '--dept', '1'])).result);
  if (String(root.deptId) !== '1') throw new Error('钉钉根部门编号不符');
  const queue: RemoteDepartment[] = [
    { externalId: '1', name: required(root.deptName, 100), parentExternalId: null, depth: 0 },
  ];
  const discovered = new Map(queue.map((d) => [d.externalId, d]));
  const visited = new Set<string>();
  const members = new Map<string, RemotePerson>();
  for (let index = 0; index < queue.length; index++) {
    const department = queue[index];
    if (visited.has(department.externalId)) continue;
    if (visited.size >= 200 || department.depth > 19) {
      snapshot.failures.push('部门超过200个或20层读取预算');
      break;
    }
    visited.add(department.externalId);
    snapshot.departments.push(department);
    try {
      const result = success(await read(['contact', 'dept', 'list-children', '--dept', department.externalId]));
      if (!Array.isArray(result.result)) throw new Error('子部门列表结构不符');
      for (const item of result.result) {
        const child = record(item),
          externalId = required(child.deptId, 100);
        if (discovered.size >= 200) throw new Error('部门超过200个读取预算');
        if (externalId === '1' || discovered.has(externalId)) throw new Error('部门重复或循环引用');
        const row = {
          externalId,
          parentExternalId: department.externalId,
          name: required(child.deptName, 100),
          depth: department.depth + 1,
        };
        discovered.set(externalId, row);
        queue.push(row);
      }
      const resultMembers = success(await read(['contact', 'dept', 'list-members', '--depts', department.externalId]));
      if (!Array.isArray(resultMembers.deptUserList)) throw new Error('部门人员列表结构不符');
      for (const item of resultMembers.deptUserList) {
        const info = record(record(item).userInfo),
          externalId = required(info.userId, 50);
        if (!members.has(externalId))
          members.set(externalId, { externalId, name: required(info.name, 50), departmentIds: [], position: null });
        members.get(externalId)!.departmentIds.push(department.externalId);
      }
      if (members.size > 500) throw new Error('人员超过500个读取预算');
    } catch {
      snapshot.failures.push(`部门${department.externalId}未完整读取`);
    }
  }
  if (members.size <= 500) {
    for (const person of members.values()) {
      try {
        const result = success(await read(['contact', 'user', 'get', '--ids', person.externalId]));
        const details = values(result.result);
        if (details.length !== 1) throw new Error('人员详情不唯一');
        const employee = record(record(details[0]).orgEmployeeModel);
        if (employee.orgUserId !== person.externalId) throw new Error('人员详情编号不一致');
        person.name = required(employee.orgUserName, 50);
        person.position = typeof employee.orgTitle === 'string' ? employee.orgTitle.slice(0, 50) || null : null;
        const visibleMobile = person.externalId === binding.userId ? self.orgUserMobile : employee.orgUserMobile;
        if (typeof visibleMobile === 'string') {
          const phone=visibleMobile.replace(/[\s()-]/g,'').replace(/^\+?86(?=1\d{10}$)/,'');
          if(/^1\d{10}$/.test(phone)) person.phone=phone;
        }
        person.departmentIds = [...new Set(person.departmentIds)];
        snapshot.people.push(person);
      } catch {
        snapshot.failures.push(`人员${person.externalId}详情未完整读取`);
      }
    }
  } else snapshot.failures.push('人员超过500个读取预算');
  snapshot.complete = snapshot.failures.length === 0;
  snapshot.hasMore = !snapshot.complete;
  snapshot.stopReason = snapshot.complete ? null : 'partial_or_budget';
  return snapshot;
}
