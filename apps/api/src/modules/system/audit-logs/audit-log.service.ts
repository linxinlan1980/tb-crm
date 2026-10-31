import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  /** 写入审计日志（异步，不阻塞业务） */
  async log(data: { tenantId: number; userId?: number; action: string; objectType: string; objectId?: number; objectNo?: string; beforeData?: any; afterData?: any; ipAddress?: string; userAgent?: string }) {
    await this.prisma.system.auditLog.create({ data: data as any });
  }

  /** 查询审计日志（分页+筛选） */
  async findAll(tenantId: number, query: { page?: number; pageSize?: number; userId?: number; objectType?: string; objectId?: number; action?: string; dateFrom?: string; dateTo?: string }) {
    const { page = 1, pageSize = 20, ...filters } = query;
    const where: any = { tenantId };
    if (filters.userId) where.userId = filters.userId;
    if (filters.objectType) where.objectType = filters.objectType;
    if (filters.objectId) where.objectId = filters.objectId;
    if (filters.action) where.action = filters.action;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo + 'T23:59:59');
    }
    const [items, total] = await Promise.all([
      this.prisma.system.auditLog.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      this.prisma.system.auditLog.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }
}
