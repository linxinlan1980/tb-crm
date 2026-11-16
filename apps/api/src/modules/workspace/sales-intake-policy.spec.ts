import {
  parseSalesManifest,
  knownSalesAmount,
  salesAmountProjection,
  salesForecastEligible,
  intakeHash,
} from './sales-intake-policy';
const manifest = () => ({
  batchKey: 'synthetic',
  sourceHash: 'a'.repeat(64),
  customers: [{ key: 'c', name: 'Synthetic Customer', channel: 'direct', identityStatus: 'pending', notes: '' }],
  cases: [
    {
      key: 'case',
      customerKey: 'c',
      name: 'Synthetic quote',
      kind: 'quote',
      amount: null,
      amountBasis: 'Unit quote, total unknown',
      forecastEligible: false,
      outcome: 'open',
      sourceDate: null,
      sourceIds: ['synthetic:source'],
      notes: '',
      nextAction: 'Confirm scope',
    },
  ],
  followups: [],
  actions: [],
  archiveIds: [],
});
describe('reviewed historical sales manifest', () => {
  it('keeps unknown prices separate from a known zero and recurring amounts out of forecasts', () => {
    expect(parseSalesManifest(manifest()).cases[0].amount).toBeNull();
    const unknown = {
      amount: '0',
      weightedAmount: '0',
      healthFactors: { salesIntake: { amountKnown: false, forecastEligible: false } },
    };
    expect(knownSalesAmount(unknown)).toBe(false);
    expect(salesAmountProjection(unknown).amount).toBeNull();
    expect(salesForecastEligible(unknown)).toBe(false);
    expect(knownSalesAmount({ healthFactors: { salesIntake: { amountKnown: true } } })).toBe(true);
    expect(
      salesForecastEligible({ healthFactors: { salesIntake: { amountKnown: true, forecastEligible: false } } }),
    ).toBe(false);
  });
  it('rejects foreign identity injection and unsupported fields', () => {
    expect(() => parseSalesManifest({ ...manifest(), tenantId: 2 })).toThrow();
    expect(() => parseSalesManifest({ ...manifest(), actorId: 2 })).toThrow();
  });
  it('rejects orphan, duplicate source keys and normalized duplicate new customer names', () => {
    const m = manifest();
    expect(() => parseSalesManifest({ ...m, cases: [{ ...m.cases[0], customerKey: 'missing' }] })).toThrow();
    expect(() => parseSalesManifest({ ...m, cases: [...m.cases, ...m.cases] })).toThrow();
    expect(() =>
      parseSalesManifest({
        ...m,
        customers: [...m.customers, { ...m.customers[0], key: 'c2', name: 'Ｓynthetic Customer' }],
      }),
    ).toThrow();
  });
  it('requires reliable loss evidence and contract versions for won items', () => {
    const m = manifest(),
      c = m.cases[0];
    expect(() => parseSalesManifest({ ...m, cases: [{ ...c, outcome: 'lost' }] })).toThrow();
    expect(() => parseSalesManifest({ ...m, cases: [{ ...c, outcome: 'won' }] })).toThrow();
    expect(() => parseSalesManifest({ ...m, customers: [{ ...m.customers[0], existingId: 1 }] })).toThrow();
  });
  it('rejects invented dates, unknown forecast totals and mismatched last quote totals', () => {
    const m = manifest(),
      c = m.cases[0];
    for (const sourceDate of ['2026-02-31', '2009-01-01', '2061-01-01'])
      expect(() => parseSalesManifest({ ...m, cases: [{ ...c, sourceDate }] })).toThrow();
    expect(() => parseSalesManifest({ ...m, cases: [{ ...c, forecastEligible: true }] })).toThrow();
    expect(() =>
      parseSalesManifest({
        ...m,
        cases: [
          {
            ...c,
            amount: '100',
            quoteVersions: [{ amount: '200', sourceId: 'synthetic', sourceDate: null, basis: 'Total' }],
          },
        ],
      }),
    ).toThrow();
  });
  it('requires positive draft, matching line math and no won draft', () => {
    const m = manifest(),
      c = m.cases[0],
      draft = {
        name: 'Synthetic draft',
        signingCompany: 'Synthetic supplier',
        type: 'implementation',
        taxRate: 6,
        paymentTerms: '50/50, dates unconfirmed',
        remark: 'Not signed',
        items: [{ name: 'Service', manDays: 2, unitPrice: '50', amount: '100' }],
      };
    expect(
      parseSalesManifest({ ...m, cases: [{ ...c, kind: 'contract', amount: '100', draft }] }).cases[0].draft?.items,
    ).toHaveLength(1);
    expect(() => parseSalesManifest({ ...m, cases: [{ ...c, kind: 'contract', amount: '90', draft }] })).toThrow();
    expect(() =>
      parseSalesManifest({
        ...m,
        cases: [
          {
            ...c,
            kind: 'contract',
            amount: '100',
            draft: { ...draft, items: [{ ...draft.items[0], unitPrice: '40' }] },
          },
        ],
      }),
    ).toThrow();
  });
  it('limits record count and produces reproducible source hashes', () => {
    const m = manifest();
    expect(intakeHash(m)).toBe(intakeHash(structuredClone(m)));
    expect(() =>
      parseSalesManifest({
        ...m,
        followups: Array(501).fill({
          key: 'f',
          caseKey: 'case',
          kind: 'revision',
          occurredAt: null,
          content: 'Synthetic',
          sourceId: 'synthetic',
        }),
      }),
    ).toThrow();
  });
});
