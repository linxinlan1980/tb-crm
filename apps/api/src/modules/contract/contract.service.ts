import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../system/audit-logs/audit-log.service';
import { MilestoneService } from './milestone/milestone.service';

/**
 * 合同管理服务
 * 核心亮点：签约后按合同类型自动实例化里程碑→生成回款计划→触发项目立项
 * 参考文档：crm/02_功能需求PRD/05_合同管理模块PRD.md + crm/08_合同节点模板/
 * 状态机：draft→pending_approval→approved→signed→executing→completed/terminated/expired
 */
@Injectable()
export class ContractService {
  constructor(private prisma: PrismaService, private auditLog: AuditLogService, private milestoneService: MilestoneService) {}

  async findAll(tenantId: number, query: { page?: number; pageSize?: number; status?: string; contractType?: string; customerId?: number; ownerId?: number; keyword?: string; expiringDays?: number }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, status, contractType, customerId, ownerId, keyword, expiringDays } = query;
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (contractType) where.contractType = contractType;
    if (customerId) where.customerId = customerId;
    if (ownerId) where.ownerId = ownerId;
    if (keyword) where.OR = [{ name: { contains: keyword } }, { contractNo: { contains: keyword } }];
    if (expiringDays) {
      const deadline = new Date(); deadline.setDate(deadline.getDate() + expiringDays);
      where.endDate = { lte: deadline, gte: new Date() };
      where.status = { in: ['signed', 'executing'] };
    }

    const [items, total] = await Promise.all([
      db.contract.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, include: { customer: { select: { id: true, name: true } } } }),
      db.contract.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async findOne(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const contract = await db.contract.findFirst({
      where: { id, deletedAt: null },
      include: { customer: true, items: { orderBy: { sortOrder: 'asc' } }, milestones: { orderBy: { sortOrder: 'asc' } }, changes: { orderBy: { createdAt: 'desc' } }, orders: { select: { id: true, orderNo: true, status: true, totalAmountInclTax: true } }, paymentPlans: { orderBy: { dueDate: 'asc' } } },
    });
    if (!contract) throw new NotFoundException({ code: 5, message: '合同不存在' });
    return contract;
  }

  /** 创建合同（draft状态） */
  async create(tenantId: number, userId: number, data: any) {
    const db = this.prisma.forTenant(tenantId);
    const contractNo = await this.generateContractNo(db);

    // 计算税额
    const amount = Number(data.amount || 0);
    const taxRate = Number(data.taxRate || 13);
    const amountExclTax = Number((amount / (1 + taxRate / 100)).toFixed(2));
    const taxAmount = Number((amount - amountExclTax).toFixed(2));

    const contract = await db.contract.create({
      data: {
        tenantId, contractNo, name: data.name, customerId: data.customerId,
        opportunityId: data.opportunityId, partnerId: data.partnerId,
        contractType: data.contractType, templateId: data.templateId,
        amount, amountExclTax, taxRate, taxAmount,
        currency: data.currency || 'CNY', discountRate: data.discountRate,
        startDate: data.startDate, endDate: data.endDate, durationMonths: data.durationMonths,
        paymentTerms: data.paymentTerms, milestoneTemplateId: data.milestoneTemplateId,
        ownerId: data.ownerId || userId, status: 'draft', remark: data.remark,
        createdBy: userId, updatedBy: userId,
      },
    });

    // 创建合同明细
    if (data.items?.length) {
      await db.contractItem.createMany({
        data: data.items.map((item: any, idx: number) => ({
          tenantId, contractId: contract.id, sortOrder: idx + 1,
          productId: item.productId, itemName: item.itemName, itemType: item.itemType || 'service',
          specification: item.specification, quantity: item.quantity || 1, unit: item.unit,
          unitPrice: item.unitPrice || 0, listPrice: item.listPrice, discountRate: item.discountRate,
          amount: item.amount || (item.quantity || 1) * (item.unitPrice || 0),
          taxRate: item.taxRate || taxRate, serviceYears: item.serviceYears, manDays: item.manDays,
          remark: item.remark,
        })),
      });
    }

    await this.auditLog.log({ tenantId, userId, action: 'create', objectType: 'contract', objectId: contract.id, objectNo: contractNo });
    return contract;
  }

