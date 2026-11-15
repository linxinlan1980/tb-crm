import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type ActivitySyncJob, type ActivitySyncSetting } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { roleAuthority } from '../../common/types/role-authority';
import {
  checkVersion,
  id,
  json,
  object,
  runCommand,
  runSystemCommand,
  text,
  validateActor,
  type Tx,
} from '../workspace/command-runner';
import { createSystemPrincipal } from '../workspace/system-principal';
import { permits } from '../system/roles/access-policy';
import { activityBinding } from './activity-binding';
import { bindingFromEnvironment, bindingHash, dwsReader, type DwsBinding } from './dws-directory';
import {
  DwsActivities,
  CalendarConflict,
  UncertainActivityWrite,
  type CalendarInput,
  type CalendarProjection,
  type TodoProjection,
} from './dws-activities';
import { exactFields } from './calendar.service';

type Kind = 'calendar' | 'approval';
interface Payload {
  marker: string;
  calendar?: CalendarInput;
  todo?: { title: string; done: boolean };
}
interface Desired {
  kind: Kind;
  sourceId: number;
  sourceVersion: string;
  payload: Payload;
  externalId: string | null;
  operation: string;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
function kind(value: unknown): Kind {
  if (value !== 'calendar' && value !== 'approval') throw new BadRequestException('同步对象类型无效');
  return value;
}
function view(job: ActivitySyncJob) {
  return {
    id: job.id,
    kind: job.kind,
    sourceId: job.sourceId,
    sourceVersion: job.sourceVersion,
    operation: job.operation,
    payload: job.payload,
    status: job.status,
    error: job.error,
    externalId: job.externalId,
    evidence: job.evidence,
    forceOverwrite: job.forceOverwrite,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
function approvalVisible(permissions: string[]) {
  return ['approval:read', 'approval:create', 'approval:withdraw', 'approval:approve', 'approval:reject'].some((p) =>
    permits(permissions, p),
  );
}
function readable(a: Actor, k: string) {
  if (!(k === 'calendar' ? permits(a.permissions, 'action:read') : approvalVisible(a.permissions)))
    throw new ForbiddenException('当前角色已无此同步对象查看权限');
}
function payloadOf(job: ActivitySyncJob): Payload {
  return object(job.payload) as unknown as Payload;
}
function matches(payload: Payload, actual: CalendarProjection | TodoProjection) {
  if (payload.calendar && 'start' in actual) {
    const c = payload.calendar;
    return (
      actual.attendeeCount === 1 &&
      actual.status === 'confirmed' &&
      c.title === actual.title &&
      c.description === actual.description &&
      c.freeBusy === actual.freeBusy &&
      Date.parse(c.start) === Date.parse(actual.start) &&
      Date.parse(c.end) === Date.parse(actual.end)
    );
  }
  return !!payload.todo && 'done' in actual && payload.todo.title === actual.title && payload.todo.done === actual.done;
}
@Injectable()
export class ActivitySyncService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private scanning = false;
  private stopped = false;
  private executions = new Set<Promise<void>>();
  constructor(private prisma: PrismaService) {}
  async onModuleInit() {
    // Optional module remains inert for unbound pre-migration compatibility probes.
    if (!bindingFromEnvironment()) return;
    await this.prisma.system.activitySyncJob.updateMany({
      where: { status: 'dispatching' },
      data: { status: 'uncertain', error: '服务重启中断；先对账，禁止重新创建' },
    });
    this.timer = setInterval(() => {
      void this.cycle().catch(() => undefined);
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
  private async owner(tx: Tx, tenantId: number, ownerId: number) {
    const user = await tx.user.findFirst({
      where: {
        id: ownerId,
        tenantId,
        status: 'active',
        deletedAt: null,
        tenant: { status: { in: ['active', 'trial'] } },
      },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new ForbiddenException('同步人员或公司已停用');
    return { ...user, authority: roleAuthority(user.roles.map((r) => r.role)) };
  }
  private async context(tx: Tx, tenantId: number, ownerId: number) {
    const user = await this.owner(tx, tenantId, ownerId),
      binding = await activityBinding(tx, tenantId, ownerId);
    if (!binding) throw new BadRequestException('本人尚未完成钉钉授权及组织人员对应，不能借用其他账号');
    const setting = await tx.activitySyncSetting.findUnique({ where: { tenantId_ownerId: { tenantId, ownerId } } });
    if (!setting || setting.bindingHash !== bindingHash(binding))
      throw new ConflictException('请先核对本人钉钉对应并保存同步配置');
    return { user, binding, setting };
  }
  async state(a: Actor) {
    return this.prisma.system.$transaction(async (tx) => {
      await validateActor(tx, a);
      const b = await activityBinding(tx, a.tenantId, a.userId);
      const kinds = ['calendar', 'approval'].filter((k) =>
        k === 'calendar' ? permits(a.permissions, 'action:read') : approvalVisible(a.permissions),
      );
      const [setting, links, jobs, user] = await Promise.all([
        tx.activitySyncSetting.findUnique({ where: { tenantId_ownerId: { tenantId: a.tenantId, ownerId: a.userId } } }),
        tx.activitySyncLink.findMany({
          where: { tenantId: a.tenantId, ownerId: a.userId, kind: { in: kinds }, archivedAt: null },
          orderBy: { createdAt: 'asc' },
          take: 101,
        }),
        Promise.all([
          tx.activitySyncJob.findMany({
            where: {
              tenantId: a.tenantId,
              ownerId: a.userId,
              kind: { in: kinds },
              status: { in: ['prepared', 'dispatching', 'uncertain'] },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
          tx.activitySyncJob.findMany({
            where: {
              tenantId: a.tenantId,
              ownerId: a.userId,
              kind: { in: kinds },
              status: { notIn: ['prepared', 'dispatching', 'uncertain'] },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
        ]).then((groups) => groups.flat().slice(0, 100)),
        tx.user.findUniqueOrThrow({ where: { id: a.userId }, select: { id: true, name: true, username: true } }),
      ]);
      return {
        bound: !!b,
        bindingHash: b ? bindingHash(b) : null,
        owner: user,
        setting,
        jobs: jobs.map(view),
        links: links.slice(0, 100),
        linksHasMore: links.length > 100,
        calendarAllowed: permits(a.permissions, 'action:read') && permits(a.permissions, 'action:update'),
        todoAllowed: ['approval:approve', 'approval:reject'].every((p) => permits(a.permissions, p)),
        automaticIntervalSeconds: 60,
      };
    });
  }
  async history(a: Actor, before?: string) {
    if (before !== undefined && !/^[a-f0-9-]{36}$/.test(before)) throw new BadRequestException('历史游标无效');
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const kinds = ['calendar', 'approval'].filter((k) =>
          k === 'calendar' ? permits(a.permissions, 'action:read') : approvalVisible(a.permissions),
        );
        const scope = { tenantId: a.tenantId, ownerId: a.userId, kind: { in: kinds } };
        const cursor = before ? await tx.activitySyncJob.findFirst({ where: { ...scope, id: before } }) : null;
        if (before && !cursor) throw new NotFoundException('历史游标不存在或不可见');
        const rows = await tx.activitySyncJob.findMany({
          where: {
            ...scope,
            ...(cursor
              ? {
                  OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
                }
              : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 51,
        });
        return { items: rows.slice(0, 50).map(view), nextCursor: rows.length > 50 ? rows[49].id : null };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  configure(a: Actor, body: Record<string, unknown>) {
    exactFields(body, ['requestKey', 'expectedUpdatedAt', 'calendarEnabled', 'todoEnabled', 'autoEnabled']);
    if (!['calendarEnabled', 'todoEnabled', 'autoEnabled'].every((k) => typeof body[k] === 'boolean'))
      throw new BadRequestException('同步开关须为布尔值');
    return runCommand(this.prisma, a, 'integration.activity.configure@1.0', body, async (tx) => {
      await tx.tenant.update({ where: { id: a.tenantId }, data: { updatedAt: new Date() } });
      const user = await this.owner(tx, a.tenantId, a.userId),
        b = await activityBinding(tx, a.tenantId, a.userId);
      if (!b) throw new BadRequestException('本人尚未完成钉钉授权及组织对应');
      if (
        body.calendarEnabled &&
        !['action:read', 'action:update'].every((p) => permits(user.authority.permissions, p))
      )
        throw new ForbiddenException('同步日程需要行动查看与编辑权限');
      if (
        body.todoEnabled &&
        !['approval:approve', 'approval:reject'].every((p) => permits(user.authority.permissions, p))
      )
        throw new ForbiddenException('同步审批待办需要审批处理权限');
      if (body.autoEnabled && !body.calendarEnabled && !body.todoEnabled)
        throw new BadRequestException('自动同步至少选择一类对象');
      const where = { tenantId_ownerId: { tenantId: a.tenantId, ownerId: a.userId } };
      const prior = await tx.activitySyncSetting.findUnique({ where });
      if (prior) checkVersion(prior, body.expectedUpdatedAt);
      if (
        body.autoEnabled &&
        !prior?.autoEnabled &&
        (await tx.activitySyncSetting.count({ where: { autoEnabled: true } })) >= 100
      )
        throw new BadRequestException('当前安装最多支持100位自动同步人员');
      const data = {
        bindingHash: bindingHash(b),
        calendarEnabled: body.calendarEnabled as boolean,
        todoEnabled: body.todoEnabled as boolean,
        autoEnabled: body.autoEnabled as boolean,
      };
      return tx.activitySyncSetting.upsert({
        where,
        create: { id: randomUUID(), tenantId: a.tenantId, ownerId: a.userId, ...data },
        update: { ...data, updatedAt: new Date(Math.max(Date.now(), (prior?.updatedAt.getTime() ?? 0) + 1)) },
      });
    });
  }
  private async desired(
    tx: Tx,
    tenantId: number,
    ownerId: number,
    setting: ActivitySyncSetting,
    b: DwsBinding,
    k: Kind,
    sourceId: number,
    includeDisabled = false,
  ): Promise<Desired | null> {
    const user = await this.owner(tx, tenantId, ownerId),
      permissions = user.authority.permissions;
    const link = await tx.activitySyncLink.findUnique({
      where: { tenantId_ownerId_kind_sourceId: { tenantId, ownerId, kind: k, sourceId } },
    });
    if (link && link.bindingHash !== bindingHash(b))
      throw new ConflictException('来源已对应另一授权，请先处理旧同步记录');
    const marker = `[CRM:${setting.id}:${k}:${sourceId}]`;
    let payload: Payload, revision: unknown;
    if (k === 'calendar') {
      if (
        (!setting.calendarEnabled && !includeDisabled) ||
        !['action:read', 'action:update'].every((p) => permits(permissions, p))
      )
        throw new ForbiddenException('日程同步未开启或权限已收回');
      const entry = await tx.calendarEntry.findFirst({ where: { id: sourceId, tenantId, ownerId } });
      if (!entry) throw new NotFoundException('日程不存在或不属于本人');
      if (entry.status === 'cancelled' && !link) return null;
      payload = {
        marker,
        calendar: {
          title: (entry.status === 'cancelled' ? '【已取消】' : '') + entry.title + ' ' + marker,
          description: [entry.description, entry.location ? `地点：${entry.location}` : '', marker]
            .filter(Boolean)
            .join('\n'),
          start: entry.startsAt.toISOString(),
          end: entry.endsAt.toISOString(),
          freeBusy: entry.status === 'cancelled' ? 'free' : (entry.freeBusy as 'free' | 'busy'),
        },
      };
      revision = entry.revision;
    } else {
      if (!setting.todoEnabled && !includeDisabled) throw new ForbiddenException('审批待办同步未开启');
      const node = await tx.approvalNode.findFirst({
        where: { id: sourceId, tenantId, approverId: ownerId },
        include: { approval: { include: { nodes: true } } },
      });
      if (!node) throw new NotFoundException('审批节点不存在或不属于本人');
      const approval = node.approval,
        anchor = approval.nodes.find((n) => n.id === approval.currentNodeId);
      const active =
        approval.status === 'pending' &&
        node.action === 'pending' &&
        anchor?.nodeOrder === node.nodeOrder &&
        approval.applicantId !== ownerId &&
        ['approval:approve', 'approval:reject'].every((p) => permits(permissions, p));
      if (!active && !link) return null;
      // No customer names, forms or attachments in external reminders.
      payload = {
        marker,
        todo: {
          title:
            (approval.title.startsWith('【测试】') ? '【测试】' : '') +
            `【CRM待审批】${approval.approvalNo} / ${node.nodeName} ${marker}`,
          done: !active,
        },
      };
      revision = [
        node.action,
        node.actedAt?.toISOString(),
        active,
        user.roles.map((r) => [r.role.id, r.role.updatedAt.toISOString()]),
      ];
    }
    return {
      kind: k,
      sourceId,
      sourceVersion: hash([revision, payload]),
      payload,
      externalId: link?.externalId ?? null,
      operation:
        k === 'calendar' ? (link ? 'calendar_update' : 'calendar_create') : link ? 'todo_state' : 'todo_create',
    };
  }
  private async sources(tx: Tx, tenantId: number, ownerId: number, setting: ActivitySyncSetting) {
    const links = await tx.activitySyncLink.findMany({ where: { tenantId, ownerId, archivedAt: null }, take: 501 });
    if (links.length > 500) throw new BadRequestException('同步对象超过500条；请先归档并由管理员处理容量');
    const entries = setting.calendarEnabled
      ? await tx.calendarEntry.findMany({
          where: {
            tenantId,
            ownerId,
            status: 'scheduled',
            startsAt: { gte: new Date(Date.now() - 7 * 86400000), lte: new Date(Date.now() + 93 * 86400000) },
          },
          select: { id: true },
          take: 201,
        })
      : [];
    const nodes = setting.todoEnabled
      ? await tx.approvalNode.findMany({
          where: { tenantId, approverId: ownerId, action: 'pending', approval: { status: 'pending' } },
          select: { id: true },
          take: 201,
        })
      : [];
    if (entries.length > 200 || nodes.length > 200)
      throw new BadRequestException('待同步源记录超过200条，请缩小待处理范围');
    const keys = new Map<string, { kind: Kind; sourceId: number }>();
    for (const [k, rows] of [
      ['calendar', entries],
      ['approval', nodes],
    ] as const)
      for (const row of rows) keys.set(`${k}:${row.id}`, { kind: k, sourceId: row.id });
    for (const link of links)
      if ((link.kind === 'calendar' && setting.calendarEnabled) || (link.kind === 'approval' && setting.todoEnabled))
        keys.set(`${link.kind}:${link.sourceId}`, { kind: kind(link.kind), sourceId: link.sourceId });
    return [...keys.values()];
  }
  async preview(a: Actor) {
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const { setting, binding } = await this.context(tx, a.tenantId, a.userId);
        const rows = await this.sources(tx, a.tenantId, a.userId, setting),
          items: Desired[] = [];
        for (const row of rows) {
          const value = await this.desired(tx, a.tenantId, a.userId, setting, binding, row.kind, row.sourceId);
          if (!value) continue;
          const link = await tx.activitySyncLink.findUnique({
            where: {
              tenantId_ownerId_kind_sourceId: {
                tenantId: a.tenantId,
                ownerId: a.userId,
                kind: row.kind,
                sourceId: row.sourceId,
              },
            },
          });
          if (!link || hash(link.payload) !== hash(value.payload)) items.push(value);
        }
        return { items, calendarWindow: { pastDays: 7, nextDays: 93 }, complete: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }
  private rows(value: unknown) {
    if (!Array.isArray(value) || !value.length || value.length > 50) throw new BadRequestException('每批须选择1—50条');
    const rows = value.map((v) => {
      const r = object(v);
      exactFields(r, ['kind', 'sourceId', 'sourceVersion']);
      return { kind: kind(r.kind), sourceId: id(r.sourceId), sourceVersion: text(r.sourceVersion, '源版本', 64) };
    });
    if (new Set(rows.map((r) => `${r.kind}:${r.sourceId}`)).size !== rows.length)
      throw new BadRequestException('源记录不能重复');
    return rows;
  }
  private async prepareRows(
    tx: Tx,
    tenantId: number,
    ownerId: number,
    rows: { kind: Kind; sourceId: number; sourceVersion: string }[],
  ) {
    await tx.tenant.update({ where: { id: tenantId }, data: { updatedAt: new Date() } });
    const { setting, binding } = await this.context(tx, tenantId, ownerId),
      jobs = [];
    for (const row of rows) {
      const source = await this.desired(tx, tenantId, ownerId, setting, binding, row.kind, row.sourceId);
      if (!source || source.sourceVersion !== row.sourceVersion)
        throw new ConflictException('源记录已变化，请重新预览');
      const inflight = await tx.activitySyncJob.findFirst({
        where: {
          tenantId,
          ownerId,
          kind: row.kind,
          sourceId: row.sourceId,
          status: { in: ['prepared', 'dispatching', 'uncertain', 'stopped'] },
        },
      });
      if (inflight) {
        if (
          inflight.sourceVersion === source.sourceVersion &&
          inflight.settingsVersion.getTime() === setting.updatedAt.getTime()
        ) {
          jobs.push(view(inflight));
          continue;
        }
        if (inflight.status !== 'prepared') throw new ConflictException('旧发送结果待核验，须先对账');
        await tx.activitySyncJob.update({
          where: { id: inflight.id },
          data: { status: 'cancelled', error: '源记录或配置已变更，尚未发送' },
        });
      }
      const unique = {
        tenantId_ownerId_kind_sourceId_sourceVersion: {
          tenantId,
          ownerId,
          kind: row.kind,
          sourceId: row.sourceId,
          sourceVersion: row.sourceVersion,
        },
      };
      const prior = await tx.activitySyncJob.findUnique({ where: unique });
      if (prior && !['cancelled', 'rejected'].includes(prior.status)) {
        jobs.push(view(prior));
        continue;
      }
      if (
        (await tx.activitySyncJob.count({
          where: { tenantId, ownerId, status: { in: ['prepared', 'dispatching', 'uncertain'] } },
        })) >= 100
      )
        throw new BadRequestException('本人待处理发送超过100条，请先发送或核对已有记录');
      if (prior) {
        jobs.push(
          view(
            await tx.activitySyncJob.update({
              where: { id: prior.id },
              data: {
                status: 'prepared',
                forceOverwrite: false,
                error: null,
                settingsVersion: setting.updatedAt,
                bindingHash: bindingHash(binding),
                payload: json(source.payload),
                externalId: source.externalId,
                operation: source.operation,
                leaseToken: null,
                evidence: Prisma.DbNull,
              },
            }),
          ),
        );
        continue;
      }
      jobs.push(
        view(
          await tx.activitySyncJob.create({
            data: {
              id: randomUUID(),
              tenantId,
              ownerId,
              kind: row.kind,
              sourceId: row.sourceId,
              sourceVersion: row.sourceVersion,
              bindingHash: bindingHash(binding),
              settingsVersion: setting.updatedAt,
              operation: source.operation,
              payload: json(source.payload),
              externalId: source.externalId,
            },
          }),
        ),
      );
    }
    return { jobs };
  }
  prepare(a: Actor, body: Record<string, unknown>) {
    exactFields(body, ['requestKey', 'rows']);
    const rows = this.rows(body.rows);
    for (const row of rows) readable(a, row.kind);
    return runCommand(this.prisma, a, 'integration.activity.prepare@1.0', body, (tx) =>
      this.prepareRows(tx, a.tenantId, a.userId, rows),
    );
  }
  private async ownJob(tx: Tx, a: Actor, jobId: string) {
    const job = await tx.activitySyncJob.findFirst({ where: { id: jobId, tenantId: a.tenantId, ownerId: a.userId } });
    if (!job) throw new NotFoundException('发送记录不存在或不属于本人');
    readable(a, job.kind);
    return job;
  }
  private async linkCapacity(tx: Tx, tenantId: number, ownerId: number, k: string, sourceId: number) {
    const link = await tx.activitySyncLink.findUnique({
      where: { tenantId_ownerId_kind_sourceId: { tenantId, ownerId, kind: k, sourceId } },
    });
    if (
      (!link || link.archivedAt) &&
      (await tx.activitySyncLink.count({ where: { tenantId, ownerId, archivedAt: null } })) >= 500
    )
      throw new ConflictException('本人已有500条未归档对应，请先归档已结束来源');
  }
  private async claim(
    tx: Tx,
    tenantId: number,
    ownerId: number,
    jobId: string,
    ticket: string,
    expected: unknown,
    forceOverwrite = false,
  ) {
    await tx.tenant.update({ where: { id: tenantId }, data: { updatedAt: new Date() } });
    const job = await tx.activitySyncJob.findFirst({ where: { id: jobId, tenantId, ownerId } });
    if (!job) throw new NotFoundException('发送记录不存在或不属于本人');
    checkVersion(job, expected);
    const conflict =
      job.evidence && typeof job.evidence === 'object' && !Array.isArray(job.evidence)
        ? (job.evidence as Record<string, unknown>)
        : {};
    if (forceOverwrite && (job.kind !== 'calendar' || !job.externalId))
      throw new BadRequestException('覆盖仅用于已对应的本人日程');
    if (job.status !== 'prepared' && !(job.status === 'rejected' && forceOverwrite && conflict.canOverwrite === true))
      throw new ConflictException('仅待发送记录可派发，不确定记录须先对账');
    if (await tx.activitySyncJob.count({ where: { tenantId, ownerId, status: 'dispatching' } }))
      throw new ConflictException('本人已有发送任务处理中');
    const { setting, binding } = await this.context(tx, tenantId, ownerId);
    if (job.bindingHash !== bindingHash(binding) || job.settingsVersion.getTime() !== setting.updatedAt.getTime())
      throw new ConflictException('授权或同步配置已变化，请取消后重新预览');
    const source = await this.desired(tx, tenantId, ownerId, setting, binding, kind(job.kind), job.sourceId);
    if (!source || source.sourceVersion !== job.sourceVersion)
      throw new ConflictException('源记录已变化，请取消后重新预览');
    await this.linkCapacity(tx, tenantId, ownerId, job.kind, job.sourceId);
    await tx.activitySyncJob.update({
      where: { id: job.id },
      data: { status: 'dispatching', leaseToken: ticket, error: null, forceOverwrite },
    });
    return { jobId: job.id, ticket };
  }
  private launch(jobId: string, ticket: string) {
    const promise = this.execute(jobId, ticket).catch(() => undefined);
    this.executions.add(promise);
    void promise.finally(() => this.executions.delete(promise));
  }
  async dispatch(a: Actor, jobId: string, body: Record<string, unknown>) {
    exactFields(body, ['requestKey', 'expectedUpdatedAt', 'forceOverwrite']);
    if (body.forceOverwrite !== undefined && typeof body.forceOverwrite !== 'boolean')
      throw new BadRequestException('覆盖标志须为布尔值');
    const ticket = randomUUID();
    const result = object(
      await runCommand(
        this.prisma,
        a,
        'integration.activity.dispatch@1.0',
        { ...body, jobId },
        (tx) =>
          this.claim(tx, a.tenantId, a.userId, jobId, ticket, body.expectedUpdatedAt, body.forceOverwrite === true),
        async (tx) => {
          await this.ownJob(tx, a, jobId);
        },
      ),
    );
    // A replayed receipt contains the OLD ticket. It must never execute the external write again.
    if (result.ticket === ticket) this.launch(jobId, ticket);
    return { jobId, status: result.ticket === ticket ? 'dispatching' : 'replayed' };
  }
  async cancel(a: Actor, jobId: string, body: Record<string, unknown>) {
    exactFields(body, ['requestKey', 'expectedUpdatedAt']);
    return runCommand(
      this.prisma,
      a,
      'integration.activity.cancel@1.0',
      { ...body, jobId },
      async (tx) => {
        const job = await this.ownJob(tx, a, jobId);
        checkVersion(job, body.expectedUpdatedAt);
        if (job.status !== 'prepared' && job.status !== 'rejected')
          throw new ConflictException('仅尚未执行的记录可取消；不确定发送须先对账');
        return view(
          await tx.activitySyncJob.update({
            where: { id: job.id },
            data: { status: 'cancelled', error: '本人取消尚未执行的发送' },
          }),
        );
      },
      async (tx) => {
        await this.ownJob(tx, a, jobId);
      },
    );
  }
  private async execute(jobId: string, ticket: string) {
    const job = await this.prisma.system.activitySyncJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'dispatching' || job.leaseToken !== ticket || this.stopped) return;
    let externalId = job.externalId,
      evidence: unknown,
      status = 'rejected',
      error: string | null = null;
    try {
      // Recheck current identity/consent immediately before dispatch, without impersonating a human session.
      const context = await this.prisma.system.$transaction(async (tx) => {
        const { setting, binding } = await this.context(tx, job.tenantId, job.ownerId);
        const current = await this.desired(
          tx,
          job.tenantId,
          job.ownerId,
          setting,
          binding,
          kind(job.kind),
          job.sourceId,
        );
        if (
          job.bindingHash !== bindingHash(binding) ||
          setting.updatedAt.getTime() !== job.settingsVersion.getTime() ||
          current?.sourceVersion !== job.sourceVersion
        )
          throw new ConflictException('源记录、授权或配置已变化，未发送');
        const link = job.externalId
          ? await tx.activitySyncLink.findUnique({
              where: {
                tenantId_ownerId_kind_sourceId: {
                  tenantId: job.tenantId,
                  ownerId: job.ownerId,
                  kind: job.kind,
                  sourceId: job.sourceId,
                },
              },
            })
          : null;
        return { binding, prior: link ? (object(link.payload) as unknown as Payload) : null };
      });
      const b = context.binding;
      const client = new DwsActivities(b, dwsReader(b)),
        payload = payloadOf(job);
      if (payload.calendar)
        evidence = await client.writeCalendar(
          payload.calendar,
          externalId,
          context.prior?.calendar,
          job.forceOverwrite,
        );
      else if (payload.todo)
        evidence = externalId
          ? await client.setTodoDone(externalId, payload.todo.done)
          : await client.createTodo(payload.todo.title);
      else throw new Error('发送快照无效');
      externalId = (evidence as CalendarProjection | TodoProjection).id;
      status = 'sent';
    } catch (e) {
      if (e instanceof UncertainActivityWrite) {
        externalId = e.externalId;
        status = 'uncertain';
      }
      if (e instanceof CalendarConflict) evidence = { conflict: true, canOverwrite: e.canOverwrite, remote: e.remote };
      error =
        e instanceof CalendarConflict
          ? e.canOverwrite
            ? '钉钉日程已有修改，未覆盖；核对后可明确选择以CRM为准覆盖'
            : '钉钉日程已取消或包含其他参会人，未覆盖；请保留停止状态并人工核对'
          : status === 'rejected'
            ? '源记录、人员权限或配置已变化，未执行外部写入'
            : '外部结果尚未验证，请先对账；禁止重新创建';
    }
    try {
      await this.recordResult(job, ticket, status, externalId, evidence, error);
    } catch {
      // Preserve uncertainty if the business receipt/audit transaction fails after a provider write.
      // This is operational recovery only: no successful link or receipt is fabricated.
      await this.prisma.system.activitySyncJob.updateMany({
        where: { id: job.id, status: 'dispatching', leaseToken: ticket },
        data: {
          status: status === 'rejected' ? 'rejected' : 'uncertain',
          externalId,
          error: '回执事务未完成；禁止重新发送，请先回读对账',
        },
      });
    }
  }
  private async recordResult(
    job: ActivitySyncJob,
    ticket: string,
    status: string,
    externalId: string | null,
    evidence: unknown,
    error: string | null,
  ) {
    const principal = createSystemPrincipal(job.tenantId, 'dingtalk', job.id);
    await runSystemCommand(
      this.prisma,
      principal,
      'integration.activity.result',
      { requestKey: `ar:${hash([job.id, ticket])}` },
      async (tx) => {
        await tx.tenant.update({ where: { id: job.tenantId }, data: { updatedAt: new Date() } });
        const current = await tx.activitySyncJob.findUnique({ where: { id: job.id } });
        if (!current || current.status !== 'dispatching' || current.leaseToken !== ticket)
          return { jobId: job.id, ignored: true };
        await tx.activitySyncJob.update({
          where: { id: job.id },
          data: { status, externalId, error, evidence: evidence ? json(evidence) : Prisma.DbNull },
        });
        if (status === 'sent' && externalId) await this.saveLink(tx, job, externalId, evidence);
        return { jobId: job.id, status, externalId };
      },
    );
  }
  private async saveLink(tx: Tx, job: ActivitySyncJob, externalId: string, evidence: unknown) {
    await this.linkCapacity(tx, job.tenantId, job.ownerId, job.kind, job.sourceId);
    if (!evidence || !matches(payloadOf(job), evidence as CalendarProjection | TodoProjection))
      throw new ConflictException('外部读回与发送快照不符');
    const where = {
      tenantId_ownerId_kind_sourceId: {
        tenantId: job.tenantId,
        ownerId: job.ownerId,
        kind: job.kind,
        sourceId: job.sourceId,
      },
    };
    const data = {
      bindingHash: job.bindingHash,
      archivedAt: null,
      externalId,
      sourceVersion: job.sourceVersion,
      payload: job.payload as Prisma.InputJsonValue,
    };
    await tx.activitySyncLink.upsert({
      where,
      create: { tenantId: job.tenantId, ownerId: job.ownerId, kind: job.kind, sourceId: job.sourceId, ...data },
      update: data,
    });
  }
  archive(a: Actor, linkId: number, body: Record<string, unknown>) {
    exactFields(body, ['requestKey', 'expectedUpdatedAt']);
    return runCommand(
      this.prisma,
      a,
      'integration.activity.archive@1.0',
      { ...body, linkId },
      async (tx) => {
        await tx.tenant.update({ where: { id: a.tenantId }, data: { updatedAt: new Date() } });
        const link = await tx.activitySyncLink.findFirst({
          where: { id: linkId, tenantId: a.tenantId, ownerId: a.userId },
        });
        if (!link) throw new NotFoundException('对应记录不存在或不属于本人');
        readable(a, link.kind);
        checkVersion(link, body.expectedUpdatedAt);
        if (link.archivedAt) throw new ConflictException('对应已归档');
        if (
          await tx.activitySyncJob.count({
            where: {
              tenantId: a.tenantId,
              ownerId: a.userId,
              kind: link.kind,
              sourceId: link.sourceId,
              status: { in: ['prepared', 'dispatching', 'uncertain'] },
            },
          })
        )
          throw new ConflictException('仍有未完成发送，不能归档');
        let ended = false;
        if (link.kind === 'calendar') {
          const entry = await tx.calendarEntry.findFirst({
            where: { id: link.sourceId, tenantId: a.tenantId, ownerId: a.userId },
          });
          ended = !!entry && (entry.status === 'cancelled' || entry.endsAt.getTime() < Date.now() - 7 * 86400000);
        } else {
          const node = await tx.approvalNode.findFirst({
            where: { id: link.sourceId, tenantId: a.tenantId, approverId: a.userId },
            include: { approval: true },
          });
          ended =
            !!node &&
            (node.action !== 'pending' || node.approval.status !== 'pending') &&
            object(object(link.payload).todo).done === true;
        }
        if (!ended) throw new ConflictException('仅已取消、结束超过7天的日程或已处理的审批提醒可归档');
        const { setting, binding } = await this.context(tx, a.tenantId, a.userId);
        const current = await this.desired(
          tx,
          a.tenantId,
          a.userId,
          setting,
          binding,
          kind(link.kind),
          link.sourceId,
          true,
        );
        const stopped = await tx.activitySyncJob.count({
          where: {
            tenantId: a.tenantId,
            ownerId: a.userId,
            kind: link.kind,
            sourceId: link.sourceId,
            status: 'stopped',
          },
        });
        if ((!current || hash(current.payload) !== hash(link.payload)) && !stopped)
          throw new ConflictException('来源尚有未同步变化，请先核对');
        return tx.activitySyncLink.update({ where: { id: link.id }, data: { archivedAt: new Date() } });
      },
      async (tx) => {
        const link = await tx.activitySyncLink.findFirst({
          where: { id: linkId, tenantId: a.tenantId, ownerId: a.userId },
        });
        if (!link) throw new NotFoundException('对应记录不存在或不属于本人');
        readable(a, link.kind);
      },
    );
  }
  control(a: Actor, jobId: string, body: Record<string, unknown>, resume: boolean) {
    exactFields(body, ['requestKey', 'expectedUpdatedAt']);
    return runCommand(
      this.prisma,
      a,
      resume ? 'integration.activity.resume@1.0' : 'integration.activity.stop@1.0',
      { ...body, jobId },
      async (tx) => {
        await tx.tenant.update({ where: { id: a.tenantId }, data: { updatedAt: new Date() } });
        const job = await this.ownJob(tx, a, jobId);
        checkVersion(job, body.expectedUpdatedAt);
        if (resume) {
          if (job.status !== 'stopped') throw new ConflictException('仅已停止记录可恢复核对');
          if (
            (await tx.activitySyncJob.count({
              where: {
                tenantId: a.tenantId,
                ownerId: a.userId,
                status: { in: ['prepared', 'dispatching', 'uncertain'] },
              },
            })) >= 100
          )
            throw new ConflictException('请先处理已有队列，再恢复核对');
        } else if (!['uncertain', 'rejected'].includes(job.status))
          throw new ConflictException('仅不确定或已拒绝记录可停止本来源同步');
        return view(
          await tx.activitySyncJob.update({
            where: { id: job.id },
            data: {
              status: resume ? 'uncertain' : 'stopped',
              error: resume ? '恢复只读核对；不会自动重发' : '本人停止此来源同步；外部结果未核定，禁止重新创建',
            },
          }),
        );
      },
      async (tx) => {
        await this.ownJob(tx, a, jobId);
      },
    );
  }
  async reconcile(a: Actor, jobId: string, body: Record<string, unknown>) {
    exactFields(body, ['requestKey', 'expectedUpdatedAt', 'externalId']);
    const job = await this.prisma.system.$transaction(async (tx) => {
      await validateActor(tx, a);
      const j = await this.ownJob(tx, a, jobId);
      return j;
    });
    if (job.status !== 'uncertain')
      return runCommand(
        this.prisma,
        a,
        'integration.activity.reconcile@1.0',
        { ...body, jobId },
        async () => {
          throw new ConflictException('仅结果不确定的记录需要对账');
        },
        async (tx) => {
          await this.ownJob(tx, a, jobId);
        },
      );
    checkVersion(job, body.expectedUpdatedAt);
    const externalId = job.externalId ?? text(body.externalId, '远端编号', 200);
    if (job.externalId && body.externalId && body.externalId !== job.externalId)
      throw new BadRequestException('已知远端编号不能替换');
    const b = await this.prisma.system.$transaction(async (tx) => {
      const c = await this.context(tx, a.tenantId, a.userId);
      if (bindingHash(c.binding) !== job.bindingHash) throw new ConflictException('授权已变化，不能核对其他身份记录');
      return c.binding;
    });
    const client = new DwsActivities(b, dwsReader(b));
    if (job.kind === 'calendar') await client.verifyIdentity();
    let actual: CalendarProjection | TodoProjection;
    try {
      actual = job.kind === 'calendar' ? await client.calendar(externalId) : await client.todo(externalId);
    } catch {
      throw new ConflictException('远端记录未能完整回读，保留原不确定状态；请核对编号和授权');
    }
    if (!matches(payloadOf(job), actual))
      throw new ConflictException('远端状态与快照不符，保留不确定记录；请核对后处理，不能重建');
    return runCommand(
      this.prisma,
      a,
      'integration.activity.reconcile@1.0',
      { ...body, jobId },
      async (tx) => {
        await tx.tenant.update({ where: { id: a.tenantId }, data: { updatedAt: new Date() } });
        const current = await this.ownJob(tx, a, jobId);
        checkVersion(current, body.expectedUpdatedAt);
        if (current.status !== 'uncertain') throw new ConflictException('对账状态已变化');
        await this.saveLink(tx, current, externalId, actual);
        return view(
          await tx.activitySyncJob.update({
            where: { id: jobId },
            data: { status: 'sent', externalId, evidence: json(actual), error: null },
          }),
        );
      },
      async (tx) => {
        await this.ownJob(tx, a, jobId);
      },
    );
  }
  private async cycle() {
    if (this.scanning || this.stopped) return;
    this.scanning = true;
    try {
      await this.prisma.system.activitySyncJob.updateMany({
        where: { status: 'dispatching', updatedAt: { lt: new Date(Date.now() - 10 * 60000) } },
        data: { status: 'uncertain', error: '发送超过10分钟未完成，须先对账；禁止重新创建' },
      });
      const settings = await this.prisma.system.activitySyncSetting.findMany({
        where: { autoEnabled: true },
        take: 101,
      });
      if (settings.length > 100) return;
      for (const setting of settings) {
        try {
          const principal = createSystemPrincipal(setting.tenantId, 'dingtalk', randomUUID());
          const rows = await this.prisma.system.$transaction(
            async (tx) => {
              const context = await this.context(tx, setting.tenantId, setting.ownerId);
              if (!context.setting.autoEnabled) return [];
              const sources = await this.sources(tx, setting.tenantId, setting.ownerId, context.setting),
                rows = [];
              for (const source of sources) {
                const d = await this.desired(
                  tx,
                  setting.tenantId,
                  setting.ownerId,
                  context.setting,
                  context.binding,
                  source.kind,
                  source.sourceId,
                );
                if (!d) continue;
                const link = await tx.activitySyncLink.findUnique({
                  where: {
                    tenantId_ownerId_kind_sourceId: { tenantId: setting.tenantId, ownerId: setting.ownerId, ...source },
                  },
                });
                const blocking = await tx.activitySyncJob.findFirst({
                  where: {
                    tenantId: setting.tenantId,
                    ownerId: setting.ownerId,
                    kind: source.kind,
                    sourceId: source.sourceId,
                    status: { in: ['dispatching', 'uncertain', 'stopped'] },
                  },
                });
                if (!blocking && (!link || hash(link.payload) !== hash(d.payload)))
                  rows.push({ kind: d.kind, sourceId: d.sourceId, sourceVersion: d.sourceVersion });
                if (rows.length === 50) break;
              }
              return rows;
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
          );
          if (rows.length)
            await runSystemCommand(
              this.prisma,
              principal,
              'integration.activity.prepare',
              { requestKey: `ap:${hash([setting.updatedAt.toISOString(), rows])}` },
              (tx) => this.prepareRows(tx, setting.tenantId, setting.ownerId, rows),
            );
          const job = await this.prisma.system.activitySyncJob.findFirst({
            where: { tenantId: setting.tenantId, ownerId: setting.ownerId, status: 'prepared' },
            orderBy: { createdAt: 'asc' },
          });
          if (
            job &&
            !(await this.prisma.system.activitySyncJob.count({
              where: { tenantId: setting.tenantId, ownerId: setting.ownerId, status: 'dispatching' },
            }))
          ) {
            const ticket = randomUUID();
            const result = object(
              await runSystemCommand(
                this.prisma,
                principal,
                'integration.activity.dispatch',
                { requestKey: `activity-dispatch:${job.id}:${job.updatedAt.toISOString()}` },
                async (tx) => {
                  const live = await tx.activitySyncSetting.findUnique({ where: { id: setting.id } });
                  if (!live?.autoEnabled) return { disabled: true };
                  return this.claim(tx, job.tenantId, job.ownerId, job.id, ticket, job.updatedAt.toISOString());
                },
              ),
            );
            if (result.ticket === ticket) this.launch(job.id, ticket);
          }
          await this.prisma.system.activitySyncSetting.updateMany({
            where: { id: setting.id, updatedAt: setting.updatedAt },
            data: { lastScannedAt: new Date(), lastError: null, updatedAt: setting.updatedAt },
          });
        } catch {
          await this.prisma.system.activitySyncSetting.updateMany({
            where: { id: setting.id, updatedAt: setting.updatedAt },
            data: {
              lastScannedAt: new Date(),
              lastError: '自动扫描受限或源记录冲突，请检查本人授权、权限及待处理发送记录',
              updatedAt: setting.updatedAt,
            },
          });
        }
      }
    } finally {
      this.scanning = false;
    }
  }
}
