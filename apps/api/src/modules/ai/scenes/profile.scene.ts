import { Injectable } from '@nestjs/common';
import { AiGatewayService } from '../gateway/ai-gateway.service';
import { PrismaService } from '../../../database/prisma.service';

/**
 * 场景2：客户360°画像生成（一期P1）
 * 输入：客户全量数据聚合
 * 输出：结构化画像（定位/行业地位/决策链/合作历史/需求预判/风险/建议）
 * 嵌入点：客户详情页"AI画像"卡片
 * 参考：crm/06_AI副驾驶设计/AI场景详细设计.md §场景2
 */
@Injectable()
export class ProfileScene {
  constructor(private aiGateway: AiGatewayService, private prisma: PrismaService) {}

  async execute(tenantId: number, userId: number, customerId: number) {
    const quota = await this.aiGateway.checkQuota(tenantId);
    if (!quota.allowed) return { success: false, error: 'AI配额已用完', output: null };

    const db = this.prisma.forTenant(tenantId);

    // 聚合客户数据
    const [customer, contacts, contracts, opportunities, followUps, projects] = await Promise.all([
      db.customer.findFirst({ where: { id: customerId } }),
      db.contact.findMany({ where: { customerId, deletedAt: null } }),
      db.contract.findMany({ where: { customerId, deletedAt: null }, select: { name: true, amount: true, status: true, signDate: true, contractType: true } }),
      db.opportunity.findMany({ where: { customerId, status: 'open', deletedAt: null }, select: { name: true, stage: true, amount: true } }),
      db.followUp.findMany({ where: { targetType: 'customer', targetId: customerId }, orderBy: { createdAt: 'desc' }, take: 10, select: { content: true, method: true, createdAt: true } }),
      db.project.findMany({ where: { customerId, deletedAt: null }, select: { name: true, stage: true, status: true } }),
    ]);

    if (!customer) return { success: false, error: '客户不存在', output: null };

    const aggregatedData = {
      basic: { name: customer.name, industry: customer.industry, level: customer.level, region: customer.region, yonyouProduct: customer.yonyouProduct, yonyouModules: customer.yonyouModules, serviceExpiry: customer.serviceExpiry, employeeCount: customer.employeeCount },
      contacts: contacts.map(c => ({ name: c.name, title: c.title, role: c.decisionRole })),
      contracts: contracts.map(c => ({ name: c.name, amount: Number(c.amount), status: c.status, type: c.contractType, signDate: c.signDate })),
      opportunities: opportunities.map(o => ({ name: o.name, stage: o.stage, amount: Number(o.amount) })),
      recentFollowUps: followUps.map(f => ({ method: f.method, content: f.content?.slice(0, 100), date: f.createdAt })),
      projects: projects.map(p => ({ name: p.name, stage: p.stage, status: p.status })),
    };

    const prompt = this.buildPrompt(aggregatedData);
    const result = await this.aiGateway.generate(tenantId, userId, 'profile', prompt, { targetType: 'customer', targetId: customerId, inputSummary: customer.name });

    // 写入客户ai_profile字段
    if (result.success && result.output) {
      await db.customer.update({ where: { id: customerId }, data: { aiProfile: JSON.stringify(result.output), aiProfileAt: new Date() } });
    }

    return result;
  }

  private buildPrompt(data: any): string {
    return `你是一个B2B客户分析专家。请基于以下数据生成客户画像摘要。

## 客户数据
${JSON.stringify(data, null, 2)}

## 输出要求（严格JSON格式）
{
  "one_line": "一句话定位（≤30字）",
  "business_profile": {"industry_position": "行业地位", "scale": "规模判断", "it_maturity": "IT成熟度（低/中/高）"},
  "relationship": {"key_persons": ["关键人及角色"], "decision_chain": "决策链完整度评价", "our_coverage": "我方覆盖度（强/中/弱）"},
  "cooperation_history": {"summary": "合作历史摘要", "total_value": "累计合作金额", "payment_behavior": "付款行为（及时/偶有延迟/经常逾期）"},
  "current_opportunity": {"summary": "当前商机概况", "win_probability": "赢单概率判断（高/中/低）及理由"},
  "needs_prediction": ["潜在需求预判"],
  "risks": ["风险点"],
  "recommended_actions": ["建议动作（具体可执行）"]
}

## 规则
- 基于数据推断，不编造事实
- 如某维度数据不足，标注"数据不足，建议补充XX"
- recommended_actions必须具体可执行`;
  }
}
