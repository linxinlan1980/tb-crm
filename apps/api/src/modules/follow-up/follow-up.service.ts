import type { FollowMethod } from '@prisma/client';
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * 跟进记录服务（通用多态：customer/opportunity/project/lead）
 * 创建跟进后自动更新目标对象的lastFollowAt
 */
@Injectable()
export class FollowUpService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: number, query: { targetType?: string; targetId?: number; customerId?: number; createdBy?: number; page?: number; pageSize?: number }) {
    const db = this.prisma.forTenant(tenantId);
    const { targetType, targetId, customerId, createdBy, page = 1, pageSize = 20 } = query;
    const where: any = { deletedAt: null };
    if (targetType) where.targetType = targetType;
    if (targetId) where.targetId = targetId;
    if (customerId) where.customerId = customerId;
    if (createdBy) where.createdBy = createdBy;

    const [items, total] = await Promise.all([
      db.followUp.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      db.followUp.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async create(tenantId: number, userId: number, data: { targetType: string; targetId: number; customerId?: number; method: FollowMethod; content: string; contactId?: number; result?: string; nextAction?: string; nextFollowAt?: string; aiStructured?: any }) {
    const db = this.prisma.forTenant(tenantId);
    const followUp = await db.followUp.create({ data: { tenantId, ...data, createdBy: userId } });

    // 自动更新目标对象的lastFollowAt
    if (data.targetType === 'customer' || data.customerId) {
      const cid = data.targetType === 'customer' ? data.targetId : data.customerId;
      await db.customer.update({ where: { id: cid! }, data: { lastFollowAt: new Date(), lastFollowBy: userId } });
      // 更新private_holdings的跟进记录（影响保护期续期）
      await db.privateHolding.updateMany({ where: { customerId: cid!, userId }, data: { lastFollowAt: new Date(), followCount: { increment: 1 } } });
    }
    if (data.targetType === 'opportunity') {
      await db.opportunity.update({ where: { id: data.targetId }, data: { lastFollowAt: new Date(), followCount: { increment: 1 } } });
    }
    if (data.targetType === 'lead') {
      await db.lead.update({ where: { id: data.targetId }, data: { lastFollowAt: new Date(), followCount: { increment: 1 } } });
    }

    return followUp;
  }

  async update(tenantId: number, userId: number, id: number, data: any) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.followUp.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 5, message: '跟进记录不存在' });
    // 只允许创建者24h内编辑
    if (existing.createdBy !== userId) throw new ForbiddenException({ code: 3, message: '只能编辑自己的跟进记录' });
    const hoursSince = (Date.now() - existing.createdAt.getTime()) / 3600000;
    if (hoursSince > 24) throw new ForbiddenException({ code: 3, message: '超过24小时的跟进记录不可编辑' });
    return db.followUp.update({ where: { id }, data });
  }

  async remove(tenantId: number, userId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.followUp.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 5, message: '跟进记录不存在' });
    if (existing.createdBy !== userId) throw new ForbiddenException({ code: 3, message: '只能删除自己的跟进记录' });
    await db.followUp.update({ where: { id }, data: { deletedAt: new Date() } });
    return { message: '已删除' };
  }
}
