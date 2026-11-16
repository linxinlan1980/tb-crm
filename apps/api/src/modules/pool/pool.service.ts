import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../system/audit-logs/audit-log.service';

/**
 * 公私海核心服务
 * 实现三级客户池（公海→部门池→私海）的领取/分配/退回/回收/转移
 * 规则引擎：私海上限/每日限额/冷却期/保护期/自动回收
 * 参考文档：crm/02_功能需求PRD/03_公私海管理模块PRD.md
 */
@Injectable()
export class PoolService {
  constructor(private prisma: PrismaService, private auditLog: AuditLogService) {}

  /** 公海客户列表 */
  async findPublic(tenantId: number, query: { page?: number; pageSize?: number; industry?: string; level?: string; keyword?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, industry, level, keyword } = query;
    const where: any = { poolType: 'public', deletedAt: null };
    if (industry) where.industry = industry;
    if (level) where.level = level;
    if (keyword) where.OR = [{ name: { contains: keyword } }, { code: { contains: keyword } }];

    const [items, total] = await Promise.all([
      db.customer.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { updatedAt: 'desc' } }),
      db.customer.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  /** 我的私海列表 */
  async findPrivate(tenantId: number, userId: number, query: { page?: number; pageSize?: number; keyword?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, keyword } = query;
    const where: any = { poolType: 'private', ownerId: userId, deletedAt: null };
    if (keyword) where.OR = [{ name: { contains: keyword } }, { code: { contains: keyword } }];

    const [items, total] = await Promise.all([
      db.customer.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { protectUntil: 'asc' } }),
      db.customer.count({ where }),
    ]);

    // 附加holding信息（保护期/跟进次数）
    const holdings = await db.privateHolding.findMany({ where: { userId, customerId: { in: items.map((i) => i.id) } } });
    const holdingMap = new Map(holdings.map((h) => [h.customerId, h]));

