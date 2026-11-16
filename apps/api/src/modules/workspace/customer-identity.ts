import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Tx } from './command-runner';
import { uniqueCustomer } from './customer-policy';
import { creditCode, creditFingerprint, type IdentityInput } from './customer-matching';
export async function uniqueCustomerIdentity(
  tx: Tx,
  tenantId: number,
  input: IdentityInput & { name: string },
  except?: number,
) {
  const nameFingerprint = await uniqueCustomer(tx, tenantId, input.name, except);
  const normalized = creditCode(input.creditCode);
  if (normalized) {
    const previous = await tx.customer.findMany({
      where: { tenantId, ...(except ? { id: { not: except } } : {}), creditCode: { not: null } },
      select: { creditCode: true },
      take: 10001,
    });
    if (previous.length > 10000) throw new BadRequestException('企业证照查重超过当前预算，请联系管理员核对');
    if (previous.some((r) => r.creditCode?.normalize('NFKC').replace(/\s/gu, '').toUpperCase() === normalized))
      throw new ConflictException('该统一社会信用代码已存在，请联系主管核对');
  }
  return { nameFingerprint, creditCode: normalized, creditFingerprint: creditFingerprint(normalized) };
}
