import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * 审批引擎服务
 * 核心流程：发起→匹配审批流→创建节点→逐节点流转→全部通过/驳回→回调业务对象
 * 参考文档：crm/02_功能需求PRD/ + crm/11_状态机与事件/状态机定义.md §10
 *
 * 审批流匹配逻辑：
 * 1. 按biz_type查找所有active的approval_flows
 * 2. 按priority降序排列
 * 3. 逐条评估condition_expr（简单表达式：amount >= 200000）
 * 4. 命中第一条即停止
 * 5. 无命中→无需审批（直接通过）
 */
@Injectable()
export class ApprovalService {
  constructor(private prisma: PrismaService) {}

  /** 发起审批 */
  async create(tenantId: number, applicantId: number, data: { bizType: string; bizId: number; bizNo?: string; title: string; formData?: any; amount?: number }) {
    const db = this.prisma.forTenant(tenantId);

    // 检查是否已有进行中的审批（幂等）
    const existing = await db.approval.findFirst({ where: { bizType: data.bizType, bizId: data.bizId, status: 'pending' } });
    if (existing) throw new BadRequestException({ code: 11007, message: '该业务对象已有进行中的审批，不可重复发起' });

    // 匹配审批流
    const flow = await this.matchFlow(db, tenantId, data.bizType, data.amount || 0);
    if (!flow) {
      // 无匹配审批流→无需审批，直接返回approved
      return { status: 'auto_approved', message: '无需审批（未匹配到审批流）', approvalId: null };
    }

    // 创建审批实例
    const approvalNo = await this.generateNo(db);
    const approval = await db.approval.create({
      data: { tenantId, approvalNo, bizType: data.bizType, bizId: data.bizId, bizNo: data.bizNo, title: data.title, applicantId, status: 'pending', formData: data.formData as any, startedAt: new Date() },
    });

    // 创建审批节点
    const flowNodes = await db.approvalFlowNode.findMany({ where: { flowId: flow.id }, orderBy: { nodeOrder: 'asc' } });
    for (const fn of flowNodes) {
      // 评估节点条件（如有）
      if (fn.conditionExpr && !this.evaluateCondition(fn.conditionExpr, { amount: data.amount || 0 })) continue;

      // 解析审批人
      const approverId = await this.resolveApprover(db, tenantId, fn.approverType, fn.approverValue, applicantId);
      if (!approverId) continue;

      await db.approvalNode.create({
        data: { tenantId, approvalId: approval.id, nodeOrder: fn.nodeOrder, nodeName: fn.nodeName, approverId, action: 'pending' },
      });
    }

    // 设置当前节点
    const firstNode = await db.approvalNode.findFirst({ where: { approvalId: approval.id, action: 'pending' }, orderBy: { nodeOrder: 'asc' } });
    if (firstNode) {
      await db.approval.update({ where: { id: approval.id }, data: { currentNodeId: firstNode.id } });
    } else {
      // 无有效节点→自动通过
      await db.approval.update({ where: { id: approval.id }, data: { status: 'approved', completedAt: new Date() } });
      return { status: 'auto_approved', approvalId: approval.id, message: '审批流无有效节点，自动通过' };
    }

    // TODO S5: 发送通知给第一个审批人 + 同步钉钉审批
    return { approvalId: approval.id, approvalNo, status: 'pending', currentNode: firstNode?.nodeName, message: '审批已发起' };
  }

  /** 审批通过 */
  async approve(tenantId: number, approverId: number, approvalId: number, nodeId: number, comment?: string) {
    const db = this.prisma.forTenant(tenantId);
    const node = await db.approvalNode.findFirst({ where: { id: nodeId, approvalId, approverId, action: 'pending' } });
    if (!node) throw new ForbiddenException({ code: 11001, message: '您不是当前审批节点的处理人' });

    await db.approvalNode.update({ where: { id: nodeId }, data: { action: 'approved', comment, actedAt: new Date() } });

    // 查找下一个待审批节点
    const nextNode = await db.approvalNode.findFirst({ where: { approvalId, action: 'pending', nodeOrder: { gt: node.nodeOrder } }, orderBy: { nodeOrder: 'asc' } });
    if (nextNode) {
      await db.approval.update({ where: { id: approvalId }, data: { currentNodeId: nextNode.id } });
      // TODO: 通知下一个审批人
      return { status: 'pending', nextNode: nextNode.nodeName, message: `已通过，流转到下一节点：${nextNode.nodeName}` };
    }

    // 全部节点通过
    await db.approval.update({ where: { id: approvalId }, data: { status: 'approved', completedAt: new Date(), currentNodeId: null } });
    // TODO: 触发业务回调（合同→approved / 订单→approved / 立项→active）
    return { status: 'approved', message: '审批全部通过' };
  }

