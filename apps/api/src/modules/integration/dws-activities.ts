import { record, type DwsBinding, type DwsRead } from './dws-directory';

/** An uncertain external write is never retried as a fresh create. Persist this state and reconcile first. */
export class UncertainActivityWrite extends Error {
  constructor(readonly externalId: string | null) {
    super('钉钉写入结果尚未核验；须先对账，禁止重复创建');
  }
}
export interface CalendarProjection {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  freeBusy: string;
  status: string;
}
export interface TodoProjection {
  id: string;
  title: string;
  done: boolean;
  executorIds: string[];
}
function required(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('钉钉活动字段无效');
  return value;
}
function acknowledgement(value: unknown) {
  const response = record(value);
  if (response.success !== true) throw new Error('钉钉操作未成功，请核对企业授权或运行确认要求');
  return response;
}
function result(value: unknown) {
  return record(acknowledgement(value).result);
}
function iso(value: unknown) {
  const raw = required(value, 80);
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(raw) || !Number.isFinite(Date.parse(raw)))
    throw new Error('日程必须使用带时区的ISO时间');
  return raw;
}
export function calendarProjection(value: unknown, expectedId: string): CalendarProjection {
  const data = result(value);
  if (data.id !== expectedId) throw new Error('钉钉日程返回编号不符');
  return {
    id: expectedId,
    title: required(data.summary),
    description: typeof data.description === 'string' ? data.description : '',
    start: iso(record(data.start).dateTime),
    end: iso(record(data.end).dateTime),
    freeBusy: required(data.freeBusy, 20).toLowerCase(),
    status: required(data.status, 40),
  };
}
export function todoProjection(value: unknown, expectedId: string): TodoProjection {
  const data = record(result(value).todoDetailModel);
  if (data.taskId !== expectedId || typeof data.isDone !== 'boolean' || !Array.isArray(data.executorIds))
    throw new Error('钉钉待办返回编号、状态或执行者不符');
  return {
    id: expectedId,
    title: required(data.subject),
    done: data.isDone,
    executorIds: data.executorIds.map((id) => required(id, 100)),
  };
}
export interface CalendarInput {
  title: string;
  description: string;
  start: string;
  end: string;
  freeBusy: 'busy' | 'free';
}
function calendarArgs(input: CalendarInput) {
  required(input.title);
  if (typeof input.description !== 'string' || input.description.length > 5000) throw new Error('日程描述超限');
  iso(input.start);
  iso(input.end);
  if (Date.parse(input.end) <= Date.parse(input.start)) throw new Error('日程结束须晚于开始');
  if (!['busy', 'free'].includes(input.freeBusy)) throw new Error('日程忙闲字段无效');
  return ['--title', input.title, '--desc', input.description, '--start', input.start, '--end', input.end,
    '--free-busy', input.freeBusy];
}
function sameCalendar(actual: CalendarProjection, input: CalendarInput) {
  return actual.title === input.title && actual.description === input.description &&
    Date.parse(actual.start) === Date.parse(input.start) && Date.parse(actual.end) === Date.parse(input.end) &&
    actual.freeBusy === input.freeBusy;
}
/** Only the operator-bound user's primary calendar and own todos. No arbitrary participants/profile/CLI from HTTP. */
export class DwsActivities {
  constructor(private binding: DwsBinding, private call: DwsRead) {}
  async verifyIdentity() {
    const response = record(await this.call(['contact', 'user', 'get-self']));
    if (response.success !== true) throw new Error('钉钉身份读取失败');
    const entries = Array.isArray(response.result) ? response.result : Object.values(record(response.result));
    if (entries.length !== 1) throw new Error('钉钉授权身份不唯一');
    const self = record(record(entries[0]).orgEmployeeModel);
    if (self.corpId !== this.binding.corpId || self.userId !== this.binding.userId)
      throw new Error('钉钉企业或人员与帐套绑定不符');
  }
  async calendar(id: string) {
    required(id, 200);
    return calendarProjection(await this.call(['calendar', 'event', 'get', '--id', id]), id);
  }
  private async readOwnTodo(id: string) {
    required(id, 200);
    const item = todoProjection(await this.call(['todo', 'task', 'get', '--task-id', id]), id);
    if (item.executorIds.length !== 1) throw new Error('仅同步唯一执行人的本人待办');
    // Todo executorIds are internal personal IDs, NOT directory employee userIds. Prove ownership
    // through the authenticated "my executing tasks" inventory; never compare names or guess IDs.
    const inventory = record(await this.call(['todo', '+get-my-tasks', '--all', '--status', String(item.done)]));
    const data = record(inventory.data);
    if (inventory.ok !== true || inventory.outcome !== 'success' || data.complete !== true ||
      !Array.isArray(data.todos) || data.todos.length > 5000 ||
      data.todos.filter((entry) => record(entry).taskId === id).length !== 1)
      throw new Error('待办未在当前授权本人的完整执行列表中唯一匹配');
    return item;
  }
  async todo(id: string) {
    await this.verifyIdentity();
    return this.readOwnTodo(id);
  }
  async writeCalendar(input: CalendarInput, externalId: string | null) {
    const args = calendarArgs(input);
    if (externalId !== null) required(externalId, 200);
    await this.verifyIdentity();
    let knownId = externalId;
    try {
      const response = acknowledgement(await this.call(['calendar', 'event', externalId ? 'update' : 'create',
        ...(externalId ? ['--id', externalId] : []), ...args]));
      if (!externalId) knownId = required(record(response.result).id, 200);
      const actual = await this.calendar(knownId!);
      if (!sameCalendar(actual, input)) throw new Error('日程写后字段不符');
      return actual;
    } catch {
      throw new UncertainActivityWrite(knownId);
    }
  }
  async createTodo(title: string) {
    required(title);
    await this.verifyIdentity();
    let knownId: string | null = null;
    try {
      const response = result(await this.call(['todo', 'task', 'create', '--title', title,
        '--executors', this.binding.userId, '--priority', '20']));
      knownId = required(response.taskId, 200);
      const actual = await this.readOwnTodo(knownId);
      if (actual.title !== title || actual.done) throw new Error('新待办读回不符');
      return actual;
    } catch {
      throw new UncertainActivityWrite(knownId);
    }
  }
  async setTodoDone(externalId: string, done: boolean) {
    required(externalId, 200);
    if (typeof done !== 'boolean') throw new Error('待办完成状态须为布尔值');
    await this.verifyIdentity();
    const prior = await this.readOwnTodo(externalId);
    if (prior.done === done) return prior;
    try {
      acknowledgement(await this.call(['todo', 'task', 'done', '--task-id', externalId, '--status', String(done)]));
      const actual = todoProjection(await this.call(['todo', 'task', 'get', '--task-id', externalId]), externalId);
      if (JSON.stringify(actual.executorIds) !== JSON.stringify(prior.executorIds) || actual.done !== done) throw new Error('待办状态读回不符');
      return actual;
    } catch {
      throw new UncertainActivityWrite(externalId);
    }
  }
}
