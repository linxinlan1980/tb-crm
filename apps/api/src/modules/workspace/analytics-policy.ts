import { BadRequestException } from '@nestjs/common';
import { Prisma, type Opportunity, type Contract, type PaymentPlan, type Receipt } from '@prisma/client';
export type ForecastRow = Pick<
  Opportunity,
  | 'id'
  | 'name'
  | 'ownerId'
  | 'stage'
  | 'status'
  | 'amount'
  | 'expectedCloseDate'
  | 'closedAt'
  | 'nextAction'
  | 'nextActionDate'
>;
export type ContractRow = Pick<
  Contract,
  'id' | 'contractNo' | 'name' | 'ownerId' | 'amount' | 'currency' | 'signDate' | 'status'
>;
export type PlanRow = Pick<
  PaymentPlan,
  'id' | 'planNo' | 'contractId' | 'amount' | 'receivedAmount' | 'outstandingAmount' | 'dueDate' | 'status'
>;
export type ReceiptRow = Pick<
  Receipt,
  | 'id'
  | 'receiptNo'
  | 'contractId'
  | 'amount'
  | 'allocatedAmount'
  | 'unallocatedAmount'
  | 'receiptDate'
  | 'status'
  | 'ledgerManaged'
>;
export type ReportQuery = ReturnType<typeof reportQuery>;
export const decimal = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v);
export const sumMoney = (v: Prisma.Decimal.Value[]) =>
  v.reduce<Prisma.Decimal>((n, x) => n.add(x), decimal()).toFixed(2);
