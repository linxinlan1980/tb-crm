import { DwsActivities, UncertainActivityWrite, calendarProjection, todoProjection, type CalendarInput } from './dws-activities';
const binding = { profile: 'test-profile', corpId: 'test-corp', userId: 'test-user' };
const self = { success: true, result: { own: { orgEmployeeModel: { corpId: 'test-corp', userId: 'test-user' } } } };
const input: CalendarInput = { title: '【测试】客户拜访', description: '合成测试', start: '2026-11-16T12:00:00+08:00', end: '2026-11-16T12:10:00+08:00', freeBusy: 'free' };
const event = { success: true, result: { id: 'event', summary: input.title, description: input.description,
  start: { dateTime: input.start }, end: { dateTime: input.end }, freeBusy: 'FREE', status: 'confirmed' } };
const todo = (done = false, executorIds = ['test-user']) => ({ success: true, result: { todoDetailModel: {
  taskId: 'todo', subject: '【测试】审批提醒', isDone: done, executorIds } } });
const inventory = {ok:true,outcome:'success',data:{complete:true,todos:[{taskId:'todo'}]}};
function fixture(values: unknown[]) {
  const call = jest.fn(async () => { const next = values.shift(); if (next instanceof Error) throw next; return next; });
  return { call, client: new DwsActivities(binding, call) };
}
describe('DingTalk own-user activity adapter', () => {
  it('creates only on bound primary calendar and verifies every field', async () => {
    const {client,call} = fixture([self,event,event]);
    expect((await client.writeCalendar(input,null)).title).toBe(input.title);
    expect(call.mock.calls).toHaveLength(3);
    const args = (call.mock.calls as unknown as [string[]][])[1][0];
    expect(args).not.toContain('--attendees'); expect(args).not.toContain('--yes'); expect(args).not.toContain('--profile');
  });
  it('updates same stable calendar ID', async () => {
    const {client,call} = fixture([self,{success:true,result:null},event]);
    await client.writeCalendar(input,'event');
    expect((call.mock.calls as unknown as [string[]][])[1][0].slice(0,5)).toEqual(['calendar','event','update','--id','event']);
  });
  it('accepts a single identity in the CLI array shape', async () => {
    const {client} = fixture([{success:true,result:Object.values(self.result)}]);
    await expect(client.verifyIdentity()).resolves.toBeUndefined();
  });
  it('rejects mismatched company before any write', async () => {
    const {client,call} = fixture([{success:true,result:{own:{orgEmployeeModel:{corpId:'other',userId:'test-user'}}}}]);
    await expect(client.createTodo('【测试】审批提醒')).rejects.toThrow('绑定'); expect(call).toHaveBeenCalledTimes(1);
  });
  it('requires valid ordered timezone dates before calling CLI', async () => {
    const {client,call} = fixture([]);
    await expect(client.writeCalendar({...input,end:input.start},null)).rejects.toThrow('晚于');
    await expect(client.writeCalendar({...input,start:'2026-11-16'},null)).rejects.toThrow('ISO'); expect(call).not.toHaveBeenCalled();
  });
  it('preserves returned calendar ID on verification failure', async () => {
    const {client,call} = fixture([self,event,new Error('timeout')]);
    await expect(client.writeCalendar(input,null)).rejects.toMatchObject({externalId:'event'}); expect(call).toHaveBeenCalledTimes(3);
  });
  it('marks timeout on nonidempotent create uncertain without retry', async () => {
    const {client,call} = fixture([self,new Error('timeout')]);
    await expect(client.createTodo('【测试】审批提醒')).rejects.toBeInstanceOf(UncertainActivityWrite); expect(call).toHaveBeenCalledTimes(2);
  });
  it('verifies stable todo ID, title, executor and pending status', async () => {
    const {client} = fixture([self,{success:true,result:{taskId:'todo'}},todo(),inventory]);
    expect(await client.createTodo('【测试】审批提醒')).toMatchObject({id:'todo',done:false,executorIds:['test-user']});
  });
  it('rejects other employee and multiple executors', async () => {
    for(const executors of [['other'],['test-user','other']]) {
      const {client} = fixture([self,todo(false,executors),{ok:true,outcome:'success',data:{complete:true,todos:[]}}]); await expect(client.todo('todo')).rejects.toThrow(/本人|唯一执行人/);
    }
  });
  it('does not repeat completion when already done', async () => {
    const {client,call} = fixture([self,todo(true),inventory]); expect((await client.setTodoDone('todo',true)).done).toBe(true); expect(call).toHaveBeenCalledTimes(3);
  });
  it('completes and reads back, without business approval side effects', async () => {
    const {client,call} = fixture([self,todo(),inventory,{success:true,result:null},todo(true)]);
    expect((await client.setTodoDone('todo',true)).done).toBe(true); expect(call).toHaveBeenCalledTimes(5);
  });
  it('keeps failed completion verification uncertain', async () => {
    const {client} = fixture([self,todo(),inventory,{success:true,result:{}},todo()]);
    await expect(client.setTodoDone('todo',true)).rejects.toMatchObject({externalId:'todo'});
  });
  it('uses authenticated inventory when personal ID differs from employee ID', async () => {
    const {client} = fixture([self,todo(false,['opaque-personal-id']),inventory]);
    expect((await client.todo('todo')).executorIds).toEqual(['opaque-personal-id']);
  });
  it('refuses partial inventory and duplicate matches', async () => {
    for(const data of [{complete:false,todos:[{taskId:'todo'}]}, {complete:true,todos:[{taskId:'todo'},{taskId:'todo'}]}]) {
      const {client} = fixture([self,todo(),{ok:true,outcome:'success',data}]);
      await expect(client.todo('todo')).rejects.toThrow('完整');
    }
  });
  it('rejects wrong IDs and malformed nested payloads', () => {
    expect(()=>calendarProjection(event,'different')).toThrow('编号');
    expect(()=>todoProjection(todo(),'different')).toThrow('编号');
    expect(()=>todoProjection({success:true,result:{}},'todo')).toThrow();
    expect(()=>calendarProjection({success:false,result:{}},'event')).toThrow('未成功');
  });
});
