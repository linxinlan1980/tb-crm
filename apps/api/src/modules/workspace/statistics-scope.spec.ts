import type { Actor } from '../../common/types/actor';
import type { Tx } from './command-runner';
import { statisticsFilter, statisticsScope } from './statistics-scope';
const self: Actor = { tenantId: 1, userId: 2, deptId: 3, roles: ['sales'], permissions: ['opportunity:read'], dataScope: 'self' };
const tx = {
  user: { findMany: jest.fn().mockResolvedValue([{ id: 2, name: 'Synthetic A', deptId: 3 }, { id: 4, name: 'Synthetic B', deptId: 3 }]) },
  department: { findMany: jest.fn().mockResolvedValue([{ id: 3, name: 'Synthetic department' }]) },
} as unknown as Tx;
describe('statistics person selection', () => {
  it.each([self, { ...self, roles: ['super_admin'], dataScope: 'all' as const }, { ...self, dataScope: 'dept' as const }])('defaults to authenticated self for every role', async a => {
    expect(await statisticsScope(tx, a, {})).toEqual({ personRange: 'self', ownerIds: [2] });
  });
  it('rejects company elevation, foreign departments and contradictory selections', async () => {
    for (const q of ([{personRange:'company'}, {deptId:'9'}, {personRange:'self',ownerId:'4'}, {personRange:'person'}, {personRange:'company',deptId:'3'}, {ownerId:'0'}] as Record<string,string>[]))
      await expect(statisticsScope(tx,self,q)).rejects.toThrow();
  });
  it('requires explicit company selection and checks person membership', async () => {
    expect(await statisticsScope(tx,{...self,dataScope:'all'},{personRange:'company'})).toEqual({personRange:'company',ownerIds:null});
    await expect(statisticsScope(tx,{...self,dataScope:'dept'},{ownerId:'999'})).rejects.toThrow();
    expect((await statisticsScope(tx,{...self,dataScope:'dept'},{ownerId:'4'})).ownerIds).toEqual([4]);
  });
  it('uses document ownership for finance and execution ownership for work', () => {
    const scope = {personRange:'self' as const,ownerIds:[2]};
    expect(statisticsFilter('receipts',scope,[11])).toEqual({contractId:{in:[11]}});
    expect(statisticsFilter('actions',scope)).toEqual({assigneeId:{in:[2]}});
    expect(statisticsFilter('projects',scope)).toEqual({OR:[{salesOwnerId:{in:[2]}},{pmId:{in:[2]}}]});
  });
});
