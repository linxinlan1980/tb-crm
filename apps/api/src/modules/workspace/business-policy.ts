import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Actor } from '../../common/types/actor';
import { type Tx } from './command-runner';
export interface BusinessPolicy {
  enabled: boolean;
  notifyUserIds: number[];
  contractFlowId: number;
  autoSubmitContracts: boolean;
  fromDate: string;
}
export const businessPolicyKey = 'crm.business-notifications.v1';
export const policyDigest = (p: BusinessPolicy) => createHash('sha256').update(JSON.stringify(p)).digest('hex');
export function parseBusinessPolicy(input: unknown): BusinessPolicy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('业务通知规则无效');
  const p = input as Record<string, unknown>;
  if (Object.keys(p).some(k => !['enabled','notifyUserIds','contractFlowId','autoSubmitContracts','fromDate'].includes(k)) ||
    !['enabled','autoSubmitContracts'].every(k => typeof p[k] === 'boolean') ||
    !Array.isArray(p.notifyUserIds) || p.notifyUserIds.length < 1 || p.notifyUserIds.length > 8 ||
    p.notifyUserIds.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(p.notifyUserIds).size !== p.notifyUserIds.length ||
    !Number.isSafeInteger(p.contractFlowId) || Number(p.contractFlowId) <= 0 || typeof p.fromDate !== 'string' ||
    !/^20\d{2}-\d{2}-\d{2}$/.test(p.fromDate) || p.fromDate<'2010-01-01' || p.fromDate>'2060-12-31' || !Number.isFinite(Date.parse(p.fromDate)) || new Date(p.fromDate).toISOString().slice(0,10) !== p.fromDate)
    throw new BadRequestException('请配置有效通知人员、合同流程及生效日期');
  return p as unknown as BusinessPolicy;
}
export async function businessPolicy(tx: Tx, tenantId: number): Promise<BusinessPolicy | null> {
  if (process.env.CRM_BUSINESS_RULES_ENABLED !== 'true') return null;
  const row = await tx.systemSetting.findUnique({ where: { tenantId_settingKey: { tenantId, settingKey: businessPolicyKey } } });
  if (!row) return null;
  const p = parseBusinessPolicy(JSON.parse(row.settingValue) as unknown);
  return p.enabled ? p : null;
}
export async function notifyOpportunity(tx: Tx, a: Actor, row: { id: number; name?: unknown }, p: BusinessPolicy) {
  const targets = await tx.user.findMany({ where: { tenantId: a.tenantId, id: { in: p.notifyUserIds }, status: 'active', deletedAt: null }, include: { roles: { include: { role: true } } } });
  if (targets.length !== p.notifyUserIds.length || targets.some(u => !u.roles.some(r => r.role.code === 'super_admin')))
    throw new BadRequestException('商机通知人已失效或没有全公司读取权限，请管理员更新业务规则');
  await tx.notification.createMany({ data: targets.map(u => ({ tenantId: a.tenantId, userId: u.id, type: 'opportunity.created', title: '新建商机提醒', content: String(row.name ?? '新商机'), bizType: 'opportunity', bizId: row.id })) });
}