export const businessDay = (date: Date) => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
function grouped<T, K extends string | number>(rows: T[], key: (row: T) => K) {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const items = groups.get(k) ?? [];
    items.push(row);
    groups.set(k, items);
  }
  return groups;
}
export function reportQuery(q: Record<string, string>, now = new Date()) {
  const allowed = [
    'year',
    'month',
    'ownerId',
    'deptId',
    'page',
    'pageSize',
    'source',
    'detail',
    'contractId',
    'bucket',
  ];
  if (Object.keys(q).some((k) => !allowed.includes(k))) throw new BadRequestException('存在未定义的报表参数');
  const integer = (key: string, fallback: number, min: number, max: number) => {
    if (q[key] === undefined) return fallback;
    if (typeof q[key] !== 'string' || !/^\d+$/.test(q[key])) throw new BadRequestException(`${key}必须为整数`);
    const n = Number(q[key]);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new BadRequestException(`${key}超出范围`);
    return n;
  };
  const year = integer('year', Number(businessDay(now).slice(0, 4)), 2000, 2100);
  const month = integer('month', 0, 0, 12);
  const source = q.source ?? 'managed';
  if (!['managed', 'legacy'].includes(source)) throw new BadRequestException('source只允许managed或legacy');
  const detail = q.detail ?? 'contracts';
  if (!['contracts', 'plans', 'receipts', 'balances', 'overdue'].includes(detail))
    throw new BadRequestException('detail无效');
  const bucket = q.bucket ?? 'open';
  if (!['open', 'won', 'lost', 'closed', 'undated'].includes(bucket)) throw new BadRequestException('bucket无效');
  return {
    year,
    month,
    ownerId: integer('ownerId', 0, 1, 2147483647),
    deptId: integer('deptId', 0, 1, 2147483647),
    contractId: integer('contractId', 0, 1, 2147483647),
    page: integer('page', 1, 1, 1000000),
    pageSize: integer('pageSize', 20, 1, 100),
    source,
    detail,
    bucket,
    start: new Date(Date.UTC(year, month ? month - 1 : 0, 1)),
    end: new Date(Date.UTC(year, month || 12, 1)),
    today: new Date(businessDay(now) + 'T00:00:00.000Z'),
  };
}
export function inPeriod(d: Date | null, q: ReportQuery) {
  return !!d && d >= q.start && d < q.end;
}
export function closedDay(d: Date | null) {
  return d ? new Date(businessDay(d) + 'T00:00:00.000Z') : null;
}
export function pageRows<T>(rows: T[], q: ReportQuery) {
  return {
    items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
    meta: { page: q.page, pageSize: q.pageSize, total: rows.length },
  };
}
export function forecastReport(
  rows: ForecastRow[],
  stages: { code: string; name: string; probability: number; isActive: boolean }[],
  q: ReportQuery,
) {
  const definitions = new Map(stages.map((s) => [s.code, s]));
  const open = rows.filter((r) => r.status === 'open' && inPeriod(r.expectedCloseDate, q));
  const won = rows.filter((r) => r.status === 'won' && inPeriod(closedDay(r.closedAt), q));
  const lost = rows.filter((r) => r.status === 'lost' && inPeriod(closedDay(r.closedAt), q));
  const weight = (r: ForecastRow) => {
    if (r.status !== 'open') return null;
    const s = definitions.get(r.stage);
    return s?.isActive && s.probability >= 0 && s.probability <= 100
      ? decimal(r.amount).mul(s.probability).div(100).toDecimalPlaces(2)
      : null;
  };
  const groups = [...new Set(open.map((r) => r.stage))].map((stage) => {
    const items = open.filter((r) => r.stage === stage);
    return {
      stage,
      name: definitions.get(stage)?.name ?? '未知阶段',
      count: items.length,
      amount: sumMoney(items.map((r) => r.amount)),
      weighted: sumMoney(
        items.flatMap((r) => {
          const w = weight(r);
          return w === null ? [] : [w];
        }),
      ),
      excluded: items.filter((r) => weight(r) === null).length,
    };
  });
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const items = open.filter((r) => r.expectedCloseDate?.getUTCMonth() === i);
    return {
      month: i + 1,
      amount: sumMoney(items.map((r) => r.amount)),
      weighted: sumMoney(
        items.flatMap((r) => {
          const w = weight(r);
          return w === null ? [] : [w];
        }),
      ),
      won: sumMoney(won.filter((r) => closedDay(r.closedAt)?.getUTCMonth() === i).map((r) => r.amount)),
    };
  });
  const owners = [...new Set([...open, ...won, ...lost].map((r) => r.ownerId))].map((ownerId) => ({
    ownerId,
    open: sumMoney(open.filter((r) => r.ownerId === ownerId).map((r) => r.amount)),
    weighted: sumMoney(
      open
        .filter((r) => r.ownerId === ownerId)
        .flatMap((r) => {
          const w = weight(r);
          return w === null ? [] : [w];
        }),
    ),
    won: sumMoney(won.filter((r) => r.ownerId === ownerId).map((r) => r.amount)),
    wonCount: won.filter((r) => r.ownerId === ownerId).length,
    lostCount: lost.filter((r) => r.ownerId === ownerId).length,
  }));
  return {
    summary: {
      openCount: open.length,
      open: sumMoney(open.map((r) => r.amount)),
      weighted: sumMoney(groups.map((r) => r.weighted)),
      won: sumMoney(won.map((r) => r.amount)),
      wonCount: won.length,
      lostCount: lost.length,
      winRate:
        won.length + lost.length
          ? decimal(won.length)
              .div(won.length + lost.length)
              .mul(100)
              .toFixed(1)
          : null,
      undatedCount: rows.filter((r) => r.status === 'open' && !r.expectedCloseDate).length,
      unknownClosedCount: rows.filter((r) => r.status !== 'open' && !r.closedAt).length,
      unweightedCount: groups.reduce((n, r) => n + r.excluded, 0),
    },
    stages: groups,
    monthly,
    owners,
    details: pageRows(
      (q.bucket === 'won'
        ? won
        : q.bucket === 'lost'
          ? lost
          : q.bucket === 'closed'
            ? [...won, ...lost]
            : q.bucket === 'undated'
              ? rows.filter((r) => r.status === 'open' && !r.expectedCloseDate)
              : open
      ).map((r) => ({
        ...r,
        amount: r.amount.toFixed(2),
        weighted: weight(r)?.toFixed(2) ?? null,
        stageName: definitions.get(r.stage)?.name ?? '未知阶段',
        risk:
          r.status !== 'open'
            ? ''
            : !r.nextAction
              ? '缺少下一步'
              : r.expectedCloseDate && r.expectedCloseDate < q.today
                ? '预计成交日已过'
                : '',
      })),
      q,
    ),
  };
}
export function collectionReport(contracts: ContractRow[], plans: PlanRow[], receipts: ReceiptRow[], q: ReportQuery) {
  const validPlans = plans.filter((p) => p.status !== 'cancelled');
  const confirmed = receipts.filter((r) => r.status === 'confirmed' && inPeriod(r.receiptDate, q));
  const due = validPlans.filter((p) => inPeriod(p.dueDate, q));
  const balancePlans = validPlans.filter((p) => decimal(p.outstandingAmount).gt(0));
  const overdue = balancePlans.filter((p) => p.dueDate && p.dueDate < q.today);
  const undated = validPlans.filter((p) => !p.dueDate);
  const monthly = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    planned: sumMoney(due.filter((p) => p.dueDate?.getUTCMonth() === i).map((p) => p.amount)),
    received: sumMoney(confirmed.filter((r) => r.receiptDate.getUTCMonth() === i).map((r) => r.amount)),
  }));
  const aging = [
    [0, 0, '未逾期'],
    [1, 30, '1—30天'],
    [31, 60, '31—60天'],
    [61, 90, '61—90天'],
    [91, Infinity, '90天以上'],
  ] as const;
  const buckets: { name: string; count: number; amount: string }[] = aging.map(([min, max, name]) => {
    const items = balancePlans.filter((p) => {
      if (!p.dueDate) return false;
      const days = Math.max(0, Math.floor((q.today.getTime() - p.dueDate.getTime()) / 86400000));
      return days >= min && days <= max;
    });
    return { name, count: items.length, amount: sumMoney(items.map((p) => p.outstandingAmount)) };
  });
  if (undated.length) buckets.push({ name: '日期待补', count: undated.filter(p => decimal(p.outstandingAmount).gt(0)).length,
    amount: sumMoney(undated.map(p => p.outstandingAmount)) });
  const contractPlans = grouped(validPlans, (p) => p.contractId);
  const contractReceipts = grouped(confirmed, (r) => r.contractId ?? 0);
  const matrix = contracts.map((c) => {
    const cp = contractPlans.get(c.id) ?? [],
      cr = contractReceipts.get(c.id) ?? [];
    return {
      id: c.id,
      contractNo: c.contractNo,
      name: c.name,
      ownerId: c.ownerId,
      amount: c.amount.toFixed(2),
      status: c.status,
      planned: sumMoney(cp.filter((p) => inPeriod(p.dueDate, q)).map((p) => p.amount)),
      received: sumMoney(cr.map((r) => r.amount)),
      currentOutstanding: sumMoney(cp.map((p) => p.outstandingAmount)),
      currentOverdue: sumMoney(cp.filter((p) => p.dueDate && p.dueDate < q.today).map((p) => p.outstandingAmount)),
      months: monthly.map((m) => ({
        month: m.month,
        planned: sumMoney(
          cp.filter((p) => inPeriod(p.dueDate, q) && p.dueDate!.getUTCMonth() + 1 === m.month).map((p) => p.amount),
        ),
        received: sumMoney(cr.filter((r) => r.receiptDate.getUTCMonth() + 1 === m.month).map((r) => r.amount)),
      })),
    };
  });
  return {
    summary: {
      planned: sumMoney(due.map((p) => p.amount)),
      received: sumMoney(confirmed.map((r) => r.amount)),
      receivedCount: confirmed.length,
      currentAllocatedOfReceipts: sumMoney(confirmed.map((r) => r.allocatedAmount)),
      currentUnallocatedOfReceipts: sumMoney(confirmed.map((r) => r.unallocatedAmount)),
      unboundReceived: sumMoney(confirmed.filter((r) => !r.contractId).map((r) => r.amount)),
      currentOutstanding: sumMoney(balancePlans.map((p) => p.outstandingAmount)),
      currentOverdue: sumMoney(overdue.map((p) => p.outstandingAmount)),
      undatedPlanCount: undated.length,
      undatedPlanned: sumMoney(undated.map(p => p.amount)),
      undatedOutstanding: sumMoney(undated.map(p => p.outstandingAmount)),
    },
    monthly,
    owners: [...new Set(matrix.map((r) => r.ownerId))].map((ownerId) => {
      const items = matrix.filter((r) => r.ownerId === ownerId);
      return {
        ownerId,
        planned: sumMoney(items.map((r) => r.planned)),
        received: sumMoney(items.map((r) => r.received)),
        currentOutstanding: sumMoney(items.map((r) => r.currentOutstanding)),
        currentOverdue: sumMoney(items.map((r) => r.currentOverdue)),
      };
    }),
    aging: buckets,
    balances: pageRows(balancePlans, q),
    overdue: pageRows(overdue, q),
    matrix: pageRows(matrix, q),
    receipts: pageRows(
      confirmed.map((r) => ({
        ...r,
        amount: r.amount.toFixed(2),
        allocatedAmount: r.allocatedAmount.toFixed(2),
        unallocatedAmount: r.unallocatedAmount.toFixed(2),
      })),
      q,
    ),
    plans: pageRows(
      validPlans
        .filter((p) => inPeriod(p.dueDate, q))
        .map((p) => ({
          ...p,
          amount: p.amount.toFixed(2),
          receivedAmount: p.receivedAmount.toFixed(2),
          outstandingAmount: p.outstandingAmount.toFixed(2),
        })),
      q,
    ),
  };
}