  /** 审批驳回 */
  async reject(tenantId: number, approverId: number, approvalId: number, nodeId: number, comment: string) {
    const db = this.prisma.forTenant(tenantId);
    if (!comment?.trim()) throw new BadRequestException({ code: 11003, message: '驳回必须填写意见' });

    const node = await db.approvalNode.findFirst({ where: { id: nodeId, approvalId, approverId, action: 'pending' } });
    if (!node) throw new ForbiddenException({ code: 11001, message: '您不是当前审批节点的处理人' });

    await db.approvalNode.update({ where: { id: nodeId }, data: { action: 'rejected', comment, actedAt: new Date() } });
    await db.approval.update({ where: { id: approvalId }, data: { status: 'rejected', completedAt: new Date(), currentNodeId: null } });
    // TODO: 触发业务回调（合同→rejected / 通知申请人）
    return { status: 'rejected', message: '已驳回' };
  }

  /** 撤回 */
  async withdraw(tenantId: number, applicantId: number, approvalId: number) {
    const db = this.prisma.forTenant(tenantId);
    const approval = await db.approval.findFirst({ where: { id: approvalId, applicantId, status: 'pending' } });
    if (!approval) throw new BadRequestException({ code: 11004, message: '审批不存在或已被处理，不可撤回' });

    await db.approval.update({ where: { id: approvalId }, data: { status: 'withdrawn', completedAt: new Date() } });
    await db.approvalNode.updateMany({ where: { approvalId, action: 'pending' }, data: { action: 'approved', comment: '申请人撤回' } });
    return { status: 'withdrawn', message: '已撤回' };
  }

  /** 我的待审批 */
  async findPending(tenantId: number, userId: number) {
    const db = this.prisma.forTenant(tenantId);
    const nodes = await db.approvalNode.findMany({ where: { approverId: userId, action: 'pending' }, include: { approval: { select: { id: true, approvalNo: true, bizType: true, title: true, applicantId: true, startedAt: true, formData: true } } }, orderBy: { createdAt: 'asc' } });
    return nodes.map((n) => ({ nodeId: n.id, nodeName: n.nodeName, approval: n.approval }));
  }

  /** 我发起的审批 */
  async findMyInitiated(tenantId: number, userId: number, query: { page?: number; pageSize?: number; status?: string }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, status } = query;
    const where: any = { applicantId: userId };
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      db.approval.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, include: { nodes: { orderBy: { nodeOrder: 'asc' } } } }),
      db.approval.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  // ===== Private =====

  private async matchFlow(db: any, tenantId: number, bizType: string, amount: number) {
    const flows = await db.approvalFlow.findMany({ where: { tenantId, bizType, isActive: true }, orderBy: { priority: 'desc' } });
    for (const flow of flows) {
      if (!flow.conditionExpr || this.evaluateCondition(flow.conditionExpr, { amount })) {
        return flow;
      }
    }
    return null;
  }

  /** 简单条件表达式求值（支持: amount >= 200000, amount < 50000, always） */
  private evaluateCondition(expr: string, context: { amount: number }): boolean {
    if (!expr || expr === 'always') return true;
    try {
      // 安全求值：只允许 amount 比较
      const match = expr.match(/amount\s*(>=|<=|>|<|==)\s*(\d+)/);
      if (!match) return true;
      const [, op, val] = match;
      const threshold = parseInt(val);
      switch (op) {
        case '>=': return context.amount >= threshold;
        case '<=': return context.amount <= threshold;
        case '>': return context.amount > threshold;
        case '<': return context.amount < threshold;
        case '==': return context.amount === threshold;
        default: return true;
      }
    } catch { return true; }
  }

  private async resolveApprover(db: any, tenantId: number, type: string, value: string | null, applicantId: number): Promise<number | null> {
    switch (type) {
      case 'user': return value ? parseInt(value) : null;
      case 'role': {
        // 找到该角色的第一个用户（简化：取经理角色用户）
        const role = await db.role.findFirst({ where: { tenantId, code: value } });
        if (!role) return null;
        const userRole = await db.userRole.findFirst({ where: { roleId: role.id } });
        return userRole?.userId || null;
      }
      case 'dept_leader': {
        // 申请人的部门负责人
        const user = await db.user.findFirst({ where: { id: applicantId } });
        if (!user?.deptId) return null;
        const dept = await db.department.findFirst({ where: { id: user.deptId } });
        return dept?.leaderId || null;
      }
      case 'applicant_leader': {
        const user = await db.user.findFirst({ where: { id: applicantId } });
        if (!user?.deptId) return null;
        const dept = await db.department.findFirst({ where: { id: user.deptId } });
        return dept?.leaderId || null;
      }
      default: return null;
    }
  }

  private async generateNo(db: any): Promise<string> {
    const now = new Date();
    const prefix = `SP${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const last = await db.approval.findFirst({ where: { approvalNo: { startsWith: prefix } }, orderBy: { approvalNo: 'desc' }, select: { approvalNo: true } });
    const seq = last ? parseInt(last.approvalNo.slice(-3)) + 1 : 1;
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }
}
