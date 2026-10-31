import { customerVisibility } from '../customer/customer-visibility';
import { ForbiddenException } from '@nestjs/common';
import type { Actor } from '../../common/types/actor';
import type { Tx } from './command-runner';
export const admin = (a: Actor) => a.roles.includes('super_admin');
export const boss = (a: Actor) => a.roles.includes('gm');
export const manager = (a: Actor) => a.roles.includes('sales_manager');
export function allowWrite(a: Actor) {
  if (!admin(a) && !manager(a) && !a.roles.includes('sales')) throw new ForbiddenException('当前角色无业务编辑权限');
}
export async function teamIds(tx: Tx, a: Actor) {
  if (!manager(a) || a.deptId === null) return [a.userId];
  return (
    await tx.user.findMany({
      where: { tenantId: a.tenantId, deptId: a.deptId, status: 'active', deletedAt: null },
      select: { id: true },
    })
  ).map((u) => u.id);
}
export async function ownerScope(tx: Tx, a: Actor, field = 'ownerId'): Promise<Record<string, unknown>> {
  if (admin(a) || boss(a)) return {};
  return { [field]: { in: await teamIds(tx, a) } };
}
export async function customerScope(tx: Tx, a: Actor, publicVisible = true) {
  return customerVisibility(a, manager(a) ? await teamIds(tx, a) : undefined, publicVisible);
}
export function hasPermission(a: Actor, permission: string) {
  return admin(a) || a.permissions.some((p) => p === '*' || p === permission || p === permission.split(':')[0] + ':*');
}
export function resourcePermission(kind: string, operation: 'read' | 'create' | 'update') {
  const modules: Record<string, string> = {
    customers: 'customer',
    contacts: 'customer',
    leads: 'lead',
    opportunities: 'opportunity',
    contracts: 'contract',
    orders: 'order',
    projects: 'project',
    tasks: 'project',
    actions: 'action',
    followups: 'follow_up',
    products: 'product',
    'payment-plans': 'finance',
    invoices: 'finance',
    receipts: 'finance',
  };
  return `${modules[kind] ?? 'unknown'}:${operation}`;
}
export function requirePermission(a: Actor, kind: string, operation: 'read' | 'create' | 'update') {
  if (!hasPermission(a, resourcePermission(kind, operation)))
    throw new ForbiddenException('当前角色没有此业务操作权限');
}
