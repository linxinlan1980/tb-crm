import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * 行动计划服务
 * 按客户/商机/项目三维度创建行动任务，支持截止日/优先级/状态/AI来源标记
 */
@Injectable()
export class ActionPlanService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: number, query: { targetType?: string; targetId?: number; assigneeId?: number; status?: string; dueBefore?: string; page?: number; pageSize?: number }) {
    const db = this.prisma.forTenant(tenantId);
    const { targetType, targetId, assigneeId, status, dueBefore, page = 1, pageSize = 20 } = query;
    const where: any = { deletedAt: null };
    if (targetType) where.targetType = targetType;
    if (targetId) where.targetId = targetId;
    if (assigneeId) where.assigneeId = assigneeId;
    if (status) where.status = status;
    if (dueBefore) where.dueDate = { lte: new Date(dueBefore) };

    const [items, total] = await Promise.all([
      db.actionPlan.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ dueDate: 'asc' }, { priority: 'asc' }] }),
      db.actionPlan.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async create(tenantId: number, userId: number, data: any) {
    const db = this.prisma.forTenant(tenantId);
    return db.actionPlan.create({ data: { tenantId, ...data, createdBy: userId } });
  }

  async update(tenantId: number, id: number, data: any) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.actionPlan.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 5, message: '行动计划不存在' });
    return db.actionPlan.update({ where: { id }, data });
  }

  async complete(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    return db.actionPlan.update({ where: { id }, data: { status: 'completed', completedAt: new Date() } });
  }

  /** 今日待办 */
  async findToday(tenantId: number, userId: number) {
    const db = this.prisma.forTenant(tenantId);
    const today = new Date(); today.setHours(23, 59, 59, 999);
    return db.actionPlan.findMany({
      where: { tenantId, assigneeId: userId, status: { in: ['pending', 'in_progress', 'overdue'] }, dueDate: { lte: today }, deletedAt: null },
      orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
    });
  }

  /** 逾期行动 */
  async findOverdue(tenantId: number, userId: number) {
    const db = this.prisma.forTenant(tenantId);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return db.actionPlan.findMany({
      where: { tenantId, assigneeId: userId, status: { in: ['pending', 'in_progress'] }, dueDate: { lt: today }, deletedAt: null },
      orderBy: { dueDate: 'asc' },
    });
  }
}
