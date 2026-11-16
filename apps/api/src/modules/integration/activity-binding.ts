import { BadRequestException } from '@nestjs/common';
import type { Tx } from '../workspace/command-runner';
import { bindingFromEnvironment, type DwsBinding } from './dws-directory';
export async function activityBinding(tx: Tx, tenantId: number, ownerId: number): Promise<DwsBinding | null> {
  const primary = bindingFromEnvironment();
  if (!primary) return null;
  const mapping = await tx.integrationMapping.findFirst({
    where: { tenantId, provider: 'dws-dingtalk', kind: 'user', localId: ownerId },
  });
  if (!mapping) return null;
  let extras: unknown = [];
  try {
    extras = JSON.parse(process.env.DWS_ACTIVITY_BINDINGS || '[]') as unknown;
  } catch {
    throw new BadRequestException('服务器人员钉钉授权配置无效');
  }
  if (!Array.isArray(extras) || extras.length > 500) throw new BadRequestException('服务器人员授权配置超出范围');
  const candidates: DwsBinding[] = [primary];
  for (const value of extras) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('服务器人员授权配置无效');
    const row = value as Record<string, unknown>;
    if (
      !['profile', 'corpId', 'userId'].every(
        (k) => typeof row[k] === 'string' && String(row[k]).length <= 200 && String(row[k]).trim(),
      )
    )
      throw new BadRequestException('服务器人员授权配置无效');
    if (row.corpId !== primary.corpId) throw new BadRequestException('人员钉钉授权不属于当前公司');
    candidates.push({ profile: String(row.profile), corpId: String(row.corpId), userId: String(row.userId) });
  }
  const matches = candidates.filter((b) => b.userId === mapping.externalId);
  if (matches.length > 1) throw new BadRequestException('人员钉钉授权不唯一，请由本机管理员核定');
  return matches[0] || null;
}
