import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Actor } from '../../common/types/actor';
import type { Tx } from './command-runner';
import { companyWide, teamIds } from './access';

export const statisticsProperties = {
  personRange: { enum: ['self', 'person', 'company', 'department'], description: 'Defaults to self, including administrators. Wider ranges require current data permission.' },
  ownerId: { type: 'integer', minimum: 1, maximum: 2147483647 },
  deptId: { type: 'integer', minimum: 1, maximum: 2147483647 },
};
export async function statisticsOptions(tx: Tx, a: Actor) {
  const owners = await tx.user.findMany({
    where: { tenantId: a.tenantId, deletedAt: null, ...(!companyWide(a) ? { id: { in: await teamIds(tx, a) } } : {}) },
    select: { id: true, name: true, deptId: true, employeeNo: true, status: true }, orderBy: { id: 'asc' },
  });
  return {
    defaultRange: 'self' as const, selfId: a.userId, canCompany: companyWide(a), owners,
    departments: !companyWide(a) && !['dept','team'].includes(a.dataScope) ? [] : await tx.department.findMany({
      where: { tenantId: a.tenantId, deletedAt: null, id: { in: owners.flatMap(u => u.deptId ? [u.deptId] : []) } },
      select: { id: true, name: true },
    }),
  };
}
export interface StatisticsScope {
  personRange: 'self' | 'person' | 'company' | 'department';
  ownerIds: number[] | null;
}
export async function statisticsScope(tx: Tx, a: Actor, q: Record<string, string>): Promise<StatisticsScope> {
  const integer = (key: string) => {
    if (q[key] === undefined) return undefined;
    if (typeof q[key] !== 'string' || !/^[1-9]\d*$/.test(q[key]) || !Number.isSafeInteger(Number(q[key])) || Number(q[key]) > 2147483647)
      throw new BadRequestException(`${key}无效`);
    return Number(q[key]);
  };
  const ownerId = integer('ownerId'), deptId = integer('deptId');
  // Explicit legacy filters remain supported; omitting every person selector always means self.
  const range = q.personRange ?? (ownerId ? 'person' : deptId ? 'department' : 'self');
  if (!['self', 'person', 'company', 'department'].includes(range)) throw new BadRequestException('人员范围无效');
  if ((range !== 'person' && ownerId !== undefined) || (range !== 'department' && deptId !== undefined))
    throw new BadRequestException('人员范围与负责人/部门参数冲突');
  if (range === 'self') return { personRange: 'self', ownerIds: [a.userId] };
  if (range === 'company') {
    if (!companyWide(a)) throw new ForbiddenException('没有全公司统计数据权限');
    return { personRange: 'company', ownerIds: null };
  }
  if (range === 'person' && !ownerId || range === 'department' && !deptId) throw new BadRequestException('请选择人员或部门');
  if (range === 'department' && !companyWide(a) && (!['dept', 'team'].includes(a.dataScope) || a.deptId !== deptId))
    throw new ForbiddenException('没有该部门统计数据权限');
  const options = await statisticsOptions(tx, a);
  if (range === 'person') {
    if (!options.owners.some(u => u.id === ownerId)) throw new ForbiddenException('没有该人员统计数据权限');
    return { personRange: 'person', ownerIds: [ownerId!] };
  }
  if (!options.departments.some(d => d.id === deptId)) throw new ForbiddenException('没有该部门统计数据权限');
  return { personRange: 'department', ownerIds: options.owners.filter(u => u.deptId === deptId).map(u => u.id) };
}
export function statisticsFilter(kind: string, scope: StatisticsScope, contractIds?: number[]): Record<string, unknown> {
  if (scope.ownerIds === null) return {};
  const selected = { in: scope.ownerIds };
  if (['customers', 'opportunities', 'contracts', 'orders'].includes(kind)) return { ownerId: selected };
  if (kind === 'receipts') {
    if (!contractIds) throw new BadRequestException('回款人员统计须先解析合同归属');
    return { contractId: { in: contractIds } };
  }
  if (['invoices', 'payment-plans'].includes(kind)) return { contract: { ownerId: selected } };
  if (kind === 'contacts') return { customer: { ownerId: selected } };
  if (kind === 'projects') return { OR: [{ salesOwnerId: selected }, { pmId: selected }] };
  if (['tasks', 'actions', 'leads'].includes(kind)) return { assigneeId: selected };
  if (kind === 'followups') return { createdBy: selected };
  throw new BadRequestException('该对象不支持人员统计范围');
}
export async function statisticsResourceFilter(tx: Tx, a: Actor, kind: string, scope: StatisticsScope) {
  const contracts = kind === 'receipts' && scope.ownerIds !== null
    ? await tx.contract.findMany({where:{tenantId:a.tenantId,deletedAt:null,ownerId:{in:scope.ownerIds}},select:{id:true}})
    : [];
  return statisticsFilter(kind, scope, contracts.map(c=>c.id));
}
