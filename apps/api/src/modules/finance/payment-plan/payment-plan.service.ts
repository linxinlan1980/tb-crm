import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class PaymentPlanService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: number, query: { page?: number; pageSize?: number; contractId?: number; customerId?: number; status?: string; overdueOnly?: boolean; dueBefore?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, contractId, customerId, status, overdueOnly, dueBefore } = query;
    const where: any = {};
    if (contractId) where.contractId = contractId;
    if (customerId) where.contract = { customerId };
    if (status) where.status = status;
    if (overdueOnly) where.status = { in: ['overdue', 'pending', 'partial'] };
    if (dueBefore) where.dueDate = { lte: new Date(dueBefore) };

    const [items, total] = await Promise.all([
      db.paymentPlan.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { dueDate: 'asc' }, include: { contract: { select: { id: true, contractNo: true, name: true, customerId: true, customer: { select: { id: true, name: true } } } } } }),
      db.paymentPlan.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async findOne(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    return db.paymentPlan.findFirst({ where: { id }, include: { contract: { include: { customer: true } }, allocations: { include: { receipt: { select: { id: true, receiptNo: true, receiptDate: true, status: true } } } } } });
  }

  /** 财务总览 */
  async getOverview(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const [totalPlan, totalReceived, overdueCount, overdueAmount] = await Promise.all([
      db.paymentPlan.aggregate({ where: { status: { not: 'cancelled' } }, _sum: { amount: true } }),
      db.paymentPlan.aggregate({ where: { status: { not: 'cancelled' } }, _sum: { receivedAmount: true } }),
      db.paymentPlan.count({ where: { status: 'overdue' } }),
      db.paymentPlan.aggregate({ where: { status: 'overdue' }, _sum: { outstandingAmount: true } }),
    ]);
    return { totalPlanAmount: totalPlan._sum.amount || 0, totalReceived: totalReceived._sum.receivedAmount || 0, totalOutstanding: Number(totalPlan._sum.amount || 0) - Number(totalReceived._sum.receivedAmount || 0), overdueCount, overdueAmount: overdueAmount._sum.outstandingAmount || 0 };
  }
}
