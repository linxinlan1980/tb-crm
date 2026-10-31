import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

/**
 * 账龄分析服务
 * 四桶：未到期 / 1-30天 / 31-60天 / 60天以上
 * 参考：GML模块21 §4.5 账龄与对账
 */
@Injectable()
export class AgingService {
  constructor(private prisma: PrismaService) {}

  /** 账龄汇总（四桶） */
  async getSummary(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const plans = await db.paymentPlan.findMany({
      where: { status: { in: ['pending', 'partial', 'overdue'] } },
      select: { id: true, amount: true, receivedAmount: true, outstandingAmount: true, dueDate: true, contractId: true,
        contract: { select: { customerId: true, customer: { select: { id: true, name: true } } } } },
    });

    const now = new Date();
    const buckets = { notDue: { amount: 0, count: 0 }, d1_30: { amount: 0, count: 0 }, d31_60: { amount: 0, count: 0 }, d60plus: { amount: 0, count: 0 } };

    for (const p of plans) {
      const outstanding = Number(p.outstandingAmount);
      if (outstanding <= 0) continue;
      const overdueDays = Math.floor((now.getTime() - new Date(p.dueDate).getTime()) / 86400000);
      if (overdueDays <= 0) { buckets.notDue.amount += outstanding; buckets.notDue.count++; }
      else if (overdueDays <= 30) { buckets.d1_30.amount += outstanding; buckets.d1_30.count++; }
      else if (overdueDays <= 60) { buckets.d31_60.amount += outstanding; buckets.d31_60.count++; }
      else { buckets.d60plus.amount += outstanding; buckets.d60plus.count++; }
    }

    const total = buckets.notDue.amount + buckets.d1_30.amount + buckets.d31_60.amount + buckets.d60plus.amount;
    return {
      totalOutstanding: total,
      buckets: [
        { bucket: 'not_due', label: '未到期', ...buckets.notDue, percent: total ? +(buckets.notDue.amount / total * 100).toFixed(1) : 0 },
        { bucket: 'd1_30', label: '1-30天', ...buckets.d1_30, percent: total ? +(buckets.d1_30.amount / total * 100).toFixed(1) : 0 },
        { bucket: 'd31_60', label: '31-60天', ...buckets.d31_60, percent: total ? +(buckets.d31_60.amount / total * 100).toFixed(1) : 0 },
        { bucket: 'd60_plus', label: '60天以上', ...buckets.d60plus, percent: total ? +(buckets.d60plus.amount / total * 100).toFixed(1) : 0 },
      ],
    };
  }

  /** 客户级账龄榜（风险排序） */
  async getBySubject(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const plans = await db.paymentPlan.findMany({ where: { status: { in: ['pending', 'partial', 'overdue'] } }, include: { contract: { include: { customer: { select: { id: true, name: true } } } } } });

    const now = new Date();
    const customerMap = new Map<number, { customerId: number; customerName: string; outstanding: number; maxOverdueDays: number; planCount: number }>();

    for (const p of plans) {
      const cid = p.contract?.customerId;
      if (!cid) continue;
      const outstanding = Number(p.outstandingAmount);
      if (outstanding <= 0) continue;
      const overdueDays = Math.max(0, Math.floor((now.getTime() - new Date(p.dueDate).getTime()) / 86400000));

      if (!customerMap.has(cid)) customerMap.set(cid, { customerId: cid, customerName: p.contract?.customer?.name || '', outstanding: 0, maxOverdueDays: 0, planCount: 0 });
      const entry = customerMap.get(cid)!;
      entry.outstanding += outstanding;
      entry.maxOverdueDays = Math.max(entry.maxOverdueDays, overdueDays);
      entry.planCount++;
    }

    return [...customerMap.values()]
      .map((c) => ({ ...c, riskLevel: c.maxOverdueDays > 60 ? 'high' : c.maxOverdueDays > 30 ? 'medium' : 'low' }))
      .sort((a, b) => b.outstanding - a.outstanding);
  }

  /** 逐笔账龄明细 */
  async getDetail(tenantId: number, query: { bucket?: string; customerId?: number; keyword?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const plans = await db.paymentPlan.findMany({ where: { status: { in: ['pending', 'partial', 'overdue'] } }, include: { contract: { include: { customer: { select: { id: true, name: true } } } } }, orderBy: { dueDate: 'asc' } });

    const now = new Date();
    let details = plans.map((p) => {
      const overdueDays = Math.max(0, Math.floor((now.getTime() - new Date(p.dueDate).getTime()) / 86400000));
      const bucket = overdueDays === 0 ? 'not_due' : overdueDays <= 30 ? 'd1_30' : overdueDays <= 60 ? 'd31_60' : 'd60_plus';
      return { id: p.id, planNo: p.planNo, customerName: p.contract?.customer?.name, contractNo: p.contract?.contractNo, amount: p.amount, receivedAmount: p.receivedAmount, outstandingAmount: p.outstandingAmount, dueDate: p.dueDate, overdueDays, bucket, status: p.status };
    });

    if (query.bucket) details = details.filter((d) => d.bucket === query.bucket);
    if (query.customerId) details = details.filter((d) => d.planNo && plans.find((p) => p.id === d.id)?.contract?.customerId === query.customerId);
    return details;
  }
}
