import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class DepartmentService {
  constructor(private prisma: PrismaService) {}

  /** 获取部门树（递归构建） */
  async getTree(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const departments = await db.department.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return this.buildTree(departments, null);
  }

  /** 创建部门 */
  async create(tenantId: number, data: { name: string; code?: string; parentId?: number; leaderId?: number; sortOrder?: number }) {
    const db = this.prisma.forTenant(tenantId);
    if (data.parentId) {
      const parent = await db.department.findFirst({ where: { id: data.parentId } });
      if (!parent) throw new NotFoundException({ code: 5, message: '上级部门不存在' });
    }
    return db.department.create({ data: { tenantId, ...data } });
  }

  /** 更新部门 */
  async update(tenantId: number, id: number, data: { name?: string; code?: string; parentId?: number; leaderId?: number; sortOrder?: number; status?: number }) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.department.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 5, message: '部门不存在' });
    return db.department.update({ where: { id }, data });
  }

  /** 删除部门（软删除，需检查是否有子部门/人员） */
  async remove(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const children = await db.department.count({ where: { parentId: id, deletedAt: null } });
    if (children > 0) throw new ConflictException({ code: 6, message: '该部门下有子部门，不可删除' });
    const users = await db.user.count({ where: { deptId: id, deletedAt: null } });
    if (users > 0) throw new ConflictException({ code: 6, message: '该部门下有人员，不可删除' });
    await db.department.update({ where: { id }, data: { deletedAt: new Date() } });
    return { message: '已删除' };
  }

  private buildTree(items: any[], parentId: number | null): any[] {
    return items
      .filter((i) => i.parentId === parentId)
      .map((i) => ({ ...i, children: this.buildTree(items, i.id) }));
  }
}
