import { customerScope, ownerScope } from '../workspace/access';
import { Prisma } from '@prisma/client';
import type { Actor } from '../../common/types/actor';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../system/audit-logs/audit-log.service';

@Injectable()
export class CustomerService {
  constructor(private prisma: PrismaService, private auditLog: AuditLogService) {}

  /**
   * 客户列表（分页+筛选+排序）
   * 数据权限由Controller层注入ownerId/deptId过滤
   */
  async findAll(tenantId: number, query: {
    page?: number; pageSize?: number; poolType?: string; industry?: string;
    level?: string; ownerId?: number; status?: string; keyword?: string;
    tag?: string; sort?: string; order?: 'asc' | 'desc';
  }, actor: Actor) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, poolType, industry, level, ownerId, status, keyword, tag, sort = 'lastFollowAt', order = 'desc' } = query;

    const where: any = { deletedAt: null, AND: [await customerScope(this.prisma.system, actor)] };
    if (poolType) where.poolType = poolType;
    if (industry) where.industry = industry;
    if (level) where.level = level;
    if (ownerId) where.ownerId = ownerId;
    if (status) where.status = status;
    if (keyword) where.OR = [{ name: { contains: keyword } }, { shortName: { contains: keyword } }, { code: { contains: keyword } }];
    if (tag) where.tags = { array_contains: tag };

    if (!['lastFollowAt', 'createdAt', 'contractAmount', 'protectUntil', 'name', 'code'].includes(sort)) {
      throw new BadRequestException({ code: 11, message: '不支持的排序字段' });
    }
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new BadRequestException({ code: 12, message: '分页参数无效' });
    }
    const orderBy = { [sort]: order === 'asc' ? 'asc' : 'desc' } as const;
    const [items, total] = await Promise.all([
      db.customer.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy }),
      db.customer.count({ where }),
    ]);

    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  /** 客户详情（360°视图含统计） */
  async findOne(tenantId: number, id: number, actor: Actor) {
    const db = this.prisma.forTenant(tenantId);
    const customer = await db.customer.findFirst({
      where: { id, deletedAt: null, AND: [await customerScope(this.prisma.system, actor)] },
      include: { contacts: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' } } },
    });
    if (!customer) throw new NotFoundException({ code: 5, message: '客户不存在' });

    const owned = await ownerScope(this.prisma.system, actor);
    const projectVisibility = Object.keys(owned).length
      ? { OR: [
          await ownerScope(this.prisma.system, actor, 'salesOwnerId'),
          await ownerScope(this.prisma.system, actor, 'pmId'),
        ] }
      : {};
    // 聚合统计
    const [openOpps, activeContracts, totalReceived, activeProjects] = await Promise.all([
      db.opportunity.count({ where: { customerId: id, status: 'open', deletedAt: null, ...owned } }),
      db.contract.count({ where: { customerId: id, status: { in: ['signed', 'executing'] }, deletedAt: null, ...owned } }),
      db.paymentPlan.aggregate({ where: { contract: { customerId: id, ...owned }, status: { not: 'cancelled' } }, _sum: { receivedAmount: true } }),
      db.project.count({ where: { customerId: id, status: 'active', deletedAt: null, ...projectVisibility } }),
    ]);

    return {
      ...customer,
      _stats: {
        openOpportunities: openOpps,
        activeContracts,
        totalReceived: new Prisma.Decimal(String(totalReceived._sum.receivedAmount || 0)).toString(),
        totalOutstanding: new Prisma.Decimal(customer.contractAmount).sub(String(totalReceived._sum.receivedAmount || 0)).toString(),
        activeProjects,
        contactCount: customer.contacts.length,
      },
    };
  }

  /**
   * 创建客户
   * 业务规则：自动生成编码 + 去重校验（信用代码精确 + 名称模糊）
   */
  async create(tenantId: number, userId: number, data: any) {
    const db = this.prisma.forTenant(tenantId);

    // 去重校验
    if (data.creditCode) {
      const existing = await db.customer.findFirst({ where: { creditCode: data.creditCode, deletedAt: null } });
      if (existing) throw new ConflictException({ code: 2001, message: `该客户已存在（统一社会信用代码匹配）：${existing.name}`, data: { existingId: existing.id } });
    }
    const nameCheck = await this.checkDuplicateName(db, data.name);
    if (nameCheck) throw new ConflictException({ code: 2002, message: `疑似重复客户：${nameCheck.name}，请确认是否合并`, data: { existingId: nameCheck.id, existingName: nameCheck.name } });

    // 生成编码 KH+YYYYMM+3位序号
    const code = await this.generateCode(db);

    // 确定池类型和负责人
    const poolType = data.ownerId ? 'private' : 'public';
    const protectUntil = data.ownerId ? this.calcProtectUntil(30) : null;

    const customer = await db.customer.create({
      data: { tenantId, code, ...data, poolType, protectUntil, createdBy: userId, updatedBy: userId },
    });

    // 如果有联系人数据，一并创建
    if (data.contacts?.length) {
      await db.contact.createMany({ data: data.contacts.map((c: any) => ({ ...c, tenantId, customerId: customer.id, createdBy: userId })) });
    }

    // 如果在私海，创建holding记录
    if (data.ownerId) {
      await db.privateHolding.create({ data: { tenantId, userId: data.ownerId, customerId: customer.id, claimedAt: new Date(), protectUntil: protectUntil! } });
    }

    // 审计日志
    await this.auditLog.log({ tenantId, userId, action: 'create', objectType: 'customer', objectId: customer.id, objectNo: code, afterData: { name: data.name, industry: data.industry } });

    return customer;
  }

  /** 更新客户 */
  async update(tenantId: number, userId: number, id: number, data: any) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.customer.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 5, message: '客户不存在' });

    const updated = await db.customer.update({ where: { id }, data: { ...data, updatedBy: userId } });
    await this.auditLog.log({ tenantId, userId, action: 'update', objectType: 'customer', objectId: id, objectNo: existing.code, beforeData: { name: existing.name, level: existing.level }, afterData: { name: data.name, level: data.level } });
    return updated;
  }

  /** 软删除客户 */
  async remove(tenantId: number, userId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const existing = await db.customer.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException({ code: 5, message: '客户不存在' });
    // 检查是否有活跃商机/未结合同
    const openOpps = await db.opportunity.count({ where: { customerId: id, status: 'open', deletedAt: null } });
    if (openOpps > 0) throw new BadRequestException({ code: 2003, message: '该客户有进行中的商机，不可删除' });
    const activeContracts = await db.contract.count({ where: { customerId: id, status: { in: ['signed', 'executing'] }, deletedAt: null } });
    if (activeContracts > 0) throw new BadRequestException({ code: 2004, message: '该客户有未结合同，不可删除' });

    await db.customer.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
    await this.auditLog.log({ tenantId, userId, action: 'delete', objectType: 'customer', objectId: id, objectNo: existing.code });
    return { message: '已删除（回收站保留90天）' };
  }

  /** 去重校验（不创建，仅检查） */
  async checkDuplicate(tenantId: number, data: { name?: string; creditCode?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const results: any[] = [];
    if (data.creditCode) {
      const exact = await db.customer.findFirst({ where: { creditCode: data.creditCode, deletedAt: null } });
      if (exact) results.push({ type: 'credit_code_exact', customer: exact });
    }
    if (data.name) {
      const fuzzy = await this.checkDuplicateName(db, data.name);
      if (fuzzy) results.push({ type: 'name_fuzzy', customer: fuzzy });
    }
    return { isDuplicate: results.length > 0, matches: results };
  }

  /** 集团-子公司树 */
  async getGroupTree(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const groups = await db.customer.findMany({ where: { deletedAt: null, groupId: null, id: { not: undefined } }, select: { id: true, name: true, code: true, industry: true, level: true, contractAmount: true } });
    // 找所有有group_id的客户（子公司）
    const children = await db.customer.findMany({ where: { deletedAt: null, groupId: { not: null } }, select: { id: true, name: true, code: true, groupId: true, contractAmount: true } });

    // 构建：只返回实际作为集团被引用的客户
    const groupIds = [...new Set(children.map((c) => c.groupId).filter(Boolean))] as number[];
    const groupCustomers = await db.customer.findMany({ where: { id: { in: groupIds }, deletedAt: null }, select: { id: true, name: true, code: true, industry: true, level: true, contractAmount: true, contractCount: true } });

    return groupCustomers.map((g) => ({
      ...g,
      children: children.filter((c) => c.groupId === g.id),
      _stats: { childCount: children.filter((c) => c.groupId === g.id).length, totalAmount: children.filter((c) => c.groupId === g.id).reduce((sum, c) => sum + Number(c.contractAmount), 0) + Number(g.contractAmount) },
    }));
  }

  /** 客户统计（合同额/回款/商机数） */
  async getStatistics(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const [contracts, opps, received] = await Promise.all([
      db.contract.aggregate({ where: { customerId: id, status: { notIn: ['draft', 'rejected'] }, deletedAt: null }, _count: true, _sum: { amount: true } }),
      db.opportunity.groupBy({ by: ['status'], where: { customerId: id, deletedAt: null }, _count: true, _sum: { amount: true } }),
      db.paymentPlan.aggregate({ where: { contract: { customerId: id }, status: { not: 'cancelled' } }, _sum: { receivedAmount: true, amount: true } }),
    ]);
    return {
      contractCount: contracts._count, contractAmount: contracts._sum.amount || 0,
      opportunities: opps, totalPlanAmount: received._sum.amount || 0, totalReceived: received._sum.receivedAmount || 0,
    };
  }

  // ===== Private =====

  /** 编码生成：KH + YYYYMM + 3位序号 */
  private async generateCode(db: any): Promise<string> {
    const now = new Date();
    const prefix = `KH${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const last = await db.customer.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } });
    const seq = last ? parseInt(last.code.slice(-3)) + 1 : 1;
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }

  /** 名称模糊去重：去除"有限公司/股份/集团/科技/技术"后比较 */
  private async checkDuplicateName(db: any, name: string) {
    const normalized = name.replace(/(有限公司|股份|集团|科技|技术|有限责任)/g, '').trim();
    if (normalized.length < 2) return null;
    const candidates = await db.customer.findMany({ where: { deletedAt: null, name: { contains: normalized.slice(0, 4) } }, take: 5, select: { id: true, name: true } });
    return candidates.find((c: any) => c.name.replace(/(有限公司|股份|集团|科技|技术|有限责任)/g, '').includes(normalized.slice(0, 4))) || null;
  }

  /** 计算保护期截止日 */
  private calcProtectUntil(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
  }
}