  /**
   * 确认签约（核心联动触发点）
   * 签约后自动：实例化里程碑 → 生成回款计划 → 触发项目立项 → 商机推进 → 客户标记交易
   */
  async sign(tenantId: number, userId: number, id: number, data: { signDate: string; signedByCustomer?: string; signedByUs?: string; sealType?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const contract = await db.contract.findFirst({ where: { id, deletedAt: null } });
    if (!contract) throw new NotFoundException({ code: 5, message: '合同不存在' });
    if (contract.status !== 'approved') {
      throw new BadRequestException({ code: 6004, message: '只有审批通过的合同可签约' });
    }

    // 更新合同状态
    const updated = await db.contract.update({
      where: { id },
      data: { status: 'signed', signDate: new Date(data.signDate), signedByCustomer: data.signedByCustomer, signedByUs: data.signedByUs, sealType: data.sealType as any, updatedBy: userId },
    });

    // ===== 核心联动链 =====
    // 1. 实例化里程碑
    const milestones = await this.milestoneService.instantiate(tenantId, contract.id, contract.contractType, contract.milestoneTemplateId, new Date(data.signDate), Number(contract.amount));

    // 2. 生成回款计划（从有金额的里程碑）
    const paymentMilestones = milestones.filter((m) => m.amount && Number(m.amount) > 0);
    for (const ms of paymentMilestones) {
      const planNo = await this.generatePaymentPlanNo(db);
      const dueDate = ms.paymentTrigger === 'after_days'
        ? new Date(new Date(ms.plannedDate).getTime() + ms.paymentDaysAfter * 86400000)
        : ms.plannedDate;
      await db.paymentPlan.create({
        data: { tenantId, contractId: contract.id, milestoneId: ms.id, planNo, amount: ms.amount!, ratio: ms.amountRatio, dueDate, triggerCondition: ms.deliverables || ms.name, status: 'pending', receivedAmount: 0, outstandingAmount: ms.amount!, invoiceRequired: true },
      });
    }

    // 3. 商机推进到签约/交付阶段
    if (contract.opportunityId) {
      await db.opportunity.update({ where: { id: contract.opportunityId }, data: { stage: 'signing', status: 'won', winDate: new Date(), contractId: contract.id, stageEnteredAt: new Date() } });
    }

    // 4. 客户标记为交易客户
    await db.customer.update({ where: { id: contract.customerId }, data: { isTrading: true, isProspect: false } });

    // 5. 更新客户统计
    await this.recalcCustomerStats(db, contract.customerId);

    await this.auditLog.log({ tenantId, userId, action: 'sign', objectType: 'contract', objectId: id, objectNo: contract.contractNo, afterData: { signDate: data.signDate, milestonesCreated: milestones.length, paymentPlansCreated: paymentMilestones.length } });

    return { ...updated, milestonesCreated: milestones.length, paymentPlansCreated: paymentMilestones.length, message: `合同已签约，${milestones.length}个里程碑和${paymentMilestones.length}个回款计划已自动生成` };
  }

  /** 合同终止 */
  async terminate(tenantId: number, userId: number, id: number, reason: string) {
    const db = this.prisma.forTenant(tenantId);
    const contract = await db.contract.findFirst({ where: { id, deletedAt: null } });
    if (!contract) throw new NotFoundException({ code: 5, message: '合同不存在' });
    if (!['signed', 'executing'].includes(contract.status)) throw new BadRequestException({ code: 6005, message: '只有执行中的合同可终止' });

    await db.contract.update({ where: { id }, data: { status: 'terminated', updatedBy: userId } });
    // 未完成里程碑→cancelled
    await db.contractMilestone.updateMany({ where: { contractId: id, status: { in: ['pending', 'in_progress', 'delayed'] } }, data: { status: 'cancelled' } });
    // 未回款计划→cancelled
    await db.paymentPlan.updateMany({ where: { contractId: id, status: { in: ['pending', 'partial', 'overdue'] } }, data: { status: 'cancelled' } });
    // 记录变更
    await db.contractChange.create({ data: { tenantId, contractId: id, changeType: 'terminate', beforeValue: JSON.stringify({ status: contract.status }), afterValue: JSON.stringify({ status: 'terminated' }), reason, status: 'approved', requestedBy: userId, approvedBy: userId, approvedAt: new Date() } });

    await this.auditLog.log({ tenantId, userId, action: 'terminate', objectType: 'contract', objectId: id, objectNo: contract.contractNo, afterData: { reason } });
    return { message: '合同已终止，未完成里程碑和回款计划已取消' };
  }

  /** 到期续签提醒（由Cron调用） */
  async checkExpiring(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const now = new Date();
    const d90 = new Date(); d90.setDate(d90.getDate() + 90);
    const expiring = await db.contract.findMany({ where: { endDate: { gte: now, lte: d90 }, status: { in: ['signed', 'executing'] }, deletedAt: null } });
    // TODO S5: 按90/60/30天分级通知 + 30天时自动创建续约商机
    return { count: expiring.length, contracts: expiring.map((c) => ({ id: c.id, name: c.name, endDate: c.endDate, daysRemaining: Math.ceil((c.endDate!.getTime() - now.getTime()) / 86400000) })) };
  }

  private async recalcCustomerStats(db: any, customerId: number) {
    const [count, sum] = await Promise.all([
      db.contract.count({ where: { customerId, status: { notIn: ['draft', 'rejected', 'cancelled'] }, deletedAt: null } }),
      db.contract.aggregate({ where: { customerId, status: { notIn: ['draft', 'rejected', 'cancelled'] }, deletedAt: null }, _sum: { amount: true } }),
    ]);
    await db.customer.update({ where: { id: customerId }, data: { contractCount: count, contractAmount: sum._sum.amount || 0 } });
  }

  private async generateContractNo(db: any): Promise<string> {
    const now = new Date();
    const prefix = `HT${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const last = await db.contract.findFirst({ where: { contractNo: { startsWith: prefix } }, orderBy: { contractNo: 'desc' }, select: { contractNo: true } });
    const seq = last ? parseInt(last.contractNo.slice(-3)) + 1 : 1;
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }

  private async generatePaymentPlanNo(db: any): Promise<string> {
    const now = new Date();
    const prefix = `HK${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const last = await db.paymentPlan.findFirst({ where: { planNo: { startsWith: prefix } }, orderBy: { planNo: 'desc' }, select: { planNo: true } });
    const seq = last ? parseInt(last.planNo.slice(-3)) + 1 : 1;
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }
}
