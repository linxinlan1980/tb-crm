import { hasPermission, requirePermission, allowWrite } from './access';
import type { Actor } from '../../common/types/actor';
const sales: Actor = {
  userId: 1,
  tenantId: 1,
  deptId: 2,
  roles: ['sales'],
  permissions: ['customer:read', 'customer:update'],
  dataScope: 'self',
};
describe('Workspace permission revocation', () => {
  test('does not infer a permission solely from a role code', () => {
    expect(hasPermission({ ...sales, permissions: [] }, 'customer:read')).toBe(false);
    expect(() => requirePermission({ ...sales, permissions: [] }, 'customers', 'read')).toThrow();
  });
  test('exact permissions do not grant unrelated writes', () => {
    expect(() => requirePermission(sales, 'customers', 'create')).toThrow();
    expect(() => requirePermission(sales, 'customers', 'update')).not.toThrow();
  });
  test('boss is read-only for business writes', () =>
    expect(() => allowWrite({ ...sales, roles: ['gm'], permissions: ['*'] })).toThrow());
});
