import type { DataScope } from '@prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class RoleService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    return db.role.findMany({ orderBy: { id: 'asc' }, include: { _count: { select: { userRoles: true } } } });
  }

  async findOne(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const role = await db.role.findFirst({ where: { id } });
    if (!role) throw new NotFoundException({ code: 5, message: '角色不存在' });
    return role;
  }

  async create(tenantId: number, data: { name: string; code: string; description?: string; dataScope: DataScope; permissions: string[]; fieldPermissions?: any }) {
    const db = this.prisma.forTenant(tenantId);
    return db.role.create({ data: { tenantId, ...data, permissions: data.permissions as any, isSystem: false } });
  }

  async update(tenantId: number, id: number, data: { name?: string; description?: string; dataScope?: DataScope; permissions?: string[]; fieldPermissions?: any }) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.role.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 5, message: '角色不存在' });
    const updateData: any = { ...data };
    if (data.permissions) updateData.permissions = data.permissions;
    return db.role.update({ where: { id }, data: updateData });
  }

  async remove(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.role.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 5, message: '角色不存在' });
    if (existing.isSystem) throw new NotFoundException({ code: 7, message: '系统预置角色不可删除' });
    const userCount = await db.userRole.count({ where: { roleId: id } });
    if (userCount > 0) throw new NotFoundException({ code: 7, message: `该角色下有${userCount}个用户，请先移除` });
    await db.role.delete({ where: { id } });
    return { message: '已删除' };
  }
}
