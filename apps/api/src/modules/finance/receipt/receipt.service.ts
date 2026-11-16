import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AuditLogService } from '../../system/audit-logs/audit-log.service';

/**
 * 收款核销引擎 — 复用GML模块21的三条硬口径：
 * 1. 已收金额永远由核销明细SUM算出，不累加
 * 2. 核销生效点 = 收款单确认（draft不生效）
 * 3. 单据金额必须能由明细重算出来（审计自洽）
 *
 * 参考：internal-reference/gml/GML模块21_应收与收款核销_详细设计_v1.md
 */
@Injectable()
export class ReceiptService {
  constructor(private prisma: PrismaService, private auditLog: AuditLogService) {}

  /** 创建收款单（草稿） */
  async create(tenantId: number, userId: number, data: { customerId: number; contractId?: number; amount: number; receiptDate: string; method: string; serialNo?: string; payerName?: string; bankAccount?: string; allocations?: { paymentPlanId: number; amount: number }[] }) {
    const db = this.prisma.forTenant(tenantId);
    const receiptNo = await this.generateNo(db, 'SK');

    const receipt = await db.receipt.create({
      data: { tenantId, receiptNo, customerId: data.customerId, contractId: data.contractId, amount: data.amount, receiptDate: new Date(data.receiptDate), method: data.method as any, serialNo: data.serialNo, payerName: data.payerName, bankAccount: data.bankAccount, status: 'draft', allocatedAmount: 0, unallocatedAmount: data.amount, createdBy: userId },
    });

    // 如果有预分配计划（草稿状态，不生效）
    if (data.allocations?.length) {
      await db.receiptAllocation.createMany({ data: data.allocations.map((a) => ({ tenantId, receiptId: receipt.id, paymentPlanId: a.paymentPlanId, amount: a.amount, allocatedBy: userId })) });
    }

    return receipt;
  }

  /**
   * 确认收款（唯一有后果的动作）
   * 事务内一次完成：
   * 1. 状态 draft→confirmed
   * 2. 核销明细生效（如无预分配则FIFO自动摊）
   * 3. 重算所有关联payment_plan的received_amount（=核销明细SUM）
   * 4. 重算contract.total_received
   * 5. 释放信用占用（一期简化：不独立管理信用账户）
   */
  async confirm(tenantId: number, userId: number, receiptId: number) {
    const db = this.prisma.forTenant(tenantId);
    const receipt = await db.receipt.findFirst({ where: { id: receiptId, status: 'draft' } });
    if (!receipt) throw new BadRequestException({ code: 9004, message: '收款单不存在或已确认' });

    // 获取核销明细
    let allocations = await db.receiptAllocation.findMany({ where: { receiptId } });

    // 如果无预分配，执行FIFO自动摊
    if (!allocations.length) {
      allocations = await this.fifoAllocate(db, tenantId, receiptId, receipt.customerId, Number(receipt.amount), userId);
    }

    // 校验核销总额不超过收款金额
    const totalAllocated = allocations.reduce((sum, a) => sum + Number(a.amount), 0);
    if (totalAllocated > Number(receipt.amount) + 0.01) {
      throw new BadRequestException({ code: 9001, message: `核销金额（${totalAllocated}）超过收款金额（${receipt.amount}）` });
    }

    // 事务：确认 + 重算
    await this.prisma.$transaction(async (tx) => {
      // 1. 更新收款单状态
      await tx.receipt.update({ where: { id: receiptId }, data: { status: 'confirmed', confirmedBy: userId, confirmedAt: new Date(), allocatedAmount: totalAllocated, unallocatedAmount: Number(receipt.amount) - totalAllocated } });

      // 2. 重算每个关联payment_plan的received_amount（硬口径1：由核销明细SUM算出）
      const affectedPlanIds = [...new Set(allocations.map((a) => a.paymentPlanId))];
      for (const planId of affectedPlanIds) {
        await this.recalcPaymentPlan(tx, planId);
      }

      // 3. 重算合同total_received
      if (receipt.contractId) {
        await this.recalcContract(tx, receipt.contractId);
      } else {
        // 从plan反查contract
        const plans = await tx.paymentPlan.findMany({ where: { id: { in: affectedPlanIds } }, select: { contractId: true } });
        const contractIds = [...new Set(plans.map((p) => p.contractId))];
        for (const cid of contractIds) {
          await this.recalcContract(tx, cid);
        }
      }
    });

    await this.auditLog.log({ tenantId, userId, action: 'confirm_receipt', objectType: 'receipt', objectId: receiptId, objectNo: receipt.receiptNo, afterData: { amount: receipt.amount, allocated: totalAllocated } });

    return { id: receiptId, status: 'confirmed', allocatedAmount: totalAllocated, unallocatedAmount: Number(receipt.amount) - totalAllocated, message: '收款已确认，核销生效' };
  }

