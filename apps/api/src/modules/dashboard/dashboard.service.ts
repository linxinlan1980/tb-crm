import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * 经营仪表盘服务
 * 聚合全模块数据，提供KPI/漏斗/预测/健康度/项目交付统计
 * 参考文档：crm/02_功能需求PRD/00_UI页面设计规范.md PG-036
 */
@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  /** 首页概览KPI */
  async getOverview(tenantId: number, userId: number) {
    const db = this.prisma.forTenant(tenantId);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [customerCount, openOpps, oppAmount, monthContracts, monthContractAmount, monthReceived, overdueAmount, activeProjects, myPrivateCount] = await Promise.all([
      db.customer.count({ where: { deletedAt: null, status: 'active' } }),
      db.opportunity.count({ where: { status: 'open', deletedAt: null } }),
      db.opportunity.aggregate({ where: { status: 'open', deletedAt: null }, _sum: { amount: true, weightedAmount: true } }),
      db.contract.count({ where: { signDate: { gte: monthStart }, status: { notIn: ['draft', 'rejected'] }, deletedAt: null } }),
      db.contract.aggregate({ where: { signDate: { gte: monthStart }, status: { notIn: ['draft', 'rejected'] }, deletedAt: null }, _sum: { amount: true } }),
      db.receipt.aggregate({ where: { status: 'confirmed', receiptDate: { gte: monthStart } }, _sum: { amount: true } }),
      db.paymentPlan.aggregate({ where: { status: 'overdue' }, _sum: { outstandingAmount: true } }),
      db.project.count({ where: { status: 'active', deletedAt: null } }),
      db.privateHolding.count({ where: { userId } }),
    ]);

    return {
      customers: customerCount,
      myPrivateCustomers: myPrivateCount,
      openOpportunities: openOpps,
      pipelineAmount: Number(oppAmount._sum.amount || 0),
      weightedPipeline: Number(oppAmount._sum.weightedAmount || 0),
      monthSignedContracts: monthContracts,
      monthSignedAmount: Number(monthContractAmount._sum.amount || 0),
      monthReceived: Number(monthReceived._sum.amount || 0),
      overdueAmount: Number(overdueAmount._sum.outstandingAmount || 0),
      activeProjects,
    };
  }

  /** 销售漏斗（按阶段分组） */
  async getFunnel(tenantId: number, ownerId?: number) {
    const db = this.prisma.forTenant(tenantId);
    const where: any = { status: 'open', deletedAt: null };
    if (ownerId) where.ownerId = ownerId;

    const stages = await db.opportunityStage.findMany({ where: { tenantId, isActive: true }, orderBy: { sortOrder: 'asc' } });
    const opps = await db.opportunity.findMany({ where, select: { stage: true, amount: true, weightedAmount: true, id: true } });

    return stages.map((s) => {
      const stageOpps = opps.filter((o) => o.stage === s.code);
      return { stage: s.code, name: s.name, color: s.color, probability: s.probability, count: stageOpps.length, amount: stageOpps.reduce((sum, o) => sum + Number(o.amount), 0), weightedAmount: stageOpps.reduce((sum, o) => sum + Number(o.weightedAmount), 0) };
    });
  }

  /** 回款预测（月度） */
  async getRevenueForecast(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const now = new Date();
    const months: any[] = [];

    for (let i = 0; i < 6; i++) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + i + 1, 0, 23, 59, 59);

      // 已确认：该月到期的回款计划（未收部分）
      const confirmed = await db.paymentPlan.aggregate({ where: { dueDate: { gte: monthStart, lte: monthEnd }, status: { in: ['pending', 'partial', 'overdue'] } }, _sum: { outstandingAmount: true } });

      // 管道：该月预计成交的商机加权金额
      const pipeline = await db.opportunity.aggregate({ where: { expectedCloseDate: { gte: monthStart, lte: monthEnd }, status: 'open', stage: { in: ['negotiation', 'signing'] } }, _sum: { weightedAmount: true } });

      months.push({
        month: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`,
        confirmed: Number(confirmed._sum.outstandingAmount || 0),
        pipeline: Number(pipeline._sum.weightedAmount || 0),
        total: Number(confirmed._sum.outstandingAmount || 0) + Number(pipeline._sum.weightedAmount || 0),
      });
    }
    return months;
  }

  /** 客户健康度分布 */
  async getCustomerHealth(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const customers = await db.customer.findMany({ where: { deletedAt: null, status: 'active', poolType: 'private' }, select: { id: true, lastFollowAt: true, contractAmount: true } });
    const now = new Date();

    let active = 0, silent = 0, atRisk = 0;
    for (const c of customers) {
      const daysSinceFollow = c.lastFollowAt ? Math.floor((now.getTime() - c.lastFollowAt.getTime()) / 86400000) : 999;
      if (daysSinceFollow <= 14) active++;
      else if (daysSinceFollow <= 45) silent++;
      else atRisk++;
    }
    return { total: customers.length, active, silent, atRisk };
  }

  /** 项目交付统计 */
  async getProjectStats(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const [total, active, delayed, completed, avgMargin] = await Promise.all([
      db.project.count({ where: { deletedAt: null } }),
      db.project.count({ where: { status: 'active', deletedAt: null } }),
      db.project.count({ where: { healthStatus: 'red', status: 'active', deletedAt: null } }),
      db.project.count({ where: { status: 'completed', deletedAt: null } }),
      db.project.aggregate({ where: { status: 'completed', deletedAt: null, grossMargin: { not: null } }, _avg: { grossMargin: true } }),
    ]);
    return { total, active, delayed, completed, avgMargin: Number(avgMargin._avg.grossMargin || 0).toFixed(1) };
  }
}
