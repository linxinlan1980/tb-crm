import { condition, flowInput } from './flow-rules';
import { cleanInput } from '../workspace/registry';
describe('Workflow and business input boundaries', () => {
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
});
