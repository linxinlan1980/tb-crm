import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Actor } from '../../common/types/actor';
import { PrismaService } from '../../database/prisma.service';
import { ApprovalService } from '../approval/approval.service';
import { anySignature } from '../approval/flow-rules';
import { hasPermission } from '../workspace/access';
import {
  checkVersion,
  id,
  json,
  object,
  runCommand,
  runSystemCommand,
  validateActor,
  type Tx,
} from '../workspace/command-runner';
import { createSystemPrincipal } from '../workspace/system-principal';
import { activityBinding } from './activity-binding';
import { bindingHash, dwsReader, record, type DwsBinding, type DwsRead } from './dws-directory';
import {
  DwsNativeApprovals,
  nativeHash,
  nativeUserIds,
  type NativeEvidence,
  type NativeExpectation,
  type NativeTemplate,
} from './dws-native-approval';
import {
  nativeApprovalKey,
  nativeFormValues,
  nativeSnapshot,
  parseNativePolicy,
  type NativeApprovalPolicy,
} from './native-approval-policy';
const provider = 'dws-oa';
const input = (body: Record<string, unknown>, allowed: string[]) => {
  object(body);
  if (
    (allowed.includes('requestKey') &&
      (typeof body.requestKey !== 'string' || !body.requestKey || body.requestKey.length > 80)) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    throw new BadRequestException('原生审批参数含未定义字段');
};
function admin(a: Actor) {
  if (!a.roles.includes('super_admin')) throw new ForbiddenException('仅管理员配置钉钉审批连接');
}
function allowed(a: Actor) {
  if (!hasPermission(a, 'contract:read')) throw new ForbiddenException('没有合同读取权限');
}
@Injectable()
export class NativeApprovalService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalService,
  ) {}
  onModuleInit() {
    if (process.env.CRM_ACCOUNT_WORKER === 'true') {
      this.timer = setInterval(() => {
        void this.tick().catch(() => undefined);
      }, 60000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private client(binding: DwsBinding) {
    const raw = dwsReader(binding, process.env.DWS_OA_BINARY || process.env.DWS_BINARY || 'dws');
    const trace: { response: unknown; error: unknown } = { response: null, error: null };
    const read: DwsRead = async (args) => {
      const creating = args[0] === 'oa' && args[1] === 'approval' && args[2] === 'create-instance';
      try {
        const result = await raw(args);
        if (creating) trace.response = result;
        return result;
      } catch (error) {
        if (creating && error && typeof error === 'object') {
          const e = error as Record<string, unknown>;
          trace.error = {
            code: typeof e.code === 'number' || typeof e.code === 'string' ? e.code : null,
            signal: typeof e.signal === 'string' ? e.signal : null,
          };
          if (typeof e.stdout === 'string') {
            try {
              trace.response = JSON.parse(e.stdout) as unknown;
            } catch {
              trace.response = {
                unparsed: true,
                text: e.stdout.slice(0, 100000),
                hash: nativeHash(e.stdout),
                truncated: e.stdout.length > 100000,
              };
            }
          }
        }
        throw new BadRequestException('钉钉原生审批接口未通过，请核查本机工具版本、授权及参数；系统不会自动重发');
      }
    };
    return { api: new DwsNativeApprovals(binding, read), read, trace };
  }
  private async policy(tx: Tx, tenantId: number) {
    const row = await tx.systemSetting.findUnique({
      where: { tenantId_settingKey: { tenantId, settingKey: nativeApprovalKey } },
    });
    return row
      ? { policy: parseNativePolicy(JSON.parse(row.settingValue) as unknown), version: row.updatedAt.toISOString() }
      : null;
  }
  async state(a: Actor) {
    allowed(a);
    return this.prisma.system.$transaction(async (tx) => {
      await validateActor(tx, a);
      const config = await this.policy(tx, a.tenantId),
        binding = await activityBinding(tx, a.tenantId, a.userId);
      const runs = await tx.integrationRun.findMany({
        where: { tenantId: a.tenantId, provider, actorId: a.userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      const pending = await tx.approval.findMany({
        where: { tenantId: a.tenantId, applicantId: a.userId, bizType: 'contract', status: 'pending' },
        select: { id: true, title: true, updatedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const flows = await tx.approvalFlow.findMany({
        where: { tenantId: a.tenantId, bizType: 'contract', isActive: true },
        select: { id: true, name: true },
      });
      return {
        policy: config?.policy ?? null,
        updatedAt: config?.version ?? null,
        bound: !!binding,
        pending,
        flows,
        runs: runs.map((r) => ({
          id: r.id,
          kind: r.kind,
          status: r.status,
          summary: r.summary,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
        transport: 'outbound-poll',
        manualDispatch: true,
        externalWritesConfirmedIndividually: true,
      };
    });
  }
  async configure(a: Actor, body: Record<string, unknown>) {
    admin(a);
    input(body, ['requestKey', 'expectedUpdatedAt', 'data']);
    const p = parseNativePolicy(body.data);
    return runCommand(this.prisma, a, 'integration.native.configure@1.0', { ...body, data: p }, async (tx) => {
      const flow = await tx.approvalFlow.findFirst({
        where: { id: p.flowId, tenantId: a.tenantId, bizType: 'contract', isActive: true },
        include: { nodes: true },
      });
      if (!flow || flow.nodes.length !== 1 || flow.nodes[0].approverType !== 'users_any')
        throw new BadRequestException('连接须选择已发布的单步多人或签合同流程');
      const where = { tenantId_settingKey: { tenantId: a.tenantId, settingKey: nativeApprovalKey } },
        old = await tx.systemSetting.findUnique({ where });
      if (old) checkVersion(old, body.expectedUpdatedAt);
      const data = {
        settingValue: JSON.stringify(p),
        settingGroup: 'dingtalk-native',
        valueType: 'json' as const,
        description: '原生钉钉人工审批；逐单确认外发，局域网主动拉回结果，不补发历史',
      };
      const row = old
        ? await tx.systemSetting.update({ where: { id: old.id }, data })
        : await tx.systemSetting.create({ data: { tenantId: a.tenantId, settingKey: nativeApprovalKey, ...data } });
      return { updatedAt: row.updatedAt };
    });
  }
  async probe(a: Actor, body: Record<string, unknown>) {
    admin(a);
    input(body, ['requestKey']);
    const context = await this.context(a);
    const { api, read } = this.client(context.binding);
    await api.verify();
    const template = await api.template(context.config.policy.processCode);
    await api.freshForm(template.processCode, template);
    const people = nativeUserIds(await read(['contact', 'user', 'get', '--ids', template.allowedUserIds.join(',')]));
    if (people.length !== template.allowedUserIds.length || people.some((p) => !template.allowedUserIds.includes(p.id)))
      throw new BadRequestException('模板人员详情不完整');
    const self = record(await read(['contact', 'user', 'get-self']));
    if (self.success !== true) throw new BadRequestException('本人部门读取失败');
    const entries = Array.isArray(self.result) ? self.result : Object.values(record(self.result));
    if (
      entries.length !== 1 ||
      !Array.isArray(record(record(entries[0]).orgEmployeeModel).depts) ||
      (record(record(entries[0]).orgEmployeeModel).depts as unknown[]).every(
        (v) => Number(record(v).deptId) !== context.config.policy.departmentId,
      )
    )
      throw new BadRequestException('发起部门不属于当前绑定人员');
    return runCommand(this.prisma, a, 'integration.native.probe@1.0', body, async (tx) => {
      await this.live(tx, a.tenantId, a.userId, context.config.version, bindingHash(context.binding));
      const summary = {
        templateName: template.name,
        mode: 'any',
        fields: 9,
        people,
        departmentId: context.config.policy.departmentId,
        groupRobot: false,
        network: 'CRM仅需出站HTTPS，无需公网回调',
      };
      await tx.integrationRun.create({
        data: {
          id: randomUUID(),
          tenantId: a.tenantId,
          provider,
          kind: 'probe',
          status: 'completed',
          actorId: a.userId,
          bindingHash: bindingHash(context.binding),
          summary: json(summary),
        },
      });
      return summary;
    });
  }
  private async context(a: Actor) {
    allowed(a);
    return this.prisma.system.$transaction(async (tx) => {
      await validateActor(tx, a);
      const config = await this.policy(tx, a.tenantId),
        binding = await activityBinding(tx, a.tenantId, a.userId);
      if (!config || !binding) throw new BadRequestException('请先配置本公司原生审批，并绑定申请人本人的钉钉授权');
      return { config, binding };
    });
  }
  private async live(tx: Tx, tenantId: number, ownerId: number, version: string, expectedBindingHash: string) {
    const config = await this.policy(tx, tenantId),
      binding = await activityBinding(tx, tenantId, ownerId);
    if (!config || config.version !== version || !binding || bindingHash(binding) !== expectedBindingHash)
      throw new ConflictException('钉钉连接或授权已变化，请重新预演');
    return { config, binding };
  }
  private async document(tx: Tx, tenantId: number, ownerId: number, approvalId: number, policy: NativeApprovalPolicy) {
    const a = await tx.approval.findFirst({
      where: { id: approvalId, tenantId, applicantId: ownerId, bizType: 'contract', status: 'pending' },
      include: { nodes: { orderBy: { id: 'asc' } } },
    });
    if (
      !a ||
      record(record(a.formData).flowSnapshot).id !== policy.flowId ||
      a.createdAt < new Date(policy.fromDate + 'T00:00:00+08:00') ||
      a.nodes.length < 1 ||
      a.nodes.some((n) => n.action !== 'pending' || n.nodeOrder !== 1) ||
      !anySignature(a.formData, 1)
    )
      throw new BadRequestException('只连接生效日期后的、本人发起的当前单步或签合同审批');
    const c = await tx.contract.findFirst({
      where: { id: a.bizId, tenantId, approvalId: a.id, status: 'pending_approval', deletedAt: null },
      include: { customer: true },
    });
    if (!c) throw new BadRequestException('待审批合同不存在');
    const attachment = c.attachments;
    if (attachment && typeof attachment === 'object' && !Array.isArray(attachment) && attachment.sourceArchiveId)
      throw new BadRequestException('历史补录合同不外发审批');
    const maps = await tx.integrationMapping.findMany({
      where: { tenantId, provider: 'dws-dingtalk', kind: 'user', localId: { in: a.nodes.map((n) => n.approverId) } },
    });
    if (maps.length !== a.nodes.length) throw new BadRequestException('审批人员钉钉对照不完整');
    const user = await tx.user.findFirstOrThrow({
      where: { id: ownerId, tenantId, status: 'active', deletedAt: null },
      select: { name: true },
    });
    return { approval: a, contract: c, maps, applicantName: user.name };
  }
  async prepare(a: Actor, body: Record<string, unknown>) {
    input(body, ['requestKey', 'approvalId', 'expectedUpdatedAt']);
    const approvalId = id(body.approvalId),
      ctx = await this.context(a);
    if (!ctx.config.policy.enabled) throw new BadRequestException('原生审批未启用');
    const document = await this.prisma.system.$transaction((tx) =>
      this.document(tx, a.tenantId, a.userId, approvalId, ctx.config.policy),
    );
    checkVersion(document.approval, body.expectedUpdatedAt);
    const { api, read } = this.client(ctx.binding);
    await api.verify();
    const template = await api.template(ctx.config.policy.processCode);
    await api.freshForm(template.processCode, template);
    const approverIds = document.approval.nodes.map(
      (n) => document.maps.find((m) => m.localId === n.approverId)!.externalId,
    );
    const people = nativeUserIds(await read(['contact', 'user', 'get', '--ids', approverIds.join(',')]));
    if (people.length !== approverIds.length || people.some((p) => !approverIds.includes(p.id)))
      throw new BadRequestException('审批人员实际身份不完整');
    const c = document.contract,
      ap = document.approval;
    const expected: NativeExpectation = {
      tenantId: a.tenantId,
      approvalId: ap.id,
      approvalVersion: ap.updatedAt.toISOString(),
      nodeIds: ap.nodes.map((n) => n.id),
      contractId: c.id,
      contractVersion: c.updatedAt.toISOString(),
      processCode: template.processCode,
      departmentId: ctx.config.policy.departmentId,
      originatorId: ctx.binding.userId,
      approverIds,
      templateHash: template.templateHash,
      bindingHash: bindingHash(ctx.binding),
      formValues: nativeFormValues({
        approvalId: ap.id,
        approvalVersion: ap.updatedAt.toISOString(),
        contractId: c.id,
        contractVersion: c.updatedAt.toISOString(),
        contractNo: c.contractNo,
        name: c.name,
        customerName: c.customer.name,
        signingCompany: c.signingCompany,
        amount: c.amount.toFixed(2),
        currency: c.currency,
        applicantName: document.applicantName,
        paymentTerms: c.paymentTerms,
        remark: c.remark,
        contractType: c.contractType,
        taxRate: String(c.taxRate),
        approverIds,
      }),
    };
    const forecast = await api.forecast(expected, template);
    this.forecast(forecast, expected);
    const digest = nativeHash(expected),
      runId = randomUUID(),
      expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
    return runCommand(this.prisma, a, 'integration.native.prepare@1.0', body, async (tx) => {
      await this.live(tx, a.tenantId, a.userId, ctx.config.version, expected.bindingHash);
      const fresh = await this.document(tx, a.tenantId, a.userId, approvalId, ctx.config.policy);
      checkVersion(fresh.approval, expected.approvalVersion);
      checkVersion(fresh.contract, expected.contractVersion);
      if (
        await tx.integrationMapping.findFirst({
          where: { tenantId: a.tenantId, provider, kind: 'approval', localId: approvalId },
        })
      )
        throw new ConflictException('此申请已有钉钉发送记录，不可重复创建');
      await tx.integrationRun.create({
        data: {
          id: runId,
          tenantId: a.tenantId,
          provider,
          kind: 'dispatch',
          status: 'prepared',
          actorId: a.userId,
          bindingHash: expected.bindingHash,
          snapshot: json({ expected, template, settingsVersion: ctx.config.version, expiresAt, forecast }),
          summary: json({
            approvalId,
            digest,
            expiresAt,
            formValues: expected.formValues,
            people,
            mode: 'any',
            departmentId: expected.departmentId,
          }),
        },
      });
      return {
        runId,
        digest,
        expiresAt,
        formValues: expected.formValues,
        people,
        mode: 'any',
        departmentId: expected.departmentId,
      };
    });
  }
  private forecast(value: unknown, expected: NativeExpectation) {
    const r = record(value),
      d = record(r.result);
    if (
      r.success !== true ||
      d.forecastSuccess !== true ||
      d.processCode !== expected.processCode ||
      d.userId !== expected.originatorId ||
      !Array.isArray(d.workflowActivityRuleVOs) ||
      d.workflowActivityRuleVOs.length !== 1
    )
      throw new BadRequestException('钉钉未完整预测单步或签流程');
    const node = record(d.workflowActivityRuleVOs[0]),
      actor = record(node.workflowActor);
    if (
      node.targetSelect === true ||
      actor.agreeAll !== false ||
      actor.actorActivateType !== 'ALL' ||
      actor.approvalType !== 'MANUAL'
    )
      throw new BadRequestException('钉钉预测不是固定人员人工或签');
    const entries = node.activityActioners;
    if (!Array.isArray(entries)) throw new BadRequestException('钉钉预测未返回实际审批人');
    const ids = entries.map((v) => String(record(v).emplId ?? record(v).userId ?? record(v).workNo ?? ''));
    if (JSON.stringify([...new Set(ids)].sort()) !== JSON.stringify([...expected.approverIds].sort()))
      throw new BadRequestException('钉钉预测人员和CRM审批人不一致，未发送');
  }
  private async run(a: Actor, runId: string) {
    return this.prisma.system.$transaction(async (tx) => {
      await validateActor(tx, a);
      const r = await tx.integrationRun.findFirst({
        where: { id: runId, tenantId: a.tenantId, actorId: a.userId, provider, kind: 'dispatch' },
      });
      if (!r) throw new BadRequestException('本人钉钉审批发送记录不存在');
      return r;
    });
  }
  async dispatch(a: Actor, runId: string, body: Record<string, unknown>) {
    input(body, ['requestKey', 'expectedUpdatedAt', 'digest', 'confirm']);
    if (body.confirm !== true || typeof body.requestKey !== 'string' || !body.requestKey || body.requestKey.length > 80)
      throw new BadRequestException('须确认本次完整预演后发送');
    const run = await this.run(a, runId),
      snapshot = nativeSnapshot(run.snapshot),
      expected = snapshot.expected;
    if (run.status === 'sent' || run.status === 'completed') return { runId, status: run.status, summary: run.summary };
    if (run.status !== 'prepared') throw new ConflictException('本次已尝试发送或待核查，禁止重发');
    checkVersion(run, body.expectedUpdatedAt);
    if (new Date(snapshot.expiresAt) < new Date() || body.digest !== nativeHash(expected))
      throw new ConflictException('预演已过期或指纹不一致，请重新预演');
    const ctx = await this.context(a);
    if (!ctx.config.policy.enabled) throw new BadRequestException('连接未启用');
    const { api, trace } = this.client(ctx.binding);
    await api.verify();
    const freshTemplate = await api.template(expected.processCode);
    if (freshTemplate.templateHash !== expected.templateHash) throw new ConflictException('钉钉模板已变化，请重新预演');
    await api.freshForm(expected.processCode, freshTemplate);
    this.forecast(await api.forecast(expected, freshTemplate), expected);
    await this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const live = await this.live(tx, a.tenantId, a.userId, snapshot.settingsVersion, expected.bindingHash);
        if (!live.config.policy.enabled) throw new ConflictException('连接已停用');
        const document = await this.document(tx, a.tenantId, a.userId, expected.approvalId, live.config.policy);
        checkVersion(document.approval, expected.approvalVersion);
        checkVersion(document.contract, expected.contractVersion);
        const changed = await tx.integrationRun.updateMany({
          where: {
            id: runId,
            tenantId: a.tenantId,
            status: 'prepared',
            updatedAt: new Date(String(body.expectedUpdatedAt)),
          },
          data: {
            status: 'sending',
            summary: json({
              ...record(run.summary),
              requestKey: body.requestKey,
              attemptedAt: new Date().toISOString(),
            }),
          },
        });
        if (changed.count !== 1) throw new ConflictException('已有发送进程，禁止重复创建');
        await tx.integrationMapping.create({
          data: {
            tenantId: a.tenantId,
            provider,
            kind: 'approval',
            localId: expected.approvalId,
            externalId: 'pending:' + runId,
            externalName: runId,
            bindingHash: expected.bindingHash,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId: a.tenantId,
            userId: a.userId,
            action: 'integration.native.dispatch.claim',
            objectType: 'approval',
            objectId: expected.approvalId,
            afterData: json({ runId, digest: body.digest, requestKey: body.requestKey, confirmed: true }),
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    let externalId: string | null = null;
    try {
      externalId = await api.create(expected, freshTemplate);
      await this.prisma.system.$transaction(async (tx) => {
        await tx.integrationMapping.update({
          where: {
            tenantId_provider_kind_localId: {
              tenantId: a.tenantId,
              provider,
              kind: 'approval',
              localId: expected.approvalId,
            },
          },
          data: { externalId: externalId! },
        });
        await tx.integrationRun.update({
          where: { id: runId },
          data: {
            status: 'sent',
            snapshot: json({ ...snapshot, providerWriteReceipt: trace }),
            summary: json({
              ...record(run.summary),
              externalId,
              linkedAt: new Date().toISOString(),
              readbackVerified: false,
            }),
          },
        });
      });
      const evidence = await api.evidence(externalId, expected);
      return this.humanResult(a, runId, evidence);
    } catch {
      await this.prisma.system.integrationRun.updateMany({
        where: { id: runId, tenantId: a.tenantId, status: { in: ['sending', 'sent'] } },
        data: {
          status: externalId ? 'blocked' : 'uncertain',
          snapshot: json({ ...snapshot, providerWriteReceipt: trace }),
          summary: json({
            ...record(run.summary),
            externalId,
            error: '发送结果或回读未核定；禁止重发，请核对钉钉原生审批及本地记录。',
          }),
        },
      });
      if (!externalId) {
        try {
          const fresh = await this.prisma.system.integrationRun.findUniqueOrThrow({ where: { id: runId } });
          return await this.recover(a, runId, {
            requestKey: 'auto-recover:' + runId,
            expectedUpdatedAt: fresh.updatedAt.toISOString(),
          });
        } catch {
          /* Read-only recovery failure never retries create. */
        }
      }
      throw new ConflictException('本次发送结果未完整核定，系统禁止重发；请在连接记录中核查');
    }
  }
  private async apply(tx: Tx, runId: string, evidence: NativeEvidence) {
    const expected = evidence.expected,
      r = await tx.integrationRun.findFirst({
        where: { id: runId, tenantId: expected.tenantId, provider, status: { in: ['sent', 'blocked'] } },
      });
    if (!r) throw new ConflictException('连接已结束或状态已变化');
    const snapshot = nativeSnapshot(r.snapshot),
      current = await this.policy(tx, r.tenantId),
      binding = await activityBinding(tx, r.tenantId, r.actorId);
    if (
      !current?.policy.enabled ||
      !binding ||
      bindingHash(binding) !== r.bindingHash ||
      current.policy.processCode !== expected.processCode ||
      current.policy.departmentId !== expected.departmentId
    )
      throw new ConflictException('连接、模板或部门配置已变化，请管理员核对');
    const local = await this.document(tx, r.tenantId, r.actorId, expected.approvalId, current.policy);
    checkVersion(local.approval, expected.approvalVersion);
    checkVersion(local.contract, expected.contractVersion);
    const mapping = await tx.integrationMapping.findFirst({
      where: {
        tenantId: r.tenantId,
        provider,
        kind: 'approval',
        localId: expected.approvalId,
        externalId: evidence.instanceId,
      },
    });
    if (!mapping || nativeHash(snapshot.expected) !== nativeHash(expected))
      throw new ConflictException('审批连接证据不一致');
    let result: unknown = null;
    if (['approved', 'rejected'].includes(evidence.status))
      result = await this.approvals.applyNativeDecision(tx, evidence);
    else if (evidence.status === 'cancelled') await tx.integrationMapping.delete({ where: { id: mapping.id } });
    const summary = {
      ...record(r.summary),
      externalId: evidence.instanceId,
      error: null,
      readbackVerified: true,
      remoteStatus: evidence.status,
      lastPolledAt: new Date().toISOString(),
      evidenceHash: evidence.digest,
      result,
    };
    await tx.integrationRun.update({
      where: { id: runId },
      data: {
        status: evidence.status === 'pending' ? 'sent' : evidence.status === 'cancelled' ? 'cancelled' : 'completed',
        summary: json(summary),
        snapshot: json({ ...record(r.snapshot), providerEvidence: evidence.observed }),
      },
    });
    return { runId, status: evidence.status, summary };
  }
  private humanResult(a: Actor, runId: string, evidence: NativeEvidence) {
    return runCommand(
      this.prisma,
      a,
      'integration.native.result@1.0',
      { requestKey: 'native:' + runId + ':' + evidence.digest.slice(0, 25), runId, proofHash: evidence.digest },
      (tx) => this.apply(tx, runId, evidence),
    );
  }
  async reconcile(a: Actor, runId: string, body: Record<string, unknown>) {
    input(body, ['requestKey']);
    const r = await this.run(a, runId);
    if (!['sent', 'blocked'].includes(r.status))
      throw new BadRequestException('此记录尚无可读取的确定钉钉审批编号，或已结束');
    const expected = nativeSnapshot(r.snapshot).expected,
      externalId = record(r.summary).externalId;
    if (typeof externalId !== 'string') throw new BadRequestException('缺少确定的钉钉审批编号，不自动重发');
    const ctx = await this.context(a),
      { api } = this.client(ctx.binding);
    await api.verify();
    const template = await api.template(expected.processCode);
    if (template.templateHash !== expected.templateHash)
      throw new ConflictException('钉钉模板已变化，请先核对实例与预演');
    return this.humanResult(a, runId, await api.evidence(externalId, expected));
  }
  async recover(a: Actor, runId: string, body: Record<string, unknown>) {
    input(body, ['requestKey', 'expectedUpdatedAt']);
    const r = await this.run(a, runId);
    checkVersion(r, body.expectedUpdatedAt);
    if (
      r.status !== 'uncertain' &&
      !(r.status === 'blocked' && record(r.summary).readbackVerified !== true) &&
      !(r.status === 'sending' && r.updatedAt.getTime() < Date.now() - 600000)
    )
      throw new BadRequestException('仅核查发送不明或未核定回读的记录；发送中须等待执行结束');
    const snapshot = nativeSnapshot(r.snapshot),
      expected = snapshot.expected,
      ctx = await this.context(a);
    if (!ctx.config.policy.enabled) throw new BadRequestException('连接未启用');
    const audit = await this.prisma.system.auditLog.findMany({
      where: {
        tenantId: a.tenantId,
        action: 'integration.native.dispatch.claim',
        objectType: 'approval',
        objectId: expected.approvalId,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const claim = audit.find((v) => record(v.afterData).runId === r.id);
    if (!claim || Date.now() - claim.createdAt.getTime() > 119 * 86400000)
      throw new BadRequestException('缺少有效发送认领记录，或超出120天查询范围，须人工核查');
    const { api } = this.client(ctx.binding);
    await api.verify();
    if ((await api.template(expected.processCode)).templateHash !== expected.templateHash)
      throw new ConflictException('模板已变化，须先核对原实例');
    const from = new Date(claim.createdAt.getTime() - 120000).toISOString(),
      until = new Date(Math.min(Date.now() + 60000, claim.createdAt.getTime() + 600000)).toISOString(),
      found = await api.recoverOwn(expected, from, until);
    await runCommand(
      this.prisma,
      a,
      'integration.native.recover@1.0',
      { ...body, runId, externalId: found.evidence.instanceId, proofHash: found.evidence.digest },
      async (tx) => {
        const current = await tx.integrationRun.findFirstOrThrow({
          where: { id: runId, tenantId: a.tenantId, actorId: a.userId, provider },
        });
        checkVersion(current, body.expectedUpdatedAt);
        if (!['uncertain', 'blocked', 'sending'].includes(current.status))
          throw new ConflictException('核回状态已变化');
        const policy = await this.policy(tx, a.tenantId),
          binding = await activityBinding(tx, a.tenantId, a.userId);
        if (
          !policy?.policy.enabled ||
          !binding ||
          bindingHash(binding) !== expected.bindingHash ||
          policy.policy.processCode !== expected.processCode ||
          policy.policy.departmentId !== expected.departmentId
        )
          throw new ConflictException('连接或授权已改变');
        const document = await this.document(tx, a.tenantId, a.userId, expected.approvalId, policy.policy);
        checkVersion(document.approval, expected.approvalVersion);
        checkVersion(document.contract, expected.contractVersion);
        const map = await tx.integrationMapping.findFirstOrThrow({
          where: {
            tenantId: a.tenantId,
            provider,
            kind: 'approval',
            localId: expected.approvalId,
            externalName: runId,
          },
        });
        await tx.integrationMapping.update({ where: { id: map.id }, data: { externalId: found.evidence.instanceId } });
        await tx.integrationRun.update({
          where: { id: runId },
          data: {
            status: 'sent',
            snapshot: json({
              ...record(current.snapshot),
              providerEvidence: found.evidence.observed,
              recoverySource: found.sources,
            }),
            summary: json({
              ...record(current.summary),
              externalId: found.evidence.instanceId,
              readbackVerified: true,
              remoteStatus: found.evidence.status,
              recoveredAt: new Date().toISOString(),
              error: null,
            }),
          },
        });
        return { runId, externalId: found.evidence.instanceId, verified: true, externalCreates: 0 };
      },
    );
    return this.humanResult(a, runId, found.evidence);
  }
  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const runs = await this.prisma.system.integrationRun.findMany({
        where: { provider, kind: 'dispatch', status: 'sent' },
        take: 20,
        orderBy: { updatedAt: 'asc' },
      });
      for (const r of runs) {
        try {
          const p = await this.policy(this.prisma.system, r.tenantId);
          if (!p?.policy.enabled || !p.policy.autoPoll) continue;
          const user = await this.prisma.system.user.findFirst({
            where: { id: r.actorId, tenantId: r.tenantId, status: 'active', deletedAt: null },
          });
          if (!user) continue;
          const binding = await activityBinding(this.prisma.system, r.tenantId, r.actorId);
          if (!binding || bindingHash(binding) !== r.bindingHash) throw Error('binding changed');
          const expected = nativeSnapshot(r.snapshot).expected,
            externalId = record(r.summary).externalId;
          if (typeof externalId !== 'string') throw Error('missing external instance');
          const { api } = this.client(binding);
          await api.verify();
          if ((await api.template(expected.processCode)).templateHash !== expected.templateHash)
            throw Error('template changed');
          const evidence = await api.evidence(externalId, expected);
          await runSystemCommand(
            this.prisma,
            createSystemPrincipal(r.tenantId, 'dingtalk_approval', randomUUID()),
            'approval.native.result',
            {
              requestKey: 'np:' + r.id + ':' + evidence.digest.slice(0, 16) + ':' + Math.floor(Date.now() / 60000),
              runId: r.id,
              proofHash: evidence.digest,
            },
            (tx) => this.apply(tx, r.id, evidence),
          );
        } catch {
          await this.prisma.system.integrationRun.updateMany({
            where: { id: r.id, status: 'sent' },
            data: {
              status: 'blocked',
              summary: json({
                ...record(r.summary),
                error: '自动读取或证据核对失败，已暂停；未覆盖本地审批，请管理员核查后手动读取。',
              }),
            },
          });
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
