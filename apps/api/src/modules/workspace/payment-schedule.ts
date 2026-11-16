import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const paymentScheduleSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 24,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['amount', 'dueDate', 'condition'],
    properties: {
      amount: { type: 'string', pattern: '^\\d{1,13}(\\.\\d{1,2})?$' },
      dueDate: { type: 'string', format: 'date' },
      condition: { type: 'string', minLength: 1, maxLength: 200 },
    },
  },
};
export function paymentSchedule(value: unknown, contractAmount: string) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 24)
    throw new BadRequestException('请按实际合同填写1至24期回款计划');
  const rows = value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('回款计划格式无效');
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((k) => !['amount', 'dueDate', 'condition'].includes(k)))
      throw new BadRequestException('回款计划存在未定义参数');
    if (
      typeof row.amount !== 'string' ||
      !/^\d{1,13}(\.\d{1,2})?$/.test(row.amount) ||
      new Prisma.Decimal(row.amount).lte(0)
    )
      throw new BadRequestException('每期金额须大于0，最多保留两位小数');
    if (typeof row.dueDate !== 'string' || !/^(20\d{2}|2100)-\d{2}-\d{2}$/.test(row.dueDate))
      throw new BadRequestException('请填写有效的到期日期');
    const dueDate = new Date(row.dueDate + 'T00:00:00.000Z');
    if (!Number.isFinite(dueDate.getTime()) || dueDate.toISOString().slice(0, 10) !== row.dueDate)
      throw new BadRequestException('到期日期不存在');
    if (typeof row.condition !== 'string' || !row.condition.trim() || row.condition.length > 200)
      throw new BadRequestException('请填写200字以内的实际付款条件');
    return { amount: new Prisma.Decimal(row.amount), dueDate, triggerCondition: row.condition.trim() };
  });
  const total = rows.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
  if (!total.eq(contractAmount)) throw new BadRequestException('各期回款金额合计必须等于合同金额');
  for (let i = 1; i < rows.length; i++)
    if (rows[i].dueDate < rows[i - 1].dueDate) throw new BadRequestException('请按到期日期先后填写回款计划');
  return rows;
}
