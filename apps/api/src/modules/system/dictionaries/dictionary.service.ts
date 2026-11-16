import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class DictionaryService {
  constructor(private prisma: PrismaService) {}

  /** 按类型获取字典列表 */
  async findByType(tenantId: number, type: string) {
    const db = this.prisma.forTenant(tenantId);
    return db.dictionary.findMany({ where: { type, isActive: true, deletedAt: null }, orderBy: { sortOrder: 'asc' } });
  }

  /** 获取所有字典类型 */
  async findTypes(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const items = await db.dictionary.findMany({ where: { isActive: true, deletedAt: null }, select: { type: true } });
    return [...new Set(items.map((i) => i.type))];
  }

  /** 创建字典项 */
  async create(tenantId: number, data: { type: string; code: string; name: string; extra?: any; sortOrder?: number }) {
    const db = this.prisma.forTenant(tenantId);
    return db.dictionary.create({ data: { tenantId, ...data } });
  }

  /** 更新字典项 */
  async update(tenantId: number, id: number, data: { name?: string; extra?: any; sortOrder?: number; isActive?: boolean }) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.dictionary.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 5, message: '字典项不存在' });
    return db.dictionary.update({ where: { id }, data });
  }

  /** 删除字典项（软删除，系统预置不可删） */
  async remove(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.dictionary.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 5, message: '字典项不存在' });
    if (existing.isSystem) throw new NotFoundException({ code: 7, message: '系统预置字典项不可删除，可停用' });
    await db.dictionary.update({ where: { id }, data: { deletedAt: new Date() } });
    return { message: '已删除' };
  }
}
