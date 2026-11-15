import { readDirectory, type DwsBinding, type DwsRead } from './dws-directory';
const binding: DwsBinding = { profile: 'fixture-profile', corpId: 'corp-fixture', userId: 'self-fixture' };
function fixture(transform?: (args: string[], value: unknown) => unknown): { read: DwsRead; calls: string[][] } {
  const calls: string[][] = [];
  const read: DwsRead = async (args) => {
    calls.push(args);
    let value: unknown;
    if (args.includes('get-self'))
      value = {
        success: true,
        result: {
          0: {
            orgEmployeeModel: {
              corpId: binding.corpId,
              userId: binding.userId,
              orgName: '测试企业',
              orgUserName: '测试授权人',
            },
          },
        },
      };
    else if (args.includes('get-info')) value = { success: true, result: { deptId: 1, deptName: '测试企业' } };
    else if (args.includes('list-children'))
      value = {
        success: true,
        result:
          args[4] === '1'
            ? [{ deptId: 2, deptName: '销售中心' }]
            : args[4] === '2'
              ? [{ deptId: 3, deptName: '华东' }]
              : [],
      };
    else if (args.includes('list-members'))
      value = { success: true, deptUserList: [{ userInfo: { userId: 'person-one', name: '测试成员' } }] };
    else
      value = {
        success: true,
        result: { 0: { orgEmployeeModel: { orgUserId: 'person-one', orgUserName: '测试成员', orgTitle: '销售' } } },
      };
    return transform ? transform(args, value) : value;
  };
  return { read, calls };
}
describe('DWS company-bound directory reader', () => {
  it('accepts the current CLI array-shaped identity/detail result', async () => {
    const { read } = fixture((args, value) => {
      if (args[2] === 'get-self' || args[2] === 'get') {
        const data = value as { success: boolean; result: Record<string, unknown> };
        return { success: data.success, result: Object.values(data.result) };
      }
      return value;
    });
    expect((await readDirectory(binding, read)).complete).toBe(true);
  });
  it('visits nested departments independently of discovery and includes root members', async () => {
    const { read, calls } = fixture();
    const result = await readDirectory(binding, read);
    expect(result.complete).toBe(true);
    expect(result.departments.map((d) => [d.externalId, d.parentExternalId, d.depth])).toEqual([
      ['1', null, 0],
      ['2', '1', 1],
      ['3', '2', 2],
    ]);
    expect(result.people).toEqual([
      { externalId: 'person-one', name: '测试成员', departmentIds: ['1', '2', '3'], position: '销售' },
    ]);
    expect(calls.filter((c) => c.includes('list-children'))).toHaveLength(3);
  });
  it('rejects a changed company before reading organization', async () => {
    const { read, calls } = fixture();
    await expect(readDirectory({ ...binding, corpId: 'other-company' }, read)).rejects.toThrow('绑定不一致');
    expect(calls).toHaveLength(1);
  });
  it('rejects another authorized human even in the same company', async () => {
    await expect(readDirectory({ ...binding, userId: 'other-reader' }, fixture().read)).rejects.toThrow('绑定不一致');
  });
  it.each(['list-children', 'list-members', 'get'])(
    'marks failed %s incomplete, never silently skips it',
    async (command) => {
      const { read } = fixture((args, value) => {
        if (args[2] === command && (command === 'get' || args[4] === '2')) throw new Error('permission denied');
        return value;
      });
      const result = await readDirectory(binding, read);
      expect(result.complete).toBe(false);
      expect(result.hasMore).toBe(true);
      expect(result.failures.length).toBeGreaterThan(0);
    },
  );
  it('rejects unconsumed pagination', async () => {
    const { read } = fixture((args, value) =>
      args.includes('list-members')
        ? { success: true, deptUserList: [], hasMore: true, nextCursor: 'not-consumed' }
        : value,
    );
    const result = await readDirectory(binding, read);
    expect(result.complete).toBe(false);
  });
  it('rejects cycles instead of claiming the tree is complete', async () => {
    const { read } = fixture((args, value) =>
      args.includes('list-children') && args[4] === '3'
        ? { success: true, result: [{ deptId: 1, deptName: '循环' }] }
        : value,
    );
    expect((await readDirectory(binding, read)).complete).toBe(false);
  });
  it('rejects mismatched individual details', async () => {
    const { read } = fixture((args, value) =>
      args[2] === 'get'
        ? { success: true, result: { 0: { orgEmployeeModel: { orgUserId: 'wrong', orgUserName: '他人' } } } }
        : value,
    );
    const result = await readDirectory(binding, read);
    expect(result.complete).toBe(false);
    expect(result.people).toHaveLength(0);
  });
});
