import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../system/audit-logs/audit-log.service';

/**
 * 订单管理服务
 * 合同→订单→审批→信用校验→确认→交付→完成
 * 信用控制一期简化：额度=合同总额×1.2，已用=SUM(未回款confirmed订单)
 * 参考：crm/02_功能需求PRD/06_订单管理模块PRD.md + GML模块08A
 */
@Injectable()
export class OrderService {
  constructor(private prisma: PrismaService, private auditLog: AuditLogService) {}

  async findAll(tenantId: number, query: { page?: number; pageSize?: number; contractId?: number; customerId?: number; status?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, contractId, customerId, status } = query;
    const where: any = { deletedAt: null };
    if (contractId) where.contractId = contractId;
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      db.order.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, include: { contract: { select: { contractNo: true, name: true, amount: true } }, customer: { select: { id: true, name: true } } } }),
      db.order.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async findOne(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const order = await db.order.findFirst({ where: { id, deletedAt: null }, include: { items: { orderBy: { sortOrder: 'asc' } }, deliveries: { orderBy: { createdAt: 'desc' } }, contract: true, customer: true } });
    if (!order) throw new NotFoundException({ code: 5, message: '订单不存在' });
    return order;
  }

  async create(tenantId: number, userId: number, data: any) {
    const db = this.prisma.forTenant(tenantId);
    // 校验合同状态
    const contract = await db.contract.findFirst({ where: { id: data.contractId } });
    if (!contract) throw new BadRequestException({ code: 7007, message: '关联合同不存在' });
    if (!['signed', 'executing'].includes(contract.status)) throw new BadRequestException({ code: 7007, message: '关联合同未签约，不可创建订单' });

    // 校验订单累计不超合同金额
    const existingOrders = await db.order.aggregate({ where: { contractId: data.contractId, status: { notIn: ['cancelled', 'draft'] }, deletedAt: null }, _sum: { totalAmountInclTax: true } });
    const newTotal = Number(existingOrders._sum.totalAmountInclTax || 0) + Number(data.totalAmountInclTax || 0);
    if (newTotal > Number(contract.amount) * 1.01) {
      throw new BadRequestException({ code: 7001, message: `订单累计金额（${newTotal}）超过合同金额（${contract.amount}），请先变更合同` });
    }

    const orderNo = await this.generateNo(db);
    const order = await db.order.create({
      data: { tenantId, orderNo, contractId: data.contractId, customerId: contract.customerId, opportunityId: contract.opportunityId, orderType: data.orderType || 'standard', status: 'draft', totalAmount: data.totalAmount || 0, totalTax: data.totalTax || 0, totalAmountInclTax: data.totalAmountInclTax || data.totalAmount || 0, discountRate: data.discountRate, orderDate: data.orderDate || new Date(), expectedDeliveryDate: data.expectedDeliveryDate, deliveryMethod: data.deliveryMethod, ownerId: data.ownerId || userId, remark: data.remark, createdBy: userId },
    });

    if (data.items?.length) {
      await db.orderItem.createMany({ data: data.items.map((item: any, idx: number) => ({ tenantId, orderId: order.id, sortOrder: idx + 1, productId: item.productId, itemName: item.itemName, itemType: item.itemType || 'service', specification: item.specification, quantity: item.quantity || 1, unit: item.unit, unitPrice: item.unitPrice || 0, listPrice: item.listPrice, discountRate: item.discountRate, amount: item.amount || (item.quantity || 1) * (item.unitPrice || 0), taxRate: item.taxRate || 13, taxAmount: item.taxAmount || 0, priceSource: item.priceSource || 'list', manualAdjusted: item.manualAdjusted || false })) });
    }

    await this.auditLog.log({ tenantId, userId, action: 'create', objectType: 'order', objectId: order.id, objectNo: orderNo });
    return order;
  }

  /**
   * 确认订单（含信用校验）
   * 信用额度 = 合同总额 × 1.2
   * 已用 = SUM(该客户所有confirmed/shipping/delivered订单) + SUM(未核销应收)
   */
  async confirm(tenantId: number, userId: number, id: number, overrideReason?: string) {
    const db = this.prisma.forTenant(tenantId);
    const order = await db.order.findFirst({ where: { id, deletedAt: null } });
    if (!order) throw new NotFoundException({ code: 5, message: '订单不存在' });
    if (order.status !== 'approved') throw new BadRequestException({ code: 7005, message: '只有审批通过的订单可确认' });

    // 信用校验
    const creditCheck = await this.checkCredit(db, tenantId, order.customerId, Number(order.totalAmountInclTax), order.contractId);
    if (creditCheck.result === 'blocked' && !overrideReason) {
      throw new BadRequestException({ code: 7002, message: `信用额度不足（可用${creditCheck.available}，本单${creditCheck.amount}），需特批放行`, data: creditCheck });
    }

    const finalResult = creditCheck.result === 'blocked' && overrideReason ? 'override' : creditCheck.result;

    // 记录信用校验日志
    await db.creditCheckLog.create({ data: { tenantId, customerId: order.customerId, orderId: id, docType: 'order', docNo: order.orderNo, amount: creditCheck.amount, creditLimit: creditCheck.limit, usedBefore: creditCheck.used, available: creditCheck.available, exceedAmount: creditCheck.exceed, result: finalResult as any, overrideReason, operatorId: userId } });

    // 更新订单状态
    const updated = await db.order.update({ where: { id }, data: { status: 'confirmed', creditCheckResult: finalResult as any, creditOverrideReason: overrideReason } });

    await this.auditLog.log({ tenantId, userId, action: 'confirm', objectType: 'order', objectId: id, objectNo: order.orderNo, afterData: { creditResult: finalResult } });
    return { ...updated, creditCheck: { ...creditCheck, result: finalResult } };
  }

  /** 信用预检（不执行确认，仅返回校验结果） */
  async creditCheck(tenantId: number, customerId: number, amount: number, contractId?: number) {
    const db = this.prisma.forTenant(tenantId);
    return this.checkCredit(db, tenantId, customerId, amount, contractId);
  }

  private async checkCredit(db: any, tenantId: number, customerId: number, amount: number, contractId?: number) {
    // 信用额度 = 关联合同总额 × 1.2（一期简化）
    const contracts = await db.contract.aggregate({ where: { customerId, status: { in: ['signed', 'executing'] }, deletedAt: null }, _sum: { amount: true } });
    const limit = Number(contracts._sum.amount || 0) * 1.2;

    // 已用 = 所有confirmed/shipping/delivered订单金额 + 未核销应收
    const usedOrders = await db.order.aggregate({ where: { customerId, status: { in: ['confirmed', 'shipping', 'delivered'] }, deletedAt: null }, _sum: { totalAmountInclTax: true } });
    const usedPlans = await db.paymentPlan.aggregate({ where: { contract: { customerId }, status: { in: ['pending', 'partial', 'overdue'] } }, _sum: { outstandingAmount: true } });
    const used = Number(usedOrders._sum.totalAmountInclTax || 0);
    // 注：一期简化不重复计算plans（plans是orders的下游）

    const available = Math.max(0, limit - used);
    const exceed = amount > available ? amount - available : 0;
    const result = amount <= available ? 'pass' : 'blocked';

    return { limit, used, available, amount, exceed, result };
  }

  private async generateNo(db: any): Promise<string> {
    const now = new Date();
    const prefix = `DD${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const last = await db.order.findFirst({ where: { orderNo: { startsWith: prefix } }, orderBy: { orderNo: 'desc' }, select: { orderNo: true } });
    const seq = last ? parseInt(last.orderNo.slice(-3)) + 1 : 1;
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }
}
