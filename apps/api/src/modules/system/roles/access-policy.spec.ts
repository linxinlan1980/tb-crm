import { configuredPoints, parsePolicy, permits, policyPermissions } from './access-policy';
import { customerVisibility } from '../../customer/customer-visibility';
import type { Actor } from '../../../common/types/actor';
import { ownerScope } from '../../workspace/access';
import type { Tx } from '../../workspace/command-runner';
describe('role function/data policy', () => {
  it('expands only published points, preserving fixed duties separately', () => {
    const points = configuredPoints(['customer:*', 'approval:*', 'finance:read']);
    expect(points).toContain('customer:assign');
    expect(points).toContain('finance:read');
    expect(points).not.toContain('approval:approve');
    expect(policyPermissions(['customer:*', 'approval:*', 'ai:use'], ['customer:read'])).toEqual([
      'ai:use',
      'approval:*',
      'customer:read',
    ]);
  });
  it.each(['super_admin', 'gm', 'invented-role'])('rejects redefining %s through this editor', (code) => {
    expect(() => parsePolicy(code, [], 'all')).toThrow('预置职责');
  });
  it.each(
    [
      ['*'],
      ['system:*'],
      ['customer:read', 'customer:read'],
      ['customer:update'],
      ['finance:read'],
      ['contract:read'],
      ['pool:claim'],
    ].map((permissions) => ({ permissions })),
  )('rejects unknown/duplicate/dependency-invalid points %j', ({ permissions }) => {
    expect(() => parsePolicy('sales_manager', permissions, 'dept')).toThrow();
  });
  it('does not grant supervisor assignment authority to a sales role', () => {
    expect(() => parsePolicy('sales', ['customer:read', 'customer:update', 'customer:assign'], 'all')).toThrow('主管');
  });
  it.each(['custom', 'team', 'selected-departments', '', null])('rejects unsupported scope %s', (scope) => {
    expect(() => parsePolicy('sales', ['customer:read'], scope)).toThrow('范围');
  });
  it.each(['self', 'dept', 'all'])('accepts a published scope %s', (scope) => {
    expect(parsePolicy('sales', ['customer:read'], scope).dataScope).toBe(scope);
  });
  const actor = (scope: Actor['dataScope'], role = 'sales'): Actor => ({
    userId: 7,
    tenantId: 1,
    deptId: 3,
    roles: [role],
    permissions: ['customer:read'],
    dataScope: scope,
  });
  it('uses the configured data scope rather than hardcoding manager visibility', () => {
    expect(customerVisibility(actor('self', 'sales_manager'), [7, 8], false)).toEqual({ ownerId: 7 });
    expect(customerVisibility(actor('dept'), [7, 8], false)).toEqual({ ownerId: { in: [7, 8] } });
    expect(customerVisibility(actor('all'), [7, 8], false)).toEqual({});
    expect(customerVisibility(actor('custom'), [7, 8], false)).toEqual({ ownerId: 7 });
  });
  it('shares configured company-wide scope with downstream business reads', async () => {
    expect(await ownerScope({} as Tx, actor('all'))).toEqual({});
    expect(await ownerScope({} as Tx, actor('self', 'sales_manager'))).toEqual({ ownerId: { in: [7] } });
  });
  it('matches exact/module wildcards without accepting sibling prefixes', () => {
    expect(permits(['customer:*'], 'customer:assign')).toBe(true);
    expect(permits(['customer:read'], 'customer:update')).toBe(false);
  });
});
