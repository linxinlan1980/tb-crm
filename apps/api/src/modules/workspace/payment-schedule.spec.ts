import { paymentSchedule } from './payment-schedule';
describe('explicit contract payment schedule', () => {
  const part = (amount = '0.10', dueDate = '2026-11-30') => ({ amount, dueDate, condition: '签约首款' });
  test('exact cents across installments and preserved real terms', () => {
    const rows = paymentSchedule([part(), { ...part('0.20', '2026-12-31'), condition: '验收尾款' }], '0.30');
    expect(rows.map((r) => r.amount.toFixed(2))).toEqual(['0.10', '0.20']);
    expect(rows[1].triggerCondition).toBe('验收尾款');
  });
  test.each([
    undefined,
    [],
    Array(25).fill(part()),
    [part('0')],
    [part('0.001')],
    [part('1e2')],
    [part('0.10', '2026-02-30')],
    [{ ...part(), condition: '' }],
    [{ ...part(), actorId: 3 }],
  ])('reject invalid or missing schedule %#', (v) => expect(() => paymentSchedule(v, '0.10')).toThrow());
  test('reject mismatched total', () => expect(() => paymentSchedule([part()], '1.00')).toThrow('合计'));
  test('reject reversed dates', () =>
    expect(() => paymentSchedule([part('0.10', '2026-12-31'), part('0.10', '2026-11-30')], '0.20')).toThrow('先后'));
});
