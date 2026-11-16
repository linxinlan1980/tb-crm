import { BadRequestException } from '@nestjs/common';
const modules = [
  ['customer', '客户与联系人'],
  ['lead', '线索'],
  ['opportunity', '商机'],
  ['contract', '合同'],
  ['order', '订单'],
  ['project', '项目任务与售后'],
  ['follow_up', '跟进'],
  ['action', '行动计划与个人日程'],
] as const;
export const accessCatalog = [
  ...modules.flatMap(([code, label]) =>
    ['read', 'create', 'update'].map((action) => ({
      code: `${code}:${action}`,
      label: `${label}：${{ read: '查看', create: '新增', update: '编辑及业务操作' }[action]}`,
      module: code,
    })),
  ),
  { code: 'product:read', label: '产品目录：查看', module: 'product' },
  { code: 'finance:read', label: '回款及应收：查看', module: 'finance' },
  { code: 'customer:assign', label: '客户：分配及整体交接（主管）', module: 'customer' },
  { code: 'pool:claim', label: '公海：领取', module: 'pool' },
  { code: 'pool:return', label: '客户：退回公海', module: 'pool' },
];
export function permits(permissions: string[], point: string) {
  return permissions.some((p) => p === '*' || p === point || p === point.split(':')[0] + ':*');
}
export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
export function configuredPoints(value: unknown) {
  const permissions = strings(value);
  return accessCatalog.filter((p) => permits(permissions, p.code)).map((p) => p.code);
}
export function parsePolicy(code: string, permissions: unknown, scope: unknown) {
  if (!['sales', 'sales_manager'].includes(code))
    throw new BadRequestException('管理员及老板保持预置职责；请配置销售或销售主管');
  if (typeof scope !== 'string' || !['self', 'dept', 'all'].includes(scope))
    throw new BadRequestException('请选择本人、本部门或公司范围');
  if (
    !Array.isArray(permissions) ||
    permissions.length > accessCatalog.length ||
    !permissions.every((p) => typeof p === 'string' && accessCatalog.some((c) => c.code === p)) ||
    new Set(permissions).size !== permissions.length
  )
    throw new BadRequestException('功能权限必须来自公布目录且不能重复');
  const points = permissions as string[];
  if (code === 'sales' && points.includes('customer:assign')) throw new BadRequestException('销售不能获得主管分配职责');
  for (const p of points) {
    const [module, action] = p.split(':');
    if (['create', 'update', 'assign'].includes(action) && !points.includes(module + ':read'))
      throw new BadRequestException('新增、编辑或分配需要对应查看权限');
    if (
      ['lead', 'opportunity', 'contract', 'order', 'project', 'follow_up', 'action'].includes(module) &&
      !points.includes('customer:read')
    )
      throw new BadRequestException('关联销售业务需要客户查看权限');
    if (module === 'finance' && !points.includes('contract:read'))
      throw new BadRequestException('回款统计需要合同查看权限');
    if (module === 'pool' && !['customer:read', 'customer:update'].every((v) => points.includes(v)))
      throw new BadRequestException('公海操作需要客户查看和编辑权限');
    if (action === 'assign' && !points.includes('customer:update'))
      throw new BadRequestException('分配需要客户编辑权限');
  }
  return { points: points.slice().sort(), dataScope: scope as 'self' | 'dept' | 'all' };
}
export function policyPermissions(prior: unknown, points: string[]) {
  const editableModules = new Set(accessCatalog.map((p) => p.module));
  // Approval, AI and other fixed role duties are not silently rewritten by this matrix.
  return [...new Set([...strings(prior).filter((p) => !editableModules.has(p.split(':')[0])), ...points])].sort();
}
