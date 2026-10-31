import type { FollowMethod, LeadFollowResult } from '@prisma/client';
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../system/audit-logs/audit-log.service';

/**
 * 线索管理服务
 * 覆盖：多渠道采集→清洗去重→评分→分配→跟进→转化/拒绝/过期
 * 参考文档：crm/02_功能需求PRD/02_线索管理模块PRD.md
 */
@Injectable()
export class LeadService {
  constructor(private prisma: PrismaService, private auditLog: AuditLogService) {}

  async findAll(tenantId: number, query: { page?: number; pageSize?: number; status?: string; source?: string; assigneeId?: number; keyword?: string; scoreMin?: number; scoreMax?: number }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, status, source, assigneeId, keyword, scoreMin, scoreMax } = query;
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (source) where.source = source;
    if (assigneeId) where.assigneeId = assigneeId;
    if (keyword) where.OR = [{ companyName: { contains: keyword } }, { contactName: { contains: keyword } }, { code: { contains: keyword } }];
    if (scoreMin != null) where.score = { ...(where.score || {}), gte: scoreMin };
    if (scoreMax != null) where.score = { ...(where.score || {}), lte: scoreMax };

    const [items, total] = await Promise.all([
      db.lead.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      db.lead.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async findOne(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const lead = await db.lead.findFirst({ where: { id, deletedAt: null }, include: { followUps: { orderBy: { createdAt: 'desc' }, take: 20 } } });
    if (!lead) throw new NotFoundException({ code: 5, message: '线索不存在' });
    return lead;
  }

  /** 创建线索 + 自动去重 + 自动评分 */
  async create(tenantId: number, userId: number, data: any) {
    const db = this.prisma.forTenant(tenantId);

    // 去重校验
    const duplicate = await this.checkDuplicate(db, data);
    if (duplicate) throw new ConflictException({ code: 3001, message: `重复线索：${duplicate.companyName}已存在`, data: { existingId: duplicate.id } });

    // 生成编码
    const code = await this.generateCode(db);

    // 自动评分
    const score = this.calculateScore(data);
    const scoreDetail = this.getScoreDetail(data);

    // 确定初始状态
    let status: string = 'new';
    if (score >= 60) status = 'qualified';
    else if (score < 30) status = 'unqualified';

    const lead = await db.lead.create({
      data: { tenantId, code, ...data, score, scoreDetail: scoreDetail as any, status, createdBy: userId },
    });

    await this.auditLog.log({ tenantId, userId, action: 'create', objectType: 'lead', objectId: lead.id, objectNo: code });
    return lead;
  }

  /** 重新评分 */
  async rescore(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const lead = await db.lead.findFirst({ where: { id, deletedAt: null } });
    if (!lead) throw new NotFoundException({ code: 5, message: '线索不存在' });

    const score = this.calculateScore(lead);
    const scoreDetail = this.getScoreDetail(lead);
    let status = lead.status;
    if (lead.status === 'new' || lead.status === 'cleaning') {
      status = score >= 60 ? 'qualified' : score < 30 ? 'unqualified' : 'new';
    }
    return db.lead.update({ where: { id }, data: { score, scoreDetail: scoreDetail as any, status } });
  }

  /** 分配线索 */
  async assign(tenantId: number, managerId: number, leadId: number, assigneeId: number) {
    const db = this.prisma.forTenant(tenantId);
    const lead = await db.lead.findFirst({ where: { id: leadId, deletedAt: null } });
    if (!lead) throw new NotFoundException({ code: 5, message: '线索不存在' });
    if (lead.status !== 'qualified' && lead.status !== 'new') throw new BadRequestException({ code: 3006, message: '只有合格/新线索可分配' });

    return db.lead.update({ where: { id: leadId }, data: { status: 'assigned', assigneeId, assignedAt: new Date() } });
  }

  /** 线索转客户（+可选转商机） */
  async convert(tenantId: number, userId: number, leadId: number, options: { createOpportunity?: boolean; oppName?: string; oppAmount?: number }) {
    const db = this.prisma.forTenant(tenantId);
    const lead = await db.lead.findFirst({ where: { id: leadId, deletedAt: null } });
    if (!lead) throw new NotFoundException({ code: 5, message: '线索不存在' });
    if (lead.status === 'converted') throw new BadRequestException({ code: 3004, message: '该线索已转化，不可重复操作' });
    if (lead.status !== 'assigned') throw new BadRequestException({ code: 3006, message: '线索未分配，不可转化' });
    if (lead.followCount < 1) throw new BadRequestException({ code: 3003, message: '转化前至少需要1次跟进记录' });

    // 创建客户
    const customerCode = await this.generateCustomerCode(db);
    const protectUntil = new Date(); protectUntil.setDate(protectUntil.getDate() + 30);
    const customer = await db.customer.create({
      data: {
        tenantId, code: customerCode, name: lead.companyName, industry: lead.industry,
        region: lead.region, source: lead.source, poolType: 'private', ownerId: userId,
        protectUntil, creditCode: lead.creditCode, employeeCount: lead.employeeCount,
        isProspect: true, status: 'active', createdBy: userId,
      },
    });

    // 创建联系人
    if (lead.contactName) {
      await db.contact.create({ data: { tenantId, customerId: customer.id, name: lead.contactName, phone: lead.contactPhone, email: lead.contactEmail, title: lead.contactTitle, isPrimary: true, createdBy: userId } });
    }

    // 创建私海holding
    await db.privateHolding.create({ data: { tenantId, userId, customerId: customer.id, claimedAt: new Date(), protectUntil } });

    // 可选：创建商机
    let opportunityId: number | null = null;
    if (options.createOpportunity) {
      const oppCode = `SJ${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}001`; // 简化
      const opp = await db.opportunity.create({
        data: { tenantId, code: oppCode, name: options.oppName || `${lead.companyName}-初步商机`, customerId: customer.id, leadId: lead.id, ownerId: userId, stage: 'intention', amount: options.oppAmount || 0, status: 'open', source: '线索转化', createdBy: userId },
      });
      opportunityId = opp.id;
    }

    // 更新线索状态
    await db.lead.update({ where: { id: leadId }, data: { status: 'converted', convertedCustomerId: customer.id, convertedOpportunityId: opportunityId, convertedAt: new Date() } });

    await this.auditLog.log({ tenantId, userId, action: 'convert', objectType: 'lead', objectId: leadId, objectNo: lead.code, afterData: { customerId: customer.id, opportunityId } });

    return { leadId, customerId: customer.id, customerCode, opportunityId, message: '线索已转化为客户' + (opportunityId ? '+商机' : '') };
  }

  /** 标记不合格/拒绝 */
  async reject(tenantId: number, userId: number, leadId: number, reason: string) {
    const db = this.prisma.forTenant(tenantId);
    return db.lead.update({ where: { id: leadId }, data: { status: 'rejected', rejectReason: reason, qualityFlag: 'not_target' } });
  }

  /** 创建线索跟进记录 */
  async createFollowUp(tenantId: number, userId: number, leadId: number, data: { method: FollowMethod; content: string; result?: LeadFollowResult; nextAction?: string; nextFollowAt?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const followUp = await db.leadFollowUp.create({ data: { tenantId, leadId, ...data, createdBy: userId } });
    await db.lead.update({ where: { id: leadId }, data: { followCount: { increment: 1 }, lastFollowAt: new Date() } });
    return followUp;
  }

  // ===== 评分引擎 =====

  private calculateScore(data: any): number {
    let score = 0;
    // 来源质量 (25分)
    const sourceWeights: Record<string, number> = { referral: 25, yonyou_assign: 22, partner: 20, exhibition: 18, website: 15, import: 12, gongshang: 10, ad_baidu: 10, email: 8, wechat: 8, ad_douyin: 8, cold_call: 5 };
    score += sourceWeights[data.source] || 10;
    // 行业匹配 (20分)
    const targetIndustries = ['制造/工业', '期货/金融', '医院/医疗', '餐饮', 'IT/互联网', '建筑/房地产'];
    score += targetIndustries.includes(data.industry) ? 20 : 5;
    // 企业规模 (15分)
    const sizeScores: Record<string, number> = { '>1000': 15, '500-1000': 13, '200-500': 12, '50-200': 8, '<50': 4 };
    score += sizeScores[data.employeeCount] || 8;
    // 需求明确度 (20分)
    if (data.demand && data.budgetRange && data.expectedTime) score += 20;
    else if (data.demand) score += 12;
    else score += 4;
    // 区域匹配 (10分) - 简化：有区域=10
    score += data.region ? 10 : 3;
    // 行为加分 (10分) - 初始为0
    return Math.min(score, 100);
  }

  private getScoreDetail(data: any) {
    return { source: 0, industry: 0, size: 0, demand: 0, region: 0, behavior: 0, total: this.calculateScore(data) };
  }

  private async checkDuplicate(db: any, data: any) {
    if (data.creditCode) {
      const exact = await db.lead.findFirst({ where: { creditCode: data.creditCode, deletedAt: null } });
      if (exact) return exact;
    }
    if (data.companyName) {
      const normalized = data.companyName.replace(/(有限公司|股份|集团|科技|技术)/g, '');
      const existing = await db.lead.findFirst({ where: { companyName: { contains: normalized.slice(0, 4) }, deletedAt: null } });
      if (existing) return existing;
    }
    return null;
  }

  private async generateCode(db: any): Promise<string> {
    const now = new Date();
    const prefix = `XS${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const last = await db.lead.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } });
    const seq = last ? parseInt(last.code.slice(-3)) + 1 : 1;
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }

  private async generateCustomerCode(db: any): Promise<string> {
    const now = new Date();
    const prefix = `KH${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const last = await db.customer.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } });
    const seq = last ? parseInt(last.code.slice(-3)) + 1 : 1;
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }
}
