import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ContactService {
  constructor(private prisma: PrismaService) {}

  async findByCustomer(tenantId: number, customerId: number) {
    const db = this.prisma.forTenant(tenantId);
    return db.contact.findMany({ where: { customerId, deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] });
  }

  async create(tenantId: number, userId: number, customerId: number, data: any) {
    const db = this.prisma.forTenant(tenantId);
    // 主要联系人唯一性校验
    if (data.isPrimary) {
      await db.contact.updateMany({ where: { customerId, isPrimary: true }, data: { isPrimary: false } });
    }
    return db.contact.create({ data: { tenantId, customerId, ...data, createdBy: userId } });
  }

  async update(tenantId: number, id: number, data: any) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.contact.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 5, message: '联系人不存在' });
    if (data.isPrimary) {
      await db.contact.updateMany({ where: { customerId: existing.customerId, isPrimary: true, id: { not: id } }, data: { isPrimary: false } });
    }
    return db.contact.update({ where: { id }, data });
  }

  async remove(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    await db.contact.update({ where: { id }, data: { deletedAt: new Date() } });
    return { message: '已删除' };
  }
}
