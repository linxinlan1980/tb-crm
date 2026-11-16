import {
  creditCode,
  creditFingerprint,
  domainKey,
  phoneKey,
  identityMatch,
  type IdentityRow,
} from './customer-matching';
const row: IdentityRow = {
  id: 1,
  name: '合成星河科技有限公司',
  shortName: '合成星河科技',
  creditCode: '91999999000000001A',
  companyPhone: '021-12345678',
  website: 'https://www.synthetic.example.invalid/path',
  address: '合成街1号',
  legalPerson: '测试人员',
};
describe('customer identity matching', () => {
  test('normalizes credit width, whitespace and case without claiming official verification', () => {
    expect(creditCode('９１９９９９９９００００００００１a')).toBe(row.creditCode);
    expect(creditFingerprint(creditCode(row.creditCode))).toHaveLength(64);
    expect(creditCode('')).toBeNull();
  });
  test.each(['12345', '91999999000000001Z', 'x'.repeat(19), 123])('reject invalid credit format %#', (v) =>
    expect(() => creditCode(v)).toThrow(),
  );
  test('normalizes phone and domain variants', () => {
    expect(phoneKey('+86 21 1234 5678')).toBe(phoneKey(row.companyPhone));
    expect(domainKey('SYNTHETIC.example.invalid/a')).toBe(domainKey(row.website));
  });
  test('only name or license blocks; shared switchboards/domains remain warnings', () => {
    expect(identityMatch({ name: row.name }, row).hard).toBe(true);
    expect(identityMatch({ name: '改名企业', creditCode: row.creditCode }, row).hard).toBe(true);
    const m = identityMatch({ name: '另一主体', website: row.website, companyPhone: row.companyPhone }, row);
    expect(m.hard).toBe(false);
    expect(m.reasons).toHaveLength(2);
  });
  test('does not match missing values or legal person alone', () => {
    expect(identityMatch({}, row).reasons).toEqual([]);
    expect(identityMatch({ legalPerson: row.legalPerson }, row).reasons).toEqual([]);
  });
  test('matches alias and address plus legal person as review hints', () => {
    expect(identityMatch({ name: '合成星河科技股份有限公司' }, row).reasons).toContain('名称或简称相近');
    expect(identityMatch({ address: row.address, legalPerson: row.legalPerson }, row).reasons).toContain(
      '地址及法定代表人相同',
    );
  });
});
