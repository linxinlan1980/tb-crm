import { Injectable } from '@nestjs/common';
import { AiGatewayService } from '../gateway/ai-gateway.service';
import { PrismaService } from '../../../database/prisma.service';

/**
 * 场景3：下一步行动推荐（一期P1）
 * 输入：客户/商机当前上下文
 * 输出：1-3个推荐行动（按优先级排序）
 * 嵌入点：客户/商机详情页右侧"AI建议"面板 + 每日工作台"今日推荐"
 * 参考：crm/06_AI副驾驶设计/AI场景详细设计.md §场景3
 */
@Injectable()
export class RecommendScene {
  constructor(private aiGateway: AiGatewayService, private prisma: PrismaService) {}

  async execute(tenantId: number, userId: number, targetType: 'customer' | 'opportunity', targetId: number) {
    const quota = await this.aiGateway.checkQuota(tenantId);
    if (!quota.allowed) return { success: false, error: 'AI配额已用完', output: null };

    const db = this.prisma.forTenant(tenantId);
    let context: any = {};

    if (targetType === 'customer') {
      const customer = await db.customer.findFirst({ where: { id: targetId } });
      const opps = await db.opportunity.findMany({ where: { customerId: targetId, status: 'open' }, select: { name: true, stage: true, stageStallDays: true, amount: true } });
      const followUps = await db.followUp.findMany({ where: { targetType: 'customer', targetId }, orderBy: { createdAt: 'desc' }, take: 3, select: { content: true, method: true, createdAt: true } });
      const actions = await db.actionPlan.findMany({ where: { targetType: 'customer', targetId, status: { in: ['pending', 'in_progress'] } }, select: { title: true, dueDate: true } });
      const plans = await db.paymentPlan.findMany({ where: { contract: { customerId: targetId }, status: { in: ['pending', 'overdue'] }, dueDate: { lte: new Date(Date.now() + 30 * 86400000) } }, select: { amount: true, dueDate: true, status: true } });
      context = { customer: { name: customer?.name, industry: customer?.industry, aiProfile: customer?.aiProfile }, opportunities: opps, recentFollowUps: followUps, pendingActions: actions, upcomingPayments: plans };
    } else {
      const opp = await db.opportunity.findFirst({ where: { id: targetId }, include: { customer: { select: { name: true, aiProfile: true } } } });
      const followUps = await db.followUp.findMany({ where: { targetType: 'opportunity', targetId }, orderBy: { createdAt: 'desc' }, take: 3, select: { content: true, createdAt: true } });
      context = { opportunity: { name: opp?.name, stage: opp?.stage, stageStallDays: opp?.stageStallDays, amount: opp?.amount, expectedCloseDate: opp?.expectedCloseDate }, customer: opp?.customer, recentFollowUps: followUps };
    }

    const prompt = this.buildPrompt(targetType, context);
    return this.aiGateway.generate(tenantId, userId, 'recommend', prompt, { targetType, targetId, inputSummary: `${targetType}:${targetId}` });
  }

  private buildPrompt(targetType: string, context: any): string {
    return `你是一个B2B销售教练。请基于以下上下文，推荐下一步最佳行动。

## 当前上下文（${targetType}）
${JSON.stringify(context, null, 2)}

## 输出要求（JSON数组，推荐1-3个行动，按优先级排序）
[
  {
    "priority": 1,
    "action": "具体行动描述",
    "reason": "推荐理由",
    "method": "建议方式（电话/拜访/微信/邮件/会议）",
    "target": "建议联系谁",
    "timing": "建议什么时候",
    "expected_outcome": "预期结果"
  }
]

## 规则
- 推荐必须基于上下文数据，不泛泛而谈
- 优先推荐紧急事项（即将超期/即将到期回款/商机停滞）
- 最多3个，按紧急度排序
- 如当前无需行动，返回空数组[]`;
  }
}
