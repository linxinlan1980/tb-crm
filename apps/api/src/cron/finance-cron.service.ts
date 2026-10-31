import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';

/**
 * 财务定时任务
 * JOB-004: 回款到期提醒（每日09:00）
 * JOB-005: 逾期账龄更新（每日00:30）
 * JOB-006: 合同过期标记（每日02:00）
 * JOB-007: 合同续签提醒（每日09:00）
 * JOB-008: 里程碑延期检查（每日08:00）
 */
@Injectable()
export class FinanceCronService {
  private readonly logger = new Logger('FinanceCron');
  constructor(private prisma: PrismaService) {}

  /** JOB-005: 每日00:30 重算逾期天数和状态 */
  @Cron('30 0 * * *', { timeZone: 'Asia/Shanghai', disabled: process.env.ENABLE_LEGACY_CRON !== 'true' })
  async handleAgingUpdate() {
    this.logger.log('JOB-005 开始：逾期账龄更新');
    try {
      const tenants = await this.prisma.system.tenant.findMany({ where: { status: { in: ['active', 'trial'] } } });
      let updated = 0;
      for (const tenant of tenants) {
        const db = this.prisma.forTenant(tenant.id);
        const now = new Date();
        const plans = await db.paymentPlan.findMany({ where: { status: { in: ['pending', 'partial', 'overdue'] } } });
        for (const plan of plans) {
          const overdueDays = plan.dueDate < now ? Math.floor((now.getTime() - plan.dueDate.getTime()) / 86400000) : 0;
          let status = plan.status;
          if (Number(plan.receivedAmount) >= Number(plan.amount)) status = 'completed';
          else if (overdueDays > 0) status = 'overdue';
          else if (Number(plan.receivedAmount) > 0) status = 'partial';
          else status = 'pending';

          if (overdueDays !== plan.overdueDays || status !== plan.status) {
            await db.paymentPlan.update({ where: { id: plan.id }, data: { overdueDays, status } });
            updated++;
          }
        }
      }
      this.logger.log(`JOB-005 完成：更新${updated}条回款计划`);
    } catch (e: any) { this.logger.error(`JOB-005 失败: ${e.message}`); }
  }

  /** JOB-006: 每日02:00 合同过期标记 */
  @Cron('0 2 * * *', { timeZone: 'Asia/Shanghai', disabled: process.env.ENABLE_LEGACY_CRON !== 'true' })
  async handleContractExpire() {
    this.logger.log('JOB-006 开始：合同过期标记');
    try {
      const tenants = await this.prisma.system.tenant.findMany({ where: { status: { in: ['active', 'trial'] } } });
      let expired = 0;
      for (const tenant of tenants) {
        const db = this.prisma.forTenant(tenant.id);
        const result = await db.contract.updateMany({
          where: { endDate: { lt: new Date() }, status: { in: ['signed', 'executing'] }, deletedAt: null },
          data: { status: 'expired' },
        });
        expired += result.count;
      }
      this.logger.log(`JOB-006 完成：${expired}个合同标记过期`);
    } catch (e: any) { this.logger.error(`JOB-006 失败: ${e.message}`); }
  }

  /** JOB-008: 每日08:00 里程碑延期检查 */
  @Cron('0 8 * * *', { timeZone: 'Asia/Shanghai', disabled: process.env.ENABLE_LEGACY_CRON !== 'true' })
  async handleMilestoneDelay() {
    this.logger.log('JOB-008 开始：里程碑延期检查');
    try {
      const tenants = await this.prisma.system.tenant.findMany({ where: { status: { in: ['active', 'trial'] } } });
      let delayed = 0;
      for (const tenant of tenants) {
        const db = this.prisma.forTenant(tenant.id);
        const result = await db.contractMilestone.updateMany({
          where: { plannedDate: { lt: new Date() }, status: { in: ['pending', 'in_progress'] } },
          data: { status: 'delayed' },
        });
        delayed += result.count;
      }
      this.logger.log(`JOB-008 完成：${delayed}个里程碑标记延期`);
    } catch (e: any) { this.logger.error(`JOB-008 失败: ${e.message}`); }
  }

  /** JOB-003: 每日09:00 商机停滞检查（更新stage_stall_days） */
  @Cron('0 9 * * *', { timeZone: 'Asia/Shanghai', disabled: process.env.ENABLE_LEGACY_CRON !== 'true' })
  async handleStallCheck() {
    this.logger.log('JOB-003 开始：商机停滞检查');
    try {
      const tenants = await this.prisma.system.tenant.findMany({ where: { status: { in: ['active', 'trial'] } } });
      let updated = 0;
      for (const tenant of tenants) {
        const db = this.prisma.forTenant(tenant.id);
        const opps = await db.opportunity.findMany({ where: { status: 'open', deletedAt: null }, select: { id: true, stageEnteredAt: true, stage: true } });
        const now = new Date();
        for (const opp of opps) {
          const stallDays = Math.floor((now.getTime() - opp.stageEnteredAt.getTime()) / 86400000);
          await db.opportunity.update({ where: { id: opp.id }, data: { stageStallDays: stallDays } });
          updated++;
        }
      }
      this.logger.log(`JOB-003 完成：更新${updated}个商机停滞天数`);
    } catch (e: any) { this.logger.error(`JOB-003 失败: ${e.message}`); }
  }
}