    return {
      items: items.map((c) => ({ ...c, _holding: holdingMap.get(c.id) || null })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  /**
   * 领取客户（公海→私海）
   * 校验：私海上限 + 每日限额 + 冷却期 + 是否已在私海
   */
  async claim(tenantId: number, userId: number, customerId: number) {
    const db = this.prisma.forTenant(tenantId);
    const config = await this.getPoolConfig(db);

    // 1. 客户必须在公海
    const customer = await db.customer.findFirst({ where: { id: customerId, deletedAt: null } });
    if (!customer) throw new BadRequestException({ code: 5, message: '客户不存在' });
    if (customer.poolType !== 'public') throw new BadRequestException({ code: 4009, message: '该客户不在公海中，无法领取' });

    // 2. 私海上限校验
    const currentCount = await db.privateHolding.count({ where: { userId, tenantId } });
    if (currentCount >= config.privateMax) {
      throw new BadRequestException({ code: 4001, message: `私海客户已达上限（${currentCount}/${config.privateMax}），请先退回部分客户`, data: { current: currentCount, max: config.privateMax } });
    }

    // 3. 每日领取限额
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayClaims = await db.poolLog.count({ where: { operatorId: userId, action: 'claim', createdAt: { gte: todayStart } } });
    if (todayClaims >= config.maxClaimPerDay) {
      throw new BadRequestException({ code: 4002, message: `今日领取次数已达上限（${config.maxClaimPerDay}个/天）`, data: { todayClaimed: todayClaims, max: config.maxClaimPerDay } });
    }

    // 4. 冷却期校验
    const lastRecycle = await db.poolLog.findFirst({
      where: { customerId, action: { in: ['recycle', 'return'] }, toPool: 'public' },
      orderBy: { createdAt: 'desc' },
    });
    if (lastRecycle) {
      const cooldownEnd = new Date(lastRecycle.createdAt);
      cooldownEnd.setDate(cooldownEnd.getDate() + 7); // TODO: 从config读取cooldown_days
      if (new Date() < cooldownEnd) {
        const remainDays = Math.ceil((cooldownEnd.getTime() - Date.now()) / 86400000);
        throw new BadRequestException({ code: 4003, message: `该客户冷却期中（剩余${remainDays}天），暂不可领取`, data: { remainDays } });
      }
    }

    // 5. 执行领取（事务）
    const protectUntil = new Date();
    protectUntil.setDate(protectUntil.getDate() + config.protectDays);

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: customerId }, data: { poolType: 'private', ownerId: userId, protectUntil } });
      await tx.privateHolding.create({ data: { tenantId, userId, customerId, claimedAt: new Date(), protectUntil } });
      await tx.poolLog.create({ data: { tenantId, customerId, action: 'claim', fromPool: 'public', toPool: 'private', toOwnerId: userId, protectUntil, operatorId: userId, isAuto: false } });
    });

    await this.auditLog.log({ tenantId, userId, action: 'claim', objectType: 'pool', objectId: customerId, objectNo: customer.code });

    return { customerId, customerName: customer.name, poolType: 'private', ownerId: userId, protectUntil, privateCount: currentCount + 1, privateMax: config.privateMax };
  }

  /**
   * 分配客户（经理→销售）
   */
  async assign(tenantId: number, managerId: number, customerIds: number[], toUserId: number, reason?: string) {
    const db = this.prisma.forTenant(tenantId);
    const config = await this.getPoolConfig(db);
    const results: any[] = [];

    for (const customerId of customerIds) {
      const customer = await db.customer.findFirst({ where: { id: customerId, deletedAt: null } });
      if (!customer) { results.push({ id: customerId, status: 'failed', reason: '客户不存在' }); continue; }
      if (customer.poolType === 'private' && customer.ownerId === toUserId) { results.push({ id: customerId, status: 'skipped', reason: '已在该销售私海' }); continue; }

      // 检查目标销售私海上限
      const targetCount = await db.privateHolding.count({ where: { userId: toUserId } });
      if (targetCount >= config.privateMax) { results.push({ id: customerId, status: 'failed', reason: '目标销售私海已满' }); continue; }

      const protectUntil = new Date();
      protectUntil.setDate(protectUntil.getDate() + config.protectDays);
      const fromPool = customer.poolType;
      const fromOwnerId = customer.ownerId;

      await this.prisma.$transaction(async (tx) => {
        // 如果原owner有holding，删除
        if (fromOwnerId) await tx.privateHolding.deleteMany({ where: { customerId, userId: fromOwnerId } });
        await tx.customer.update({ where: { id: customerId }, data: { poolType: 'private', ownerId: toUserId, protectUntil } });
        await tx.privateHolding.create({ data: { tenantId, userId: toUserId, customerId, claimedAt: new Date(), protectUntil } });
        await tx.poolLog.create({ data: { tenantId, customerId, action: 'assign', fromPool, toPool: 'private', fromOwnerId, toOwnerId: toUserId, protectUntil, operatorId: managerId, isAuto: false, reason } });
      });
      results.push({ id: customerId, status: 'ok' });
    }

    return { assigned: results.filter((r) => r.status === 'ok').length, failed: results.filter((r) => r.status === 'failed').length, results };
  }

  /**
   * 退回公海（销售主动）
   */
  async returnToPublic(tenantId: number, userId: number, customerId: number, reason: string) {
    const db = this.prisma.forTenant(tenantId);
    if (!reason?.trim()) throw new BadRequestException({ code: 4006, message: '退回客户必须填写原因' });

    const customer = await db.customer.findFirst({ where: { id: customerId, ownerId: userId, poolType: 'private', deletedAt: null } });
    if (!customer) throw new BadRequestException({ code: 5, message: '客户不存在或不在您的私海中' });

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: customerId }, data: { poolType: 'public', ownerId: null, ownerDeptId: null, protectUntil: null } });
      await tx.privateHolding.deleteMany({ where: { customerId, userId } });
      await tx.poolLog.create({ data: { tenantId, customerId, action: 'return', fromPool: 'private', toPool: 'public', fromOwnerId: userId, reason, operatorId: userId, isAuto: false } });
    });

    await this.auditLog.log({ tenantId, userId, action: 'return', objectType: 'pool', objectId: customerId, objectNo: customer.code, afterData: { reason } });
    return { message: '已退回公海', customerId };
  }

  /**
   * 转移客户（经理操作：A销售→B销售）
   */
  async transfer(tenantId: number, managerId: number, customerId: number, toUserId: number, reason?: string) {
    const db = this.prisma.forTenant(tenantId);
    const customer = await db.customer.findFirst({ where: { id: customerId, deletedAt: null } });
    if (!customer) throw new BadRequestException({ code: 5, message: '客户不存在' });

    const fromOwnerId = customer.ownerId;
    const config = await this.getPoolConfig(db);
    const protectUntil = new Date();
    protectUntil.setDate(protectUntil.getDate() + config.protectDays);

    await this.prisma.$transaction(async (tx) => {
      if (fromOwnerId) await tx.privateHolding.deleteMany({ where: { customerId, userId: fromOwnerId } });
      await tx.customer.update({ where: { id: customerId }, data: { ownerId: toUserId, poolType: 'private', protectUntil } });
      await tx.privateHolding.create({ data: { tenantId, userId: toUserId, customerId, claimedAt: new Date(), protectUntil } });
      await tx.poolLog.create({ data: { tenantId, customerId, action: 'transfer', fromPool: 'private', toPool: 'private', fromOwnerId, toOwnerId: toUserId, protectUntil, operatorId: managerId, isAuto: false, reason } });
    });

    return { message: '转移成功', customerId, fromOwnerId, toUserId };
  }

  /**
   * 自动回收（定时任务调用）
   * 逻辑：超期无跟进 + 无活跃商机 + 无未结合同 → 回收到公海
   */
  async autoRecycle(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const config = await this.getPoolConfig(db);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.autoRecycleDays);

    // 找到所有私海客户中，最近跟进时间超过autoRecycleDays的
    const candidates = await db.privateHolding.findMany({
      where: {
        tenantId,
        protectUntil: { lt: new Date() }, // 保护期已过
        OR: [{ lastFollowAt: { lt: cutoffDate } }, { lastFollowAt: null, claimedAt: { lt: cutoffDate } }],
      },
    });

    let recycled = 0;
    for (const holding of candidates) {
      // 检查豁免条件
      const openOpps = await db.opportunity.count({ where: { customerId: holding.customerId, status: 'open', deletedAt: null } });
      if (openOpps > 0) continue;
      const activeContracts = await db.contract.count({ where: { customerId: holding.customerId, status: { in: ['signed', 'executing'] }, deletedAt: null } });
      if (activeContracts > 0) continue;

      // 执行回收
      await this.prisma.$transaction(async (tx) => {
        await tx.customer.update({ where: { id: holding.customerId }, data: { poolType: config.recycleTo, ownerId: null, ownerDeptId: null, protectUntil: null } });
        await tx.privateHolding.delete({ where: { id: holding.id } });
        await tx.poolLog.create({ data: { tenantId, customerId: holding.customerId, action: 'recycle', fromPool: 'private', toPool: config.recycleTo, fromOwnerId: holding.userId, reason: `超期${config.autoRecycleDays}天未跟进，系统自动回收`, operatorId: 0, isAuto: true } });
      });
      recycled++;
    }
    return { recycled, checked: candidates.length };
  }

  /** 流转日志 */
  async findLogs(tenantId: number, query: { page?: number; pageSize?: number; customerId?: number; userId?: number; action?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, customerId, userId, action } = query;
    const where: any = { tenantId };
    if (customerId) where.customerId = customerId;
    if (userId) where.OR = [{ fromOwnerId: userId }, { toOwnerId: userId }, { operatorId: userId }];
    if (action) where.action = action;

    const [items, total] = await Promise.all([
      db.poolLog.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      db.poolLog.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  /** 池统计 */
  async getStatistics(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const [publicCount, deptCount, privateCount, totalHoldings] = await Promise.all([
      db.customer.count({ where: { poolType: 'public', deletedAt: null } }),
      db.customer.count({ where: { poolType: 'dept', deletedAt: null } }),
      db.customer.count({ where: { poolType: 'private', deletedAt: null } }),
      db.privateHolding.count({ where: { tenantId } }),
    ]);
    // 各销售私海分布
    const byUser = await db.privateHolding.groupBy({ by: ['userId'], where: { tenantId }, _count: true });
    return { publicCount, deptCount, privateCount, totalHoldings, byUser };
  }

  /** 获取池配置 */
  private async getPoolConfig(db: any) {
    const config = await db.poolConfig.findFirst({ where: { poolType: 'public', isActive: true } });
    return config || { maxClaimPerDay: 3, protectDays: 30, followRequiredDays: 15, autoRecycleDays: 60, recycleTo: 'public', privateMax: 50, claimNeedApproval: false, assignStrategy: 'manual' };
  }
}
