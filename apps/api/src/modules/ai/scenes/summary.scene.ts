import { Injectable } from '@nestjs/common';
import { AiGatewayService, AiResult } from '../gateway/ai-gateway.service';
import { PrismaService } from '../../../database/prisma.service';

/**
 * 场景1：跟进纪要AI整理（一期P0）
 * 输入：原始文本/语音转写 + 客户/商机上下文
 * 输出：结构化纪要（参会人/议题/结论/行动项/下次跟进/风险信号/摘要）
 * 嵌入点：跟进记录创建页"AI整理"按钮
 * 参考：crm/06_AI副驾驶设计/AI场景详细设计.md §场景1
 */
@Injectable()
export class SummaryScene {
  constructor(private aiGateway: AiGatewayService, private prisma: PrismaService) {}

  async execute(tenantId: number, userId: number, input: { rawText: string; targetType: string; targetId: number; customerName?: string; contactName?: string; opportunityStage?: string }) {
    // 配额检查
    const quota = await this.aiGateway.checkQuota(tenantId);
    if (!quota.allowed) return { success: false, error: `本月AI配额已用完（${quota.used}/${quota.quota}）`, output: null };

    // 获取上下文（最近3条跟进）
    const db = this.prisma.forTenant(tenantId);
    const recentFollows = await db.followUp.findMany({ where: { targetType: input.targetType, targetId: input.targetId }, orderBy: { createdAt: 'desc' }, take: 3, select: { content: true, createdAt: true } });

    const prompt = this.buildPrompt(input, recentFollows);
    const result = await this.aiGateway.generate(tenantId, userId, 'summary', prompt, { targetType: input.targetType, targetId: input.targetId, inputSummary: input.rawText.slice(0, 200) });

    return result;
  }

  private buildPrompt(input: any, recentFollows: any[]): string {
    return `你是一个B2B销售跟进纪要整理助手。请将以下原始记录整理为结构化纪要。

## 客户背景
- 客户：${input.customerName || '未知'}
- 联系人：${input.contactName || '未知'}
- 当前商机阶段：${input.opportunityStage || '未知'}
- 最近跟进摘要：${recentFollows.map(f => f.content?.slice(0, 50)).join('；') || '无'}

## 原始记录
${input.rawText}

## 输出要求（严格JSON格式）
{
  "participants": ["参会人列表"],
  "topics": ["讨论议题"],
  "conclusions": ["达成的结论/共识"],
  "action_items": [{"content": "行动项", "owner": "负责人", "due": "截止日期(如有)"}],
  "next_follow": {"method": "下次跟进方式", "content": "下次跟进内容", "suggested_date": "建议日期"},
  "risk_signals": ["风险信号"],
  "summary": "一句话摘要（≤50字）"
}

## 规则
- 只提取原始记录中明确提到的信息，不编造
- 行动项必须有明确负责人（如原文未指定，标"待确认"）
- 如原始记录过短或无实质内容，返回 {"error": "内容不足，无法整理"}`;
  }
}
