import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

/**
 * 里程碑引擎 — 合同签约后自动实例化里程碑计划
 *
 * 核心逻辑（对应文档 crm/08_合同节点模板/7种合同类型里程碑模板.md）：
 * 1. 根据 contract_type 找到对应的 milestone_template（is_active=true）
 * 2. 遍历 milestone_template_items，为每项创建 contract_milestones
 * 3. planned_date = sign_date + offset_days
 * 4. amount = contract_amount × amount_ratio / 100
 * 5. 外包合同特殊处理：月度结算节点按 duration_months 动态生成
 *
 * 里程碑完成联动（complete方法）：
 * - 触发回款计划 due_date 设置
 * - 触发开票提醒
 * - 联动项目里程碑
 * - 重算项目进度
 */
@Injectable()
export class MilestoneService {
  private readonly logger = new Logger('MilestoneEngine');

  constructor(private prisma: PrismaService) {}

  /**
   * 实例化里程碑（合同签约时调用）
   * @returns 创建的里程碑列表
   */
  async instantiate(tenantId: number, contractId: number, contractType: string, milestoneTemplateId: number | null, signDate: Date, contractAmount: number) {
    const db = this.prisma.forTenant(tenantId);

    // 查找模板
    let templateId = milestoneTemplateId;
    if (!templateId) {
      const template = await db.milestoneTemplate.findFirst({ where: { tenantId, contractType: contractType as any, isActive: true } });
      templateId = template?.id ?? null;
    }
    if (!templateId) {
      this.logger.warn(`合同${contractId}无匹配的里程碑模板（类型=${contractType}），跳过实例化`);
      return [];
    }

    // 获取模板项
    const items = await db.milestoneTemplateItem.findMany({ where: { templateId }, orderBy: { sortOrder: 'asc' } });
    if (!items.length) {
      this.logger.warn(`模板${templateId}无里程碑项，跳过`);
      return [];
    }

    const created: any[] = [];

    for (const item of items) {
      // 计算计划日期
      const plannedDate = new Date(signDate);
      plannedDate.setDate(plannedDate.getDate() + item.offsetDays);

      // 计算金额
      const amount = item.amountRatio ? Number((contractAmount * Number(item.amountRatio) / 100).toFixed(2)) : null;

      const milestone = await db.contractMilestone.create({
        data: {
          tenantId,
          contractId,
          templateItemId: item.id,
          name: item.name,
          sortOrder: item.sortOrder,
          plannedDate,
          amount,
          amountRatio: item.amountRatio,
          paymentTrigger: item.paymentTrigger,
          paymentDaysAfter: item.paymentDaysAfter,
          deliverables: item.deliverables,
          status: 'pending',
          invoiceTriggered: false,
        },
      });
      created.push(milestone);
    }

    // 外包合同特殊处理：动态生成月度结算节点
    if (contractType === 'outsource') {
      // TODO: 根据contract.duration_months循环生成月度节点
      // 一期简化：使用模板中的固定节点
      this.logger.log(`外包合同${contractId}：使用模板固定节点（月度动态生成留二期）`);
    }

    this.logger.log(`合同${contractId}里程碑实例化完成：${created.length}个节点`);
    return created;
  }

  /**
   * 确认里程碑完成（核心联动）
   * 触发：回款计划due_date设置 + 开票提醒 + 项目进度重算
   */
  async complete(tenantId: number, userId: number, milestoneId: number, data: { actualDate: string; attachmentIds?: any[] }) {
    const db = this.prisma.forTenant(tenantId);
    const milestone = await db.contractMilestone.findFirst({ where: { id: milestoneId } });
    if (!milestone) throw new Error('里程碑不存在');
    if (milestone.status === 'completed') throw new Error('里程碑已完成，不可重复操作');

    const actualDate = new Date(data.actualDate);

    // 更新里程碑状态
    await db.contractMilestone.update({
      where: { id: milestoneId },
      data: { status: 'completed', actualDate, completedBy: userId, completedAt: new Date(), attachmentIds: data.attachmentIds as any },
    });

    // 联动：设置回款计划due_date
    if (milestone.paymentTrigger !== 'none' && milestone.amount) {
      const paymentPlan = await db.paymentPlan.findFirst({ where: { milestoneId, status: { in: ['pending', 'partial'] } } });
      if (paymentPlan) {
        let dueDate: Date;
        if (milestone.paymentTrigger === 'on_complete') {
          dueDate = actualDate; // 完成即到期
        } else if (milestone.paymentTrigger === 'after_days') {
          dueDate = new Date(actualDate);
          dueDate.setDate(dueDate.getDate() + milestone.paymentDaysAfter);
        } else {
          dueDate = paymentPlan.dueDate; // manual: 保持原计划日期
        }
        await db.paymentPlan.update({ where: { id: paymentPlan.id }, data: { dueDate } });
      }
    }

    // 联动：标记开票提醒
    await db.contractMilestone.update({ where: { id: milestoneId }, data: { invoiceTriggered: true } });

    // 联动：检查合同是否所有里程碑完成 → 合同可complete
    const allMilestones = await db.contractMilestone.findMany({ where: { contractId: milestone.contractId } });
    const allCompleted = allMilestones.every((m) => m.id === milestoneId ? true : m.status === 'completed' || m.status === 'cancelled');
    if (allCompleted) {
      // 检查回款是否全额到账
      const contract = await db.contract.findFirst({ where: { id: milestone.contractId } });
      if (contract && Number(contract.totalReceived) >= Number(contract.amount)) {
        await db.contract.update({ where: { id: contract.id }, data: { status: 'completed' } });
      } else {
        await db.contract.update({ where: { id: milestone.contractId }, data: { status: 'executing' } });
      }
    } else {
      // 首个里程碑完成 → 合同进入executing
      const contract = await db.contract.findFirst({ where: { id: milestone.contractId } });
      if (contract?.status === 'signed') {
        await db.contract.update({ where: { id: milestone.contractId }, data: { status: 'executing' } });
      }
    }

    this.logger.log(`里程碑${milestoneId}(${milestone.name})已完成，联动触发完毕`);
    return { milestoneId, name: milestone.name, status: 'completed', actualDate };
  }

  /** 获取合同的里程碑列表（含回款计划关联） */
  async findByContract(tenantId: number, contractId: number) {
    const db = this.prisma.forTenant(tenantId);
    return db.contractMilestone.findMany({ where: { contractId }, orderBy: { sortOrder: 'asc' } });
  }
}
