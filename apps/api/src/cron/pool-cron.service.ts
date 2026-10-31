import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { PoolService } from '../modules/pool/pool.service';

/**
 * 公私海定时任务
 * 对应文档：crm/12_工程规范/定时任务规格.md JOB-001/002/010
 */
@Injectable()
export class PoolCronService {
  private readonly logger = new Logger('PoolCron');

  constructor(private prisma: PrismaService, private poolService: PoolService) {}

  /**
   * JOB-001: 每日01:00 自动回收超期未跟进的私海客户
   */
  @Cron('0 1 * * *', { timeZone: 'Asia/Shanghai', disabled: process.env.ENABLE_LEGACY_CRON !== 'true' })
  async handleAutoRecycle() {
    this.logger.log('JOB-001 开始：公私海自动回收');
    try {
      const tenants = await this.prisma.system.tenant.findMany({ where: { status: { in: ['active', 'trial'] } } });
      let totalRecycled = 0;
      for (const tenant of tenants) {
        const result = await this.poolService.autoRecycle(tenant.id);
        totalRecycled += result.recycled;
        if (result.recycled > 0) {
          this.logger.log(`租户${tenant.id}: 回收${result.recycled}个客户（检查${result.checked}个）`);
        }
      }
      this.logger.log(`JOB-001 完成：共回收${totalRecycled}个客户`);
    } catch (e: any) {
      this.logger.error(`JOB-001 失败: ${e.message}`);
    }
  }

  /**
   * JOB-002: 每日09:00 保护期/跟进预警
   */
  @Cron('0 9 * * *', { timeZone: 'Asia/Shanghai', disabled: process.env.ENABLE_LEGACY_CRON !== 'true' })
  async handleProtectCheck() {
    this.logger.log('JOB-002 开始：保护期/跟进预警');
    try {
      const tenants = await this.prisma.system.tenant.findMany({ where: { status: { in: ['active', 'trial'] } } });
      for (const tenant of tenants) {
        const db = this.prisma.forTenant(tenant.id);
        // 找到保护期≤7天且超follow_required_days无跟进的
        const sevenDaysLater = new Date();
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

        const holdings = await db.privateHolding.findMany({
          where: { protectUntil: { lte: sevenDaysLater }, isExpired: false },
        });

        for (const h of holdings) {
          const lastFollow = h.lastFollowAt || h.claimedAt;
          const daysNoFollow = Math.floor((Date.now() - lastFollow.getTime()) / 86400000);
          if (daysNoFollow >= 15) { // TODO: 从pool_config读取follow_required_days
            // 发送预警通知（S5实现通知服务后接入）
            this.logger.warn(`保护期预警: 租户${tenant.id} 客户${h.customerId} 用户${h.userId} 已${daysNoFollow}天未跟进`);
          }
        }

        // 标记已超保护期的holding
        await db.privateHolding.updateMany({
          where: { protectUntil: { lt: new Date() }, isExpired: false },
          data: { isExpired: true },
        });
      }
      this.logger.log('JOB-002 完成');
    } catch (e: any) {
      this.logger.error(`JOB-002 失败: ${e.message}`);
    }
  }
}
