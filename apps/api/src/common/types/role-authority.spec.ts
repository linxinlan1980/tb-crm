import { roleAuthority } from './role-authority';
describe('shared effective identity authority', () => {
  it('filters invalid permission values and deduplicates across roles', () => {
    expect(
      roleAuthority([
        { code: 'sales', dataScope: 'self', permissions: ['customer:read', null, 4] },
        { code: 'sales_manager', dataScope: 'dept', permissions: ['customer:read', 'customer:update'] },
      ]),
    ).toEqual({
      roles: ['sales', 'sales_manager'],
      permissions: ['customer:read', 'customer:update'],
      dataScope: 'dept',
    });
  });
  it('preserves established scope precedence and fails unknown scopes to self', () => {
    expect(roleAuthority([{ code: 'sales', dataScope: 'invented', permissions: {} }]).dataScope).toBe('self');
    expect(
      roleAuthority([
        { code: 'sales', dataScope: 'dept', permissions: [] },
        { code: 'gm', dataScope: 'all', permissions: [] },
      ]).dataScope,
    ).toBe('all');
  });
});
