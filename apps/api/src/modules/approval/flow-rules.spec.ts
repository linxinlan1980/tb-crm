import { anySignature, condition, flowInput } from './flow-rules';
import { cleanInput } from '../workspace/registry';
describe('Workflow and business input boundaries', () => {
  test('accepts explicit distinct any-one signers and preserves snapshot group semantics',()=>{
    const flow=flowInput({name:'合成或签',bizType:'contract',nodes:[{name:'任一同意',approverType:'users_any',approverValue:'2,3,4'}]});
    expect(flow.nodes[0].approverType).toBe('users_any');
    expect(anySignature({flowSnapshot:{nodes:[{order:1,mode:'any'}]}},1)).toBe(true);
    expect(anySignature({flowSnapshot:{nodes:[{order:1,mode:'all'}]}},1)).toBe(false);
    expect(anySignature({flowSnapshot:{nodes:[{order:2,mode:'any'}]}},1)).toBe(false);
    expect(anySignature(null,1)).toBe(false);
    expect(()=>flowInput({name:'重复或签',bizType:'contract',nodes:[{name:'审批',approverType:'users_any',approverValue:'2,2'}]})).toThrow();
  });
  test('accepts a channel marker without permitting identity injection',()=>{
    expect(cleanInput('customers',{name:'合成渠道客户',customerCategory:'sales_channel',channelBrand:'钉钉'})).toEqual({name:'合成渠道客户',customerCategory:'sales_channel',channelBrand:'钉钉'});
    expect(()=>cleanInput('customers',{name:'合成客户',customerCategory:'admin'})).toThrow();
  });
  test.each(['amount >= 100000 || true', 'window.alert(1)', 'amount > -1', 'amount >= 1.001', 'garbage'])(
    'rejects malformed condition %s',
    (expr) => expect(() => condition(expr, 0)).toThrow(),
  );
  test('compares exact decimal boundary', () => {
    expect(condition('amount >= 100000.01', '100000.00')).toBe(false);
    expect(condition('amount >= 100000.01', '100000.01')).toBe(true);
  });
  test('cannot publish a flow without any nodes', () =>
    expect(() => flowInput({ name: 'Empty', bizType: 'general', nodes: [] })).toThrow());
  test('rejects duplicate form keys', () =>
    expect(() =>
      flowInput({
        name: 'Duplicate',
        bizType: 'general',
        nodes: [{ name: 'Approve', approverType: 'role', approverValue: 'gm' }],
        fields: [
          { key: 'reason', label: 'A', type: 'text' },
          { key: 'reason', label: 'B', type: 'text' },
        ],
      }),
    ).toThrow());
  test('does not accept ownership injection from object data', () =>
    expect(() => cleanInput('customers', { name: 'Customer', ownerId: 999 })).toThrow());
  test('does not round invalid money silently', () =>
    expect(() =>
      cleanInput('contracts', { name: 'Contract', customerId: 1, contractType: 'implementation', amount: '1.001' }),
    ).toThrow());
  test('rejects normalized invalid dates', () =>
    expect(() => cleanInput('tasks', { title: 'Task', projectId: 1, dueDate: '2026-02-31' })).toThrow());
  test('clears nullable contact fields explicitly', () =>
    expect(cleanInput('contacts', { phone: '' }, true)).toEqual({ phone: null }));
  test('does not clear required database fields', () =>
    expect(() => cleanInput('products', { unit: '' }, true)).toThrow());
});
