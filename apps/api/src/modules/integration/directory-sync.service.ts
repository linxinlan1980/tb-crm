import { Injectable, BadRequestException, ConflictException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { DepartmentService } from '../system/departments/department.service';
import { UserService } from '../system/users/user.service';
import { checkVersion, id, json, object, runCommand, text, validateActor } from '../workspace/command-runner';
import { bindingFromEnvironment, bindingHash, dwsReader, readDirectory, type DirectorySnapshot } from './dws-directory';

const provider = 'dws-dingtalk';
function admin(actor: Actor) {
  if (!actor.roles.includes('super_admin')) throw new ForbiddenException('仅管理员可配置和同步钉钉');
}
function envelope(body: Record<string, unknown>, keys: string[]) {
  object(body);
  if (Object.keys(body).some((key) => !['requestKey', ...keys].includes(key)))
    throw new BadRequestException('不允许的同步参数');
}
function binding() {
  const result = bindingFromEnvironment();
  if (!result) throw new BadRequestException('服务器尚未为此公司绑定钉钉授权账号');
  return result;
}
interface Choice {
  externalId: string;
  localId: number | null | 'skip';
  departmentExternalId?: string | null;
}
function choices(value: unknown, people: boolean): Choice[] {
  if (!Array.isArray(value) || value.length > (people ? 500 : 199)) throw new BadRequestException('对照表数量无效');
  const rows = value.map((item) => {
    const row = object(item);
    if (
      Object.keys(row).some(
        (key) =>
          !(people ? ['externalId', 'localId', 'departmentExternalId'] : ['externalId', 'localId']).includes(key),
      )
    )
      throw new BadRequestException('不允许的对照表字段');
    return {
      externalId: text(row.externalId, '钉钉编号', 100),
      localId: row.localId === null || row.localId === 'skip' ? row.localId : id(row.localId),
      ...(people
        ? {
            departmentExternalId:
              row.departmentExternalId === null ? null : text(row.departmentExternalId, '归属部门', 100),
          }
        : {}),
    } as Choice;
  });
  if (new Set(rows.map((row) => row.externalId)).size !== rows.length) throw new BadRequestException('钉钉编号重复');
  return rows;
}
@Injectable()
export class DirectorySyncService implements OnModuleInit {
  private reading = new Set<string>();
  constructor(
    private prisma: PrismaService,
    private departments: DepartmentService,
    private users: UserService,
  ) {}
  async onModuleInit() {
    // A process cannot resume in-flight remote reads after restart. Never auto-apply an old preview.
    await this.prisma.system.integrationRun.updateMany({
      where: { provider, kind: 'directory', status: 'reading' },
      data: { status: 'interrupted' },
    });
  }
  async state(actor: Actor) {
    admin(actor);
    return this.prisma.system.$transaction(async (tx) => {
      await validateActor(tx, actor);
      const [connection, mappings, runs, departments, users] = await Promise.all([
        tx.integrationConnection.findUnique({ where: { tenantId_provider: { tenantId: actor.tenantId, provider } } }),
        tx.integrationMapping.findMany({ where: { tenantId: actor.tenantId, provider }, orderBy: { id: 'asc' } }),
        tx.integrationRun.findMany({
          where: { tenantId: actor.tenantId, provider },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        tx.department.findMany({
          where: { tenantId: actor.tenantId, deletedAt: null },
          select: { id: true, name: true, parentId: true, status: true },
          take: 2001,
        }),
        tx.user.findMany({
          where: { tenantId: actor.tenantId, deletedAt: null },
          select: { id: true, name: true, username: true, deptId: true, status: true },
          take: 501,
        }),
      ]);
      if (departments.length > 2000 || users.length > 500) throw new ConflictException('当前组织超出本地同步对照预算');
      const b = bindingFromEnvironment();
      return { bound: !!b, bindingHash: b ? bindingHash(b) : null, connection, mappings, runs, departments, users };
    });
  }
  configure(actor: Actor, body: Record<string, unknown>) {
    admin(actor);
    envelope(body, ['enabled', 'expectedUpdatedAt']);
    if (typeof body.enabled !== 'boolean') throw new BadRequestException('同步开关必须为布尔值');
    return runCommand(this.prisma, actor, 'integration.dingtalk.configure@1.0', body, async (tx) => {
      await tx.tenant.update({ where: { id: actor.tenantId }, data: { updatedAt: new Date() } });
      const current = await tx.integrationConnection.findUnique({
        where: { tenantId_provider: { tenantId: actor.tenantId, provider } },
      });
      if (current) checkVersion(current, body.expectedUpdatedAt);
      if (body.enabled) binding();
      return current
        ? tx.integrationConnection.update({ where: { id: current.id }, data: { enabled: body.enabled as boolean } })
        : tx.integrationConnection.create({
            data: { tenantId: actor.tenantId, provider, enabled: body.enabled as boolean },
          });
    });
  }
  async preview(actor: Actor, body: Record<string, unknown>) {
    admin(actor);
    envelope(body, []);
    const b = binding();
    const result = await runCommand(
      this.prisma,
      actor,
      'integration.dingtalk.directory.preview@1.0',
      body,
      async (tx) => {
        await tx.tenant.update({ where: { id: actor.tenantId }, data: { updatedAt: new Date() } });
        const connection = await tx.integrationConnection.findUnique({
          where: { tenantId_provider: { tenantId: actor.tenantId, provider } },
        });
        if (!connection?.enabled) throw new ConflictException('请先启用此公司的钉钉同步');
        if (await tx.integrationRun.findFirst({ where: { tenantId: actor.tenantId, provider, status: 'reading' } }))
          throw new ConflictException('已有读取任务进行中，请等待结果');
        return tx.integrationRun.create({
          data: {
            id: randomUUID(),
            tenantId: actor.tenantId,
            provider,
            kind: 'directory',
            status: 'reading',
            actorId: actor.userId,
            bindingHash: bindingHash(b),
          },
        });
      },
    );
    const run = object(result);
    const runId = text(run.id, '任务编号', 36);
    const current = await this.prisma.system.integrationRun.findFirst({
      where: { id: runId, tenantId: actor.tenantId, status: 'reading' },
    });
    if (current && !this.reading.has(runId)) {
      this.reading.add(runId);
      void this.collect(runId, b)
        .catch(() => {
          console.error('DingTalk directory run could not persist its outcome');
        })
        .finally(() => {
          this.reading.delete(runId);
        });
    }
    return result;
  }
  private async collect(runId: string, b: NonNullable<ReturnType<typeof bindingFromEnvironment>>) {
    try {
      const snapshot = await readDirectory(b, dwsReader(b));
      await this.prisma.system.integrationRun.update({
        where: { id: runId },
        data: {
          status: snapshot.complete ? 'ready' : 'partial',
          snapshot: json(snapshot),
          summary: {
            departments: snapshot.departments.length,
            people: snapshot.people.length,
            complete: snapshot.complete,
            hasMore: snapshot.hasMore,
            stopReason: snapshot.stopReason,
            failures: snapshot.failures,
          },
        },
      });
    } catch {
      await this.prisma.system.integrationRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          summary: { message: '读取失败，请核对服务器授权、企业绑定和可见范围；未导入或改写业务数据' },
        },
      });
    }
  }
  async apply(actor: Actor, body: Record<string, unknown>) {
    admin(actor);
    envelope(body, ['runId', 'departments', 'people']);
    const runId = text(body.runId, '任务编号', 36),
      departmentChoices = choices(body.departments, false),
      peopleChoices = choices(body.people, true);
    const b = binding(),
      hash = bindingHash(b);
    // Random unknown password; no credential is returned or written in a receipt/audit.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
    return runCommand(this.prisma, actor, 'integration.dingtalk.directory.apply@1.0', body, async (tx) => {
      await tx.tenant.update({ where: { id: actor.tenantId }, data: { updatedAt: new Date() } });
      const connection = await tx.integrationConnection.findUnique({
        where: { tenantId_provider: { tenantId: actor.tenantId, provider } },
      });
      if (!connection?.enabled) throw new ConflictException('钉钉同步已停用');
      const run = await tx.integrationRun.findFirst({
        where: { id: runId, tenantId: actor.tenantId, provider, kind: 'directory' },
      });
      if (!run || run.status !== 'ready' || run.bindingHash !== hash || !run.snapshot)
        throw new ConflictException('预览未完成、已导入或授权绑定已变化，请重新预览');
      const snapshot = run.snapshot as unknown as DirectorySnapshot;
      if (!snapshot.complete || Date.now() - Date.parse(snapshot.capturedAt) > 30 * 60000)
        throw new ConflictException('预览不完整或超过30分钟，请重新预览');
      if (
        departmentChoices.length !== snapshot.departments.length - 1 ||
        peopleChoices.length !== snapshot.people.length
      )
        throw new BadRequestException('必须逐项核对全部部门和人员，可明确选择跳过');
      const old = await tx.integrationMapping.findMany({ where: { tenantId: actor.tenantId, provider } });
      if (old.some((row) => row.bindingHash !== hash))
        throw new ConflictException('存在其他授权企业的旧映射，请由安装管理员核对');
      const departmentIds = new Map<string, number | null>([['1', null]]);
      let createdDepartments = 0,
        createdPeople = 0,
        linkedDepartments = 0,
        linkedPeople = 0,
        skipped = 0;
      const role = await tx.role.findFirstOrThrow({ where: { tenantId: actor.tenantId, code: 'sales' } });
      const saveMapping = async (kind: string, externalId: string, externalName: string, localId: number) => {
        const prior = old.find((row) => row.kind === kind && row.externalId === externalId);
        if (prior && prior.localId !== localId) throw new ConflictException('已建立的对应关系不能在批量导入中改绑');
        if (old.some((row) => row.kind === kind && row.localId === localId && row.externalId !== externalId))
          throw new ConflictException('同一本地记录不能对应多个钉钉记录');
        if (!prior) {
          const row = await tx.integrationMapping.create({
            data: { tenantId: actor.tenantId, provider, bindingHash: hash, kind, externalId, externalName, localId },
          });
          old.push(row);
        }
      };
      for (const source of snapshot.departments.filter((d) => d.externalId !== '1').sort((a, b) => a.depth - b.depth)) {
        const choice = departmentChoices.find((c) => c.externalId === source.externalId);
        if (!choice) throw new BadRequestException('部门对照项不属于当前预览');
        if (choice.localId === 'skip') {
          skipped++;
          continue;
        }
        if (!source.parentExternalId || !departmentIds.has(source.parentExternalId))
          throw new ConflictException('上级部门已跳过，必须同时跳过其下级部门');
        const parentId = departmentIds.get(source.parentExternalId)!;
        let localId: number;
        if (choice.localId !== null) {
          const local = await tx.department.findFirst({
            where: { id: choice.localId, tenantId: actor.tenantId, deletedAt: null, status: 1 },
          });
          if (!local || local.parentId !== parentId)
            throw new ConflictException('部门对应项必须有效，且与已核对的上级部门一致');
          localId = local.id;
          linkedDepartments++;
        } else {
          if (
            await tx.department.findFirst({
              where: { tenantId: actor.tenantId, name: source.name, parentId, deletedAt: null },
            })
          )
            throw new ConflictException('同一上级下存在同名部门，请明确选择已有部门');
          const local = await this.departments.saveInTransaction(tx, actor, null, { name: source.name, parentId });
          localId = local.id;
          createdDepartments++;
        }
        await saveMapping('department', source.externalId, source.name, localId);
        departmentIds.set(source.externalId, localId);
      }
      for (const source of snapshot.people) {
        const choice = peopleChoices.find((c) => c.externalId === source.externalId);
        if (!choice) throw new BadRequestException('人员对照项不属于当前预览');
        if (choice.localId === 'skip') {
          skipped++;
          continue;
        }
        let localId: number;
        if (choice.localId !== null) {
          const local = await tx.user.findFirst({
            where: { id: choice.localId, tenantId: actor.tenantId, deletedAt: null },
          });
          if (!local) throw new ConflictException('对应的本地人员不存在');
          localId = local.id;
          linkedPeople++;
        } else {
          if (
            await tx.user.findFirst({
              where: {
                tenantId: actor.tenantId,
                deletedAt: null,
                OR: [{ name: source.name }, { dingtalkUserid: source.externalId }],
              },
            })
          )
            throw new ConflictException('存在同名或相同钉钉编号的人员，请核对已有人员');
          const externalDepartment = choice.departmentExternalId ?? null;
          if (
            externalDepartment !== null &&
            (!source.departmentIds.includes(externalDepartment) || !departmentIds.has(externalDepartment))
          )
            throw new ConflictException('新人员必须明确选择已导入的所属部门，不能猜测多部门人员的主部门');
          const username =
            'dd_' +
            createHash('sha256')
              .update(hash + source.externalId)
              .digest('hex')
              .slice(0, 24);
          const local = await this.users.createInTransaction(
            tx,
            actor,
            {
              username,
              name: source.name,
              deptId: externalDepartment === null ? null : departmentIds.get(externalDepartment)!,
              roleIds: [role.id],
              position: source.position,
            },
            passwordHash,
            'inactive',
          );
          localId = local.id;
          createdPeople++;
          await tx.user.update({ where: { id: localId }, data: { dingtalkUserid: source.externalId } });
        }
        await saveMapping('user', source.externalId, source.name, localId);
      }
      const summary = {
        runId,
        createdDepartments,
        createdPeople,
        linkedDepartments,
        linkedPeople,
        skipped,
        newPeopleStatus: 'inactive',
        existingPermissionsPreserved: true,
      };
      await tx.integrationRun.update({ where: { id: runId }, data: { status: 'applied', summary: json(summary) } });
      return summary;
    });
  }
}
