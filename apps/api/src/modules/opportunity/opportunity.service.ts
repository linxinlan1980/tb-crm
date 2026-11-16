import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../system/audit-logs/audit-log.service';

/**
 * 商机管理服务
 * 9阶段推进 + 加权金额 + 停留预警 + 赢单/输单 + 漏斗统计 + 销售预测
 * 参考文档：crm/02_功能需求PRD/04_商机管理模块PRD.md + crm/11_状态机与事件/状态机定义.md
 */
@Injectable()
export class OpportunityService {
  constructor(private prisma: PrismaService, private auditLog: AuditLogService) {}

  async findAll(tenantId: number, query: { page?: number; pageSize?: number; stage?: string; status?: string; ownerId?: number; customerId?: number; keyword?: string; isKey?: boolean; sort?: string; order?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, stage, status = 'open', ownerId, customerId, keyword, isKey, sort = 'expectedCloseDate', order = 'asc' } = query;
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (stage) where.stage = stage;
    if (ownerId) where.ownerId = ownerId;
    if (customerId) where.customerId = customerId;
    if (isKey) where.isKey = true;
    if (keyword) where.OR = [{ name: { contains: keyword } }, { code: { contains: keyword } }];

    const [items, total] = await Promise.all([
      db.opportunity.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { [sort]: order }, include: { customer: { select: { id: true, name: true, industry: true } } } }),
      db.opportunity.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async findOne(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const opp = await db.opportunity.findFirst({ where: { id, deletedAt: null }, include: { customer: true, products: true, reviews: { orderBy: { createdAt: 'desc' }, take: 5 } } });
    if (!opp) throw new NotFoundException({ code: 5, message: '商机不存在' });
    return opp;
  }

  async create(tenantId: number, userId: number, data: any) {
    const db = this.prisma.forTenant(tenantId);
    const code = await this.generateCode(db);
    const stageConfig = await db.opportunityStage.findFirst({ where: { code: data.stage || 'intention', tenantId } });
    const probability = stageConfig?.probability || 5;
    const weightedAmount = Number(data.amount || 0) * probability / 100;

    const opp = await db.opportunity.create({
      data: { tenantId, code, ...data, stage: data.stage || 'intention', weightedAmount, ownerId: data.ownerId || userId, status: 'open', stageEnteredAt: new Date(), stageHistory: [{ stage: data.stage || 'intention', at: new Date().toISOString(), by: userId }] as any, createdBy: userId },
    });
    await this.auditLog.log({ tenantId, userId, action: 'create', objectType: 'opportunity', objectId: opp.id, objectNo: code });
    return opp;
  }

  /**
   * 阶段推进（核心状态机）
   * 校验required_fields → 更新stage → 重算weighted → 记录history → 发事件
   */
  async advanceStage(tenantId: number, userId: number, id: number, targetStage: string, note?: string) {
    const db = this.prisma.forTenant(tenantId);
    const opp = await db.opportunity.findFirst({ where: { id, deletedAt: null } });
    if (!opp) throw new NotFoundException({ code: 5, message: '商机不存在' });
    if (opp.status !== 'open') throw new BadRequestException({ code: 5005, message: '商机已关闭，不可操作' });

    // 获取目标阶段配置
    const targetConfig = await db.opportunityStage.findFirst({ where: { code: targetStage, tenantId } });
    if (!targetConfig) throw new BadRequestException({ code: 5001, message: `无效阶段: ${targetStage}` });

    // 校验required_fields
    if (targetConfig.requiredFields) {
      const required = targetConfig.requiredFields as string[];
      const missing = required.filter((f) => !opp[f as keyof typeof opp]);
      if (missing.length > 0) {
        throw new BadRequestException({ code: 5001, message: `推进到「${targetConfig.name}」需要填写：${missing.join(', ')}`, data: { missingFields: missing } });
      }
    }

    // 检查是否跳级（只允许推进到相邻下一阶段，跳级需审批）
    const currentOrder = (await db.opportunityStage.findFirst({ where: { code: opp.stage, tenantId } }))?.sortOrder || 1;
    if (targetConfig.sortOrder > currentOrder + 1) {
      // 跳级 - 一期简化：允许但记录
      // TODO S5: 跳级需审批
    }

    // 执行推进
    const weightedAmount = Number(opp.amount) * targetConfig.probability / 100;
    const history = [...(opp.stageHistory as any[] || []), { stage: targetStage, at: new Date().toISOString(), by: userId, note }];

    const updated = await db.opportunity.update({
      where: { id },
      data: { stage: targetStage, stageEnteredAt: new Date(), weightedAmount, stageHistory: history as any, stageStallDays: 0 },
    });

    // 如果推进到签约阶段，提示创建合同
    // 如果推进到delivery，提示立项
    await this.auditLog.log({ tenantId, userId, action: 'advance_stage', objectType: 'opportunity', objectId: id, objectNo: opp.code, beforeData: { stage: opp.stage }, afterData: { stage: targetStage } });

    return { ...updated, previousStage: opp.stage, message: `商机已推进到「${targetConfig.name}」阶段` };
  }

  /** 标记赢单 */
  async win(tenantId: number, userId: number, id: number, contractId?: number) {
    const db = this.prisma.forTenant(tenantId);
    const opp = await db.opportunity.findFirst({ where: { id, status: 'open', deletedAt: null } });
    if (!opp) throw new BadRequestException({ code: 5005, message: '商机不存在或已关闭' });
    // 一期简化：不强制要求关联合同（contractId可选）
    const updated = await db.opportunity.update({ where: { id }, data: { status: 'won', winDate: new Date(), stage: 'closed', contractId: contractId || null, weightedAmount: Number(opp.amount) } });
    await this.auditLog.log({ tenantId, userId, action: 'win', objectType: 'opportunity', objectId: id, objectNo: opp.code });
    return updated;
  }

  /** 标记输单 */
  async lose(tenantId: number, userId: number, id: number, lossReason: string, lossDetail?: string) {
    const db = this.prisma.forTenant(tenantId);
    if (!lossReason) throw new BadRequestException({ code: 5004, message: '标记输单必须选择原因' });
    const opp = await db.opportunity.findFirst({ where: { id, status: 'open', deletedAt: null } });
    if (!opp) throw new BadRequestException({ code: 5005, message: '商机不存在或已关闭' });
    const updated = await db.opportunity.update({ where: { id }, data: { status: 'lost', lossReason, lossDetail, weightedAmount: 0 } });
    await this.auditLog.log({ tenantId, userId, action: 'lose', objectType: 'opportunity', objectId: id, objectNo: opp.code, afterData: { lossReason } });
    return updated;
  }

  /** 销售漏斗统计 */
  async getFunnel(tenantId: number, ownerId?: number) {
    const db = this.prisma.forTenant(tenantId);
    const where: any = { status: 'open', deletedAt: null };
    if (ownerId) where.ownerId = ownerId;

    const stages = await db.opportunityStage.findMany({ where: { tenantId, isActive: true }, orderBy: { sortOrder: 'asc' } });
    const opps = await db.opportunity.findMany({ where, select: { stage: true, amount: true, weightedAmount: true, id: true } });

    return stages.map((s) => {
      const stageOpps = opps.filter((o) => o.stage === s.code);
      return { stage: s.code, name: s.name, color: s.color, probability: s.probability, count: stageOpps.length, amount: stageOpps.reduce((sum, o) => sum + Number(o.amount), 0), weightedAmount: stageOpps.reduce((sum, o) => sum + Number(o.weightedAmount), 0) };
    });
  }

  /** 销售预测（三档） */
  async getForecast(tenantId: number, period?: string) {
    const db = this.prisma.forTenant(tenantId);
    const opps = await db.opportunity.findMany({ where: { status: 'open', deletedAt: null }, select: { stage: true, amount: true, weightedAmount: true, expectedCloseDate: true, ownerId: true } });
    const stages = await db.opportunityStage.findMany({ where: { tenantId, isActive: true } });
    const stageMap = new Map(stages.map((s) => [s.code, s.probability]));

    // 乐观：所有open商机按概率加权
    const optimistic = opps.reduce((sum, o) => sum + Number(o.weightedAmount), 0);
    // 基准：≥negotiation阶段的商机
    const baselineStages = ['negotiation', 'signing', 'delivery', 'acceptance'];
    const baseline = opps.filter((o) => baselineStages.includes(o.stage)).reduce((sum, o) => sum + Number(o.weightedAmount), 0);
    // 保守：仅signing+阶段
    const conservativeStages = ['signing', 'delivery', 'acceptance'];
    const conservative = opps.filter((o) => conservativeStages.includes(o.stage)).reduce((sum, o) => sum + Number(o.amount), 0) * 0.8;

    // 按负责人分解
    const byOwner: Record<number, { confirmed: number; pipeline: number }> = {};
    for (const o of opps) {
      if (!byOwner[o.ownerId]) byOwner[o.ownerId] = { confirmed: 0, pipeline: 0 };
      if (baselineStages.includes(o.stage)) byOwner[o.ownerId].confirmed += Number(o.weightedAmount);
      else byOwner[o.ownerId].pipeline += Number(o.weightedAmount);
    }

    return { period: period || 'current', optimistic, baseline, conservative, byOwner };
  }

  /** 停滞商机列表 */
  async findStalled(tenantId: number) {
    const db = this.prisma.forTenant(tenantId);
    const opps = await db.opportunity.findMany({ where: { status: 'open', deletedAt: null }, include: { customer: { select: { name: true } } } });
    const stages = await db.opportunityStage.findMany({ where: { tenantId } });
    const stageMap = new Map(stages.map((s) => [s.code, s.stallThresholdDays]));

    return opps
      .map((o) => ({ ...o, threshold: stageMap.get(o.stage) || 30, isStalled: o.stageStallDays > (stageMap.get(o.stage) || 30) }))
      .filter((o) => o.isStalled)
      .sort((a, b) => b.stageStallDays - a.stageStallDays);
  }

  private async generateCode(db: any): Promise<string> {
    const now = new Date();
    const prefix = `SJ${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const last = await db.opportunity.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } });
    const seq = last ? parseInt(last.code.slice(-3)) + 1 : 1;
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }
}
