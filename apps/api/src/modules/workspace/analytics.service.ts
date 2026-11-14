import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { WorkspaceService } from './workspace.service';
import { admin, boss, hasPermission, teamIds } from './access';
import { validateActor } from './command-runner';
import { reportQuery, forecastReport, collectionReport } from './analytics-policy';
const LIMIT = 10000;
function bounded<T>(rows: T[]) {
  if (rows.length > LIMIT)
    throw new BadRequestException('本次报表超过10000条查询预算，请缩小负责人或期间范围；系统未返回截断统计');
  return rows;
}
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}
  async options(a: Actor) {
    if (!hasPermission(a, 'opportunity:read') && !hasPermission(a, 'finance:read'))
      throw new ForbiddenException('没有报表权限');
    const tx = this.prisma.system;
    const owners = await tx.user.findMany({
      where: {
        tenantId: a.tenantId,
        deletedAt: null,
        ...(!admin(a) && !boss(a) ? { id: { in: await teamIds(tx, a) } } : {}),
      },
      select: { id: true, name: true, deptId: true },
      orderBy: { id: 'asc' },
    });
    return {
      owners,
      departments: await tx.department.findMany({
        where: { tenantId: a.tenantId, id: { in: owners.flatMap((u) => (u.deptId ? [u.deptId] : [])) } },
        select: { id: true, name: true },
      }),
      canForecast: hasPermission(a, 'opportunity:read'),
      canCollections: hasPermission(a, 'finance:read') && hasPermission(a, 'contract:read'),
    };
  }
  async forecast(a: Actor, query: Record<string, string>) {
    const q = reportQuery(query);
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const scope = await this.workspace.scope(tx, a, 'opportunities');
        const departmentOwners = q.deptId
          ? await tx.user.findMany({ where: { tenantId: a.tenantId, deptId: q.deptId }, select: { id: true } })
          : [];
        const rows = bounded(
          await tx.opportunity.findMany({
            where: {
              AND: [
                scope,
                ...(q.ownerId ? [{ ownerId: q.ownerId }] : []),
                ...(q.deptId ? [{ ownerId: { in: departmentOwners.map((u) => u.id) } }] : []),
                {
                  OR: [
                    { expectedCloseDate: { gte: q.start, lt: q.end } },
                    { expectedCloseDate: null },
                    {
                      closedAt: {
                        gte: new Date(q.start.getTime() - 8 * 3600000),
                        lt: new Date(q.end.getTime() - 8 * 3600000),
                      },
                    },
                    { status: { not: 'open' }, closedAt: null },
                  ],
                },
              ],
            },
            select: {
              id: true,
              name: true,
              ownerId: true,
              stage: true,
              status: true,
              amount: true,
              expectedCloseDate: true,
              closedAt: true,
              nextAction: true,
              nextActionDate: true,
            },
            orderBy: [{ expectedCloseDate: 'asc' }, { id: 'asc' }],
            take: LIMIT + 1,
          }),
        );
        const stages = await tx.opportunityStage.findMany({
          where: { tenantId: a.tenantId },
          select: { code: true, name: true, probability: true, isActive: true },
        });
        const result = forecastReport(rows, stages, q);
        const owners = await tx.user.findMany({
          where: { tenantId: a.tenantId, id: { in: [...new Set(rows.map((r) => r.ownerId))] } },
          select: { id: true, name: true },
        });
        const names = new Map(owners.map((u) => [u.id, u.name]));
        return {
          version: '1.0',
          generatedAt: new Date().toISOString(),
          period: { year: q.year, month: q.month },
          currency: 'CNY',
          scope: '当前归属权限；预计成交日期归期；关闭日使用Asia/Shanghai；缺日期池为当前可见范围全部年份',
          ...result,
          owners: result.owners.map((r) => ({ ...r, name: names.get(r.ownerId) ?? '历史负责人' })),
          details: {
            ...result.details,
            items: result.details.items.map((r) => ({ ...r, ownerName: names.get(r.ownerId) ?? '历史负责人' })),
          },
          notices: [
            '阶段加权是规则预测，不是销售承诺或AI预测。',
            '停用/未知阶段不计加权额；已赢单与开放商机互斥。',
            '金额使用当前值；尚无历史快照/预测提报及锁定。',
          ],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }
  async collections(a: Actor, query: Record<string, string>) {
    const q = reportQuery(query);
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const contractScope = await this.workspace.scope(tx, a, 'contracts');
        const receiptScope = await this.workspace.scope(tx, a, 'receipts');
        const planScope = await this.workspace.scope(tx, a, 'payment-plans');
        const departmentOwners = q.deptId
          ? await tx.user.findMany({ where: { tenantId: a.tenantId, deptId: q.deptId }, select: { id: true } })
          : [];
        const base: Prisma.ContractWhereInput = {
          AND: [
            contractScope,
            ...(q.ownerId ? [{ ownerId: q.ownerId }] : []),
            ...(q.deptId ? [{ ownerId: { in: departmentOwners.map((u) => u.id) } }] : []),
            ...(q.contractId ? [{ id: q.contractId }] : []),
          ],
        };
        const excludedCurrencyContracts = await tx.contract.count({
          where: { AND: [base, { currency: { not: 'CNY' } }] },
        });
        const contracts = bounded(
          await tx.contract.findMany({
            where: { AND: [base, { currency: 'CNY' }] },
            select: {
              id: true,
              contractNo: true,
              name: true,
              ownerId: true,
              amount: true,
              currency: true,
              signDate: true,
              status: true,
            },
            orderBy: { id: 'desc' },
            take: LIMIT + 1,
          }),
        );
        const ids = contracts.map((c) => c.id);
        const plans = bounded(
          await tx.paymentPlan.findMany({
            where: { AND: [planScope, { contractId: { in: ids } }] },
            select: {
              id: true,
              planNo: true,
              contractId: true,
              amount: true,
              receivedAmount: true,
              outstandingAmount: true,
              dueDate: true,
              status: true,
            },
            orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
            take: LIMIT + 1,
          }),
        );
        const receipts = bounded(
          await tx.receipt.findMany({
            where: {
              AND: [
                receiptScope,
                {
                  ledgerManaged: q.source === 'managed',
                  status: 'confirmed',
                  receiptDate: { gte: q.start, lt: q.end },
                },
                q.ownerId || q.contractId || q.deptId
                  ? { contractId: { in: ids } }
                  : { OR: [{ contractId: { in: ids } }, { contractId: null }] },
              ],
            },
            select: {
              id: true,
              receiptNo: true,
              contractId: true,
              amount: true,
              allocatedAmount: true,
              unallocatedAmount: true,
              receiptDate: true,
              status: true,
              ledgerManaged: true,
            },
            orderBy: [{ receiptDate: 'desc' }, { id: 'desc' }],
            take: LIMIT + 1,
          }),
        );
        const result = collectionReport(contracts, plans, receipts, q);
        const users = await tx.user.findMany({
          where: { tenantId: a.tenantId, id: { in: [...new Set(contracts.map((c) => c.ownerId))] } },
          select: { id: true, name: true },
        });
        const names = new Map(users.map((u) => [u.id, u.name]));
        const contractNames = new Map(contracts.map((c) => [c.id, c.name]));
        return {
          version: '1.0',
          generatedAt: new Date().toISOString(),
          period: { year: q.year, month: q.month },
          source: q.source,
          currency: 'CNY',
          balanceAsOf: q.today.toISOString().slice(0, 10),
          excludedCurrencyContracts,
          ...result,
          owners: result.owners.map((r) => ({ ...r, name: names.get(r.ownerId) ?? '历史负责人' })),
          matrix: {
            ...result.matrix,
            items: result.matrix.items.map((c) => ({ ...c, ownerName: names.get(c.ownerId) ?? '历史负责人' })),
          },
          receipts: {
            ...result.receipts,
            items: result.receipts.items.map((r) => ({
              ...r,
              contractName: r.contractId ? (contractNames.get(r.contractId) ?? '历史合同') : '待绑定合同（不归属销售）',
            })),
          },
          balances: {
            ...result.balances,
            items: result.balances.items.map((p) => ({
              ...p,
              contractName: contractNames.get(p.contractId) ?? '历史合同',
            })),
          },
          overdue: {
            ...result.overdue,
            items: result.overdue.items.map((p) => ({
              ...p,
              contractName: contractNames.get(p.contractId) ?? '历史合同',
            })),
          },
          plans: {
            ...result.plans,
            items: result.plans.items.map((p) => ({
              ...p,
              contractName: contractNames.get(p.contractId) ?? '历史合同',
            })),
          },
          notices: [
            '到账按收款日期归期，仅包含当前已复核且未作废记录；不是银行核验。',
            '已核销/未核销及应收余额为当前值，不是历史月末余额；不与到账重复相加。',
            '计划按到期日统计，不能代替客户承诺日期；旧签约规则生成的30天计划需核对付款条款。',
            '月份仅筛选期间计划/到账；当前余额和账龄不受期间限制。按销售筛选排除未绑定合同款。',
            q.source === 'legacy'
              ? '当前为历史只读记录，不计入正式台账实绩。'
              : '当前为本地管理台账；未绑定合同到账单列，不强行归销售。',
          ],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }
}
