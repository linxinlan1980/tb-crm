import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
export function creditCode(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('统一社会信用代码格式无效');
  const code = value.normalize('NFKC').replace(/\s/gu, '').toUpperCase();
  if (!/^[0-9ABCDEFGHJKLMNPQRTUWXY]{18}$/.test(code))
    throw new BadRequestException('统一社会信用代码须为18位有效字母和数字；此校验不验证工商登记真实性');
  return code;
}
export const creditFingerprint = (code: string | null) =>
  code ? createHash('sha256').update(code).digest('hex') : null;
export const phoneKey = (value: string | null | undefined) => {
  let n = (value ?? '')
    .normalize('NFKC')
    .split(/转|ext\.?|x/i)[0]
    .replace(/\D/g, '');
  if (n.startsWith('0086')) n = n.slice(4);
  else if (n.startsWith('86') && n.length >= 12) n = n.slice(2);
  if (n.startsWith('0')) n = n.slice(1);
  return n.length >= 7 && n.length <= 20 ? n : '';
};
export function domainKey(value: string | null | undefined) {
  if (!value?.trim()) return '';
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value).hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return '';
  }
}
export const looseName = (value: string | null | undefined) =>
  (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '')
    .replace(/(股份有限公司|有限责任公司|有限公司)$/u, '');
export type IdentityRow = {
  id: number;
  name: string;
  shortName: string | null;
  creditCode: string | null;
  companyPhone: string | null;
  website: string | null;
  address: string | null;
  legalPerson: string | null;
};
export type IdentityInput = Partial<Omit<IdentityRow, 'id'>>;
export function identityMatch(input: IdentityInput, row: IdentityRow) {
  const exactName = (v: string) => v.normalize('NFKC').replace(/\s/gu, '').toLowerCase();
  const hard =
    !!(input.name && exactName(input.name) === exactName(row.name)) ||
    !!(
      input.creditCode &&
      row.creditCode &&
      input.creditCode === row.creditCode.normalize('NFKC').replace(/\s/gu, '').toUpperCase()
    );
  const reasons: string[] = [];
  if (hard) reasons.push('客户名称或统一社会信用代码相同');
  const names = [input.name, input.shortName].map(looseName).filter((v) => v.length >= 4);
  if (!hard && [row.name, row.shortName].map(looseName).some((v) => names.includes(v))) reasons.push('名称或简称相近');
  if (domainKey(input.website) && domainKey(input.website) === domainKey(row.website)) reasons.push('官网域名相同');
  if (phoneKey(input.companyPhone) && phoneKey(input.companyPhone) === phoneKey(row.companyPhone))
    reasons.push('企业联系电话相同');
  if (
    input.address &&
    input.legalPerson &&
    row.address &&
    row.legalPerson &&
    exactName(input.address) === exactName(row.address) &&
    exactName(input.legalPerson) === exactName(row.legalPerson)
  )
    reasons.push('地址及法定代表人相同');
  return { hard, reasons };
}
