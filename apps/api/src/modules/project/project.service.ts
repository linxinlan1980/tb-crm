import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../system/audit-logs/audit-log.service';

/**
 * 交付项目管理服务
 * 立项→里程碑→任务→工时→验收→结项
 * 核心联动：里程碑完成→触发合同里程碑→触发回款
 * 参考文档：crm/02_功能需求PRD/08_交付项目管理模块PRD.md
 */
@Injectable()
export class ProjectService {
  constructor(private prisma: PrismaService, private auditLog: AuditLogService) {}

  async findAll(tenantId: number, query: { page?: number; pageSize?: number; status?: string; stage?: string; pmId?: number; customerId?: number; keyword?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, status, stage, pmId, customerId, keyword } = query;
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (stage) where.stage = stage;
    if (pmId) where.pmId = pmId;
    if (customerId) where.customerId = customerId;
    if (keyword) where.OR = [{ name: { contains: keyword } }, { projectNo: { contains: keyword } }];

    const [items, total] = await Promise.all([
      db.project.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, include: { customer: { select: { id: true, name: true } }, milestones: { where: { status: { not: 'cancelled' } }, select: { id: true, name: true, status: true, weight: true } } } }),
      db.project.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async findOne(tenantId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    const project = await db.project.findFirst({ where: { id, deletedAt: null }, include: { customer: true, milestones: { orderBy: { sortOrder: 'asc' } }, tasks: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } }, documents: { orderBy: { uploadedAt: 'desc' } } } });
    if (!project) throw new NotFoundException({ code: 5, message: '项目不存在' });
    return project;
  }

  /** 创建项目/立项 */
  async create(tenantId: number, userId: number, data: any) {
    const db = this.prisma.forTenant(tenantId);
    const projectNo = await this.generateNo(db);
    const project = await db.project.create({
      data: { tenantId, projectNo, name: data.name, contractId: data.contractId, customerId: data.customerId, opportunityId: data.opportunityId, projectType: data.projectType || 'implementation', stage: 'initiation', status: 'pending_approval', pmId: data.pmId || userId, salesOwnerId: data.salesOwnerId, teamIds: data.teamIds, budgetAmount: data.budgetAmount, budgetManDays: data.budgetManDays, manDayCost: data.manDayCost || 1500, plannedStartDate: data.plannedStartDate, plannedEndDate: data.plannedEndDate, priority: data.priority || 'medium', remark: data.remark, createdBy: userId },
    });
    await this.auditLog.log({ tenantId, userId, action: 'create', objectType: 'project', objectId: project.id, objectNo: projectNo });
    return project;
  }

  /** 审批通过后激活项目 + 实例化项目里程碑 */
  async activate(tenantId: number, projectId: number) {
    const db = this.prisma.forTenant(tenantId);
    const project = await db.project.findFirst({ where: { id: projectId } });
    if (!project) throw new NotFoundException({ code: 5, message: '项目不存在' });

    await db.project.update({ where: { id: projectId }, data: { status: 'active', actualStartDate: new Date() } });

    // 从合同里程碑同步到项目里程碑
    if (project.contractId) {
      const contractMilestones = await db.contractMilestone.findMany({ where: { contractId: project.contractId }, orderBy: { sortOrder: 'asc' } });
      for (const cm of contractMilestones) {
        await db.projectMilestone.create({
          data: { tenantId, projectId, contractMilestoneId: cm.id, name: cm.name, stage: this.mapMilestoneToStage(cm.name), sortOrder: cm.sortOrder, weight: Math.round(100 / contractMilestones.length), plannedDate: cm.plannedDate, status: 'pending', deliverables: cm.deliverables },
        });
      }
    }
    return { message: '项目已激活，里程碑已实例化' };
  }

  /** 确认项目里程碑完成（联动合同里程碑+回款） */
  async completeMilestone(tenantId: number, userId: number, milestoneId: number, data: { actualDate: string; attachmentIds?: any[] }) {
    const db = this.prisma.forTenant(tenantId);
    const ms = await db.projectMilestone.findFirst({ where: { id: milestoneId } });
    if (!ms) throw new NotFoundException({ code: 5, message: '里程碑不存在' });

    await db.projectMilestone.update({ where: { id: milestoneId }, data: { status: 'completed', actualDate: new Date(data.actualDate), completedBy: userId, completedAt: new Date(), attachmentIds: data.attachmentIds as any } });

    // 联动合同里程碑
    if (ms.contractMilestoneId) {
      const { MilestoneService } = await import('../contract/milestone/milestone.service');
      // 直接更新合同里程碑（避免循环依赖，用prisma直接操作）
      await db.contractMilestone.update({ where: { id: ms.contractMilestoneId }, data: { status: 'completed', actualDate: new Date(data.actualDate), completedBy: userId, completedAt: new Date() } });
      // TODO: 触发回款计划due_date设置（通过事件或直接调用）
    }

    // 重算项目进度
    await this.recalcProgress(db, ms.projectId);

    // 检查是否所有里程碑完成→可推进阶段
    const allMs = await db.projectMilestone.findMany({ where: { projectId: ms.projectId } });
    const allDone = allMs.every((m) => m.id === milestoneId ? true : ['completed', 'cancelled'].includes(m.status));
    if (allDone) {
      await this.advanceStage(db, ms.projectId);
    }

    return { milestoneId, status: 'completed', message: '里程碑已完成' };
  }

  /** 工时审核通过后重算项目成本 */
  async recalcCost(tenantId: number, projectId: number) {
    const db = this.prisma.forTenant(tenantId);
    const result = await db.timesheet.aggregate({ where: { projectId, status: 'approved' }, _sum: { manDays: true } });
    const actualManDays = Number(result._sum.manDays || 0);
    const project = await db.project.findFirst({ where: { id: projectId } });
    if (!project) return;
    const manDayCost = Number(project.manDayCost || 1500);
    const actualCost = actualManDays * manDayCost + Number(project.outsourceCost) + Number(project.travelCost);
    const budgetAmount = Number(project.budgetAmount || 0);
    const grossMargin = budgetAmount > 0 ? Number(((budgetAmount - actualCost) / budgetAmount * 100).toFixed(2)) : null;
    await db.project.update({ where: { id: projectId }, data: { actualManDays, actualCost, grossMargin } });
  }

  /** 验收结项 */
  async close(tenantId: number, userId: number, projectId: number, data: { acceptanceDate?: string; satisfactionScore?: number; closureNote?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const project = await db.project.findFirst({ where: { id: projectId, status: 'active' } });
    if (!project) throw new BadRequestException({ code: 10005, message: '项目不存在或非活跃状态' });

    await db.project.update({ where: { id: projectId }, data: { status: 'completed', stage: 'closed', actualEndDate: new Date(), acceptanceDate: data.acceptanceDate ? new Date(data.acceptanceDate) : new Date(), satisfactionScore: data.satisfactionScore, closureNote: data.closureNote, progress: 100 } });

    // 联动商机→结项
    if (project.opportunityId) {
      await db.opportunity.update({ where: { id: project.opportunityId }, data: { stage: 'closed', status: 'won' } }).catch(() => {});
    }

    await this.auditLog.log({ tenantId, userId, action: 'close_project', objectType: 'project', objectId: projectId, objectNo: project.projectNo });
    return { message: '项目已结项归档' };
  }

  /** PM工作台数据 */
  async getWorkbench(tenantId: number, pmId: number) {
    const db = this.prisma.forTenant(tenantId);
    const [myProjects, pendingTimesheets, upcomingMilestones, delayedMilestones] = await Promise.all([
      db.project.findMany({ where: { pmId, status: 'active', deletedAt: null }, select: { id: true, name: true, stage: true, progress: true, healthStatus: true, plannedEndDate: true } }),
      db.timesheet.count({ where: { status: 'submitted', project: { pmId } } }),
      db.projectMilestone.findMany({ where: { project: { pmId }, status: { in: ['pending', 'in_progress'] }, plannedDate: { lte: new Date(Date.now() + 7 * 86400000) } }, take: 10, orderBy: { plannedDate: 'asc' } }),
      db.projectMilestone.findMany({ where: { project: { pmId }, status: 'delayed' }, take: 10 }),
    ]);
    return { myProjects, pendingTimesheets, upcomingMilestones, delayedMilestones };
  }

  // ===== Private =====

  private async recalcProgress(db: any, projectId: number) {
    const milestones = await db.projectMilestone.findMany({ where: { projectId } });
    const totalWeight = milestones.reduce((s: number, m: any) => s + m.weight, 0);
    const completedWeight = milestones.filter((m: any) => m.status === 'completed').reduce((s: number, m: any) => s + m.weight, 0);
    const progress = totalWeight > 0 ? Math.round(completedWeight / totalWeight * 100) : 0;
    await db.project.update({ where: { id: projectId }, data: { progress } });
  }

  private async advanceStage(db: any, projectId: number) {
    const stageOrder = ['initiation', 'blueprint', 'development', 'testing', 'go_live', 'acceptance', 'maintenance', 'closed'];
    const project = await db.project.findFirst({ where: { id: projectId } });
    if (!project) return;
    const currentIdx = stageOrder.indexOf(project.stage);
    if (currentIdx < stageOrder.length - 1) {
      await db.project.update({ where: { id: projectId }, data: { stage: stageOrder[currentIdx + 1], stageEnteredAt: new Date() } });
    }
  }

  private mapMilestoneToStage(name: string): string {
    if (name.includes('启动') || name.includes('签约')) return 'initiation';
    if (name.includes('蓝图')) return 'blueprint';
    if (name.includes('开发') || name.includes('配置')) return 'development';
    if (name.includes('测试') || name.includes('UAT')) return 'testing';
    if (name.includes('上线')) return 'go_live';
    if (name.includes('验收')) return 'acceptance';
    if (name.includes('运维') || name.includes('移交')) return 'maintenance';
    return 'development';
  }

  private async generateNo(db: any): Promise<string> {
    const now = new Date();
    const prefix = `XM${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const last = await db.project.findFirst({ where: { projectNo: { startsWith: prefix } }, orderBy: { projectNo: 'desc' }, select: { projectNo: true } });
    const seq = last ? parseInt(last.projectNo.slice(-3)) + 1 : 1;
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }
}
