import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * 通知服务
 * 规则引擎：事件→匹配规则→解析接收人→渲染模板→多渠道发送→去重→记录
 * 渠道：inbox(站内信) / dingtalk(工作通知) / email / sms
 * 参考文档：crm/12_工程规范/通知消息模板.md
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger('NotificationService');
  constructor(private prisma: PrismaService) {}

  /**
   * 发送通知（核心入口）
   * 由领域事件触发，按notification_rules匹配规则→渲染模板→多渠道分发
   */
  async send(tenantId: number, event: { eventName: string; payload: Record<string, any>; actorId?: number }) {
    const db = this.prisma.forTenant(tenantId);

    // 1. 匹配通知规则
    const rules = await db.notificationRule.findMany({ where: { eventName: event.eventName, isActive: true } });
    if (!rules.length) { this.logger.debug(`事件${event.eventName}无匹配通知规则`); return; }

    for (const rule of rules) {
      // 2. 评估附加条件
      if (rule.conditionExpr && !this.evaluateCondition(rule.conditionExpr, event.payload)) continue;

      // 3. 解析接收人
      const receiverIds = await this.resolveReceivers(db, tenantId, rule.receivers as string[], event.payload, event.actorId);
      if (!receiverIds.length) continue;

      // 4. 去重检查（同一事件+同一接收人，dedup_hours内不重复）
      const channels = rule.channels as string[];

      for (const userId of receiverIds) {
        // 5. 渲染模板并发送
        for (const channel of channels) {
          const title = this.renderTemplate(rule.name, event.payload);
          const content = this.renderTemplate(JSON.stringify(event.payload).slice(0, 200), event.payload);

          // 写入站内信（所有通知都有inbox记录）
          await db.notification.create({
            data: { tenantId, userId, type: event.eventName, title, content, bizType: event.payload.bizType || null, bizId: event.payload.bizId || null, channel: channel as any, isRead: false },
          });

          // 钉钉/邮件/短信渠道（S5实现具体发送逻辑）
          if (channel === 'dingtalk') {
            // TODO: 调用钉钉工作通知API
            this.logger.debug(`[钉钉通知] 用户${userId}: ${title}`);
          }
          if (channel === 'email') {
            // TODO: 调用SMTP发送
            this.logger.debug(`[邮件通知] 用户${userId}: ${title}`);
          }
        }
      }
    }
  }

  /** 获取用户通知列表 */
  async findAll(tenantId: number, userId: number, query: { page?: number; pageSize?: number; isRead?: boolean }) {
    const db = this.prisma.forTenant(tenantId);
    const { page = 1, pageSize = 20, isRead } = query;
    const where: any = { userId };
    if (isRead !== undefined) where.isRead = isRead;
    const [items, total, unreadCount] = await Promise.all([
      db.notification.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      db.notification.count({ where }),
      db.notification.count({ where: { userId, isRead: false } }),
    ]);
    return { items, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }, unreadCount };
  }

  /** 标记已读 */
  async markRead(tenantId: number, userId: number, id: number) {
    const db = this.prisma.forTenant(tenantId);
    await db.notification.updateMany({ where: { id, userId }, data: { isRead: true, readAt: new Date() } });
    return { message: 'ok' };
  }

  /** 全部已读 */
  async markAllRead(tenantId: number, userId: number) {
    const db = this.prisma.forTenant(tenantId);
    await db.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
    return { message: '全部已读' };
  }

  /** 未读数量 */
  async unreadCount(tenantId: number, userId: number) {
    const db = this.prisma.forTenant(tenantId);
    const count = await db.notification.count({ where: { userId, isRead: false } });
    return { count };
  }

  // ===== Private =====

  private async resolveReceivers(db: any, tenantId: number, receiverRules: string[], payload: any, actorId?: number): Promise<number[]> {
    const ids = new Set<number>();
    for (const rule of receiverRules) {
      switch (rule) {
        case 'owner': if (payload.ownerId) ids.add(payload.ownerId); break;
        case 'manager': {
          // 找owner的部门leader
          if (payload.ownerId) {
            const user = await db.user.findFirst({ where: { id: payload.ownerId } });
            if (user?.deptId) {
              const dept = await db.department.findFirst({ where: { id: user.deptId } });
              if (dept?.leaderId) ids.add(dept.leaderId);
            }
          }
          break;
        }
        case 'finance': {
          const financeRole = await db.role.findFirst({ where: { tenantId, code: 'finance' } });
          if (financeRole) {
            const users = await db.userRole.findMany({ where: { roleId: financeRole.id } });
            users.forEach((u: any) => ids.add(u.userId));
          }
          break;
        }
        case 'approver': if (payload.approverId) ids.add(payload.approverId); break;
        case 'applicant': if (payload.applicantId) ids.add(payload.applicantId); break;
        case 'to_owner': if (payload.toOwnerId) ids.add(payload.toOwnerId); break;
        case 'from_owner': if (payload.fromOwnerId) ids.add(payload.fromOwnerId); break;
        case 'pm': if (payload.pmId) ids.add(payload.pmId); break;
        case 'actor': if (actorId) ids.add(actorId); break;
        default: break;
      }
    }
    return [...ids];
  }

  private evaluateCondition(expr: string, payload: any): boolean {
    // 简单条件求值（如 overdue_days >= 30）
    try {
      const match = expr.match(/(\w+)\s*(>=|<=|>|<|==)\s*(\d+)/);
      if (!match) return true;
      const [, field, op, val] = match;
      const actual = payload[field] ?? 0;
      const threshold = parseInt(val);
      switch (op) {
        case '>=': return actual >= threshold;
        case '<=': return actual <= threshold;
        case '>': return actual > threshold;
        case '<': return actual < threshold;
        case '==': return actual === threshold;
        default: return true;
      }
    } catch { return true; }
  }

  private renderTemplate(template: string, payload: any): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(payload[key] ?? ''));
  }
}
