import type { UserStatus } from '@prisma/client';
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  /** 用户列表（分页+筛选） */
  async findAll(tenantId: number, query: { page?: number; pageSize?: number; deptId?: number; status?: string; keyword?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, deptId, status, keyword } = query;
    const where: any = { deletedAt: null };
    if (deptId) where.deptId = deptId;
    if (status) where.status = status;
    if (keyword) where.OR = [{ name: { contains: keyword } }, { username: { contains: keyword } }, { phone: { contains: keyword } }];

    const [items, total] = await Promise.all([
      db.user.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, include: { department: { select: { id: true, name: true } }, roles: { include: { role: { select: { id: true, name: true, code: true } } } } } }),
      db.user.count({ where }),
    ]);
    return { items: items.map(this.toVO), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  /** 用户详情 */
  async findOne(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const user = await db.user.findFirst({ where: { id, deletedAt: null }, include: { department: true, roles: { include: { role: true } } } });
    if (!user) throw new NotFoundException({ code: 5, message: '用户不存在' });
    return this.toVO(user);
  }

  /** 创建用户 */
  async create(tenantId: number, data: { username: string; name: string; password: string; phone?: string; email?: string; deptId?: number; position?: string; roleIds?: number[] }) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.user.findFirst({ where: { username: data.username, deletedAt: null } });
    if (existing) throw new ConflictException({ code: 6, message: `用户名 ${data.username} 已存在` });

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await db.user.create({
      data: { tenantId, username: data.username, name: data.name, passwordHash, phone: data.phone, email: data.email, deptId: data.deptId, position: data.position, status: 'active' },
    });
    if (data.roleIds?.length) {
      await db.userRole.createMany({ data: data.roleIds.map((roleId) => ({ tenantId, userId: user.id, roleId })) });
    }
    return this.findOne(tenantId, user.id);
  }

  /** 更新用户 */
  async update(tenantId: number, id: number, data: { name?: string; phone?: string; email?: string; deptId?: number; position?: string; status?: UserStatus; roleIds?: number[] }) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.user.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 5, message: '用户不存在' });

    const { roleIds, ...userData } = data;
    if (Object.keys(userData).length) await db.user.update({ where: { id }, data: userData });
    if (roleIds) {
      await db.userRole.deleteMany({ where: { userId: id } });
      await db.userRole.createMany({ data: roleIds.map((roleId) => ({ tenantId, userId: id, roleId })) });
    }
    return this.findOne(tenantId, id);
  }

  /** 重置密码 */
  async resetPassword(tenantId: number, id: number, newPassword: string) {
    const db = this.prisma.forTenant(tenantId);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.user.update({ where: { id }, data: { passwordHash } });
    return { message: '密码已重置' };
  }

  /** 软删除用户 */
  async remove(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    await db.user.update({ where: { id }, data: { deletedAt: new Date(), status: 'resigned' } });
    return { message: '用户已停用' };
  }

  private toVO(user: any) {
    return {
      id: user.id, username: user.username, name: user.name,
      phone: user.phone ? user.phone.slice(0, 3) + '****' + user.phone.slice(-4) : null,
      email: user.email, avatar: user.avatarUrl,
      dept: user.department ? { id: user.department.id, name: user.department.name } : null,
      position: user.position, status: user.status,
      roles: user.roles?.map((ur: any) => ({ id: ur.role.id, code: ur.role.code, name: ur.role.name })) || [],
      lastLoginAt: user.lastLoginAt, createdAt: user.createdAt,
    };
  }
}