  /**
   * 作废收款
   * 核销明细失效 → 重算plan → 重算contract
   * 不自动回收已释放的信用（作废是会计事件）
   */
  async void(tenantId: number, userId: number, receiptId: number, reason: string) {
    const db = this.prisma.forTenant(tenantId);
    const receipt = await db.receipt.findFirst({ where: { id: receiptId, status: 'confirmed' } });
    if (!receipt) throw new BadRequestException({ code: 9005, message: '收款单不存在或未确认' });
    if (!reason?.trim()) throw new BadRequestException({ code: 9005, message: '作废收款必须填写原因' });

    const allocations = await db.receiptAllocation.findMany({ where: { receiptId } });
    const affectedPlanIds = [...new Set(allocations.map((a) => a.paymentPlanId))];

    await this.prisma.$transaction(async (tx) => {
      await tx.receipt.update({ where: { id: receiptId }, data: { status: 'voided', voidReason: reason, voidedAt: new Date(), allocatedAmount: 0, unallocatedAmount: Number(receipt.amount) } });
      // 删除核销明细（使其失效）
      await tx.receiptAllocation.deleteMany({ where: { receiptId } });
      // 重算受影响的plan和contract
      for (const planId of affectedPlanIds) { await this.recalcPaymentPlan(tx, planId); }
      const plans = await tx.paymentPlan.findMany({ where: { id: { in: affectedPlanIds } }, select: { contractId: true } });
      for (const cid of [...new Set(plans.map((p) => p.contractId))]) { await this.recalcContract(tx, cid); }
    });

    return { id: receiptId, status: 'voided', message: '收款已作废，核销已回退' };
  }

  /** 审计自洽检查：received_amount == SUM(allocations) */
  async audit(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const plans = await db.paymentPlan.findMany({ where: { status: { not: 'cancelled' } } });
    const issues: any[] = [];
    for (const plan of plans) {
      const allocSum = await db.receiptAllocation.aggregate({ where: { paymentPlanId: plan.id, receipt: { status: 'confirmed' } }, _sum: { amount: true } });
      const expected = Number(allocSum._sum.amount || 0);
      const actual = Number(plan.receivedAmount);
      if (Math.abs(expected - actual) > 0.01) {
        issues.push({ planId: plan.id, planNo: plan.planNo, expected, actual, drift: actual - expected });
      }
    }
    return { passed: issues.length === 0, checked: plans.length, issues };
  }

  // ===== Private =====

  /** FIFO自动摊：按due_date升序抵扣未结清的payment_plan */
  private async fifoAllocate(db: any, tenantId: number, receiptId: number, customerId: number, amount: number, userId: number) {
    const openPlans = await db.paymentPlan.findMany({
      where: { contract: { customerId }, status: { in: ['pending', 'partial', 'overdue'] } },
      orderBy: { dueDate: 'asc' },
    });

    let remaining = amount;
    const allocations: any[] = [];

    for (const plan of openPlans) {
      if (remaining <= 0) break;
      const outstanding = Number(plan.amount) - Number(plan.receivedAmount);
      if (outstanding <= 0) continue;
      const allocateAmount = Math.min(remaining, outstanding);
      const alloc = await db.receiptAllocation.create({ data: { tenantId, receiptId, paymentPlanId: plan.id, amount: allocateAmount, allocatedBy: userId } });
      allocations.push(alloc);
      remaining -= allocateAmount;
    }

    return allocations;
  }

  /** 重算payment_plan的received_amount（硬口径：由核销明细SUM算出） */
  private async recalcPaymentPlan(tx: any, planId: number) {
    const allocSum = await tx.receiptAllocation.aggregate({ where: { paymentPlanId: planId, receipt: { status: 'confirmed' } }, _sum: { amount: true } });
    const received = Number(allocSum._sum.amount || 0);
    const plan = await tx.paymentPlan.findUnique({ where: { id: planId } });
    if (!plan) return;
    const outstanding = Number(plan.amount) - received;
    let status = plan.status;
    if (received >= Number(plan.amount) - 0.01) status = 'completed';
    else if (received > 0) status = 'partial';
    else if (plan.dueDate < new Date()) status = 'overdue';
    else status = 'pending';

    await tx.paymentPlan.update({ where: { id: planId }, data: { receivedAmount: received, outstandingAmount: Math.max(0, outstanding), status } });
  }

  /** 重算contract的total_received/total_outstanding */
  private async recalcContract(tx: any, contractId: number) {
    const plans = await tx.paymentPlan.findMany({ where: { contractId, status: { not: 'cancelled' } } });
    const totalReceived = plans.reduce((sum: number, p: any) => sum + Number(p.receivedAmount), 0);
    const contract = await tx.contract.findUnique({ where: { id: contractId } });
    if (!contract) return;
    const totalOutstanding = Number(contract.amount) - totalReceived;
    await tx.contract.update({ where: { id: contractId }, data: { totalReceived, totalOutstanding: Math.max(0, totalOutstanding) } });
  }

  private async generateNo(db: any, prefix: string): Promise<string> {
    const now = new Date();
    const p = `${prefix}${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const field = prefix === 'SK' ? 'receiptNo' : 'planNo';
    const last = await db.receipt.findFirst({ where: { receiptNo: { startsWith: p } }, orderBy: { receiptNo: 'desc' }, select: { receiptNo: true } });
    const seq = last ? parseInt((last as any)[field].slice(-3)) + 1 : 1;
    return `${p}${String(seq).padStart(3, '0')}`;
  }
}
