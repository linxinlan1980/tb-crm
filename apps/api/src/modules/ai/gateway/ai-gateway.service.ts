import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';

/**
 * AI模型网关
 * 统一封装LLM调用：模型路由/Token计量/超时/重试/降级/审计
 * 参考文档：crm/06_AI副驾驶设计/AI场景详细设计.md §架构概览
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger('AiGateway');
  constructor(private config: ConfigService, private prisma: PrismaService) {}

  /**
   * 通用AI生成入口
   * @param tenantId 租户
   * @param userId 触发用户
   * @param scene 场景编码
   * @param prompt 完整prompt
   * @param context 业务上下文（用于审计）
   */
  async generate(tenantId: number, userId: number | null, scene: string, prompt: string, context: { targetType?: string; targetId?: number; inputSummary?: string }): Promise<AiResult> {
    const startTime = Date.now();
    const model = this.config.get('app.ai.defaultModel', 'qwen-max');
    const apiKey = this.config.get('app.ai.dashscopeApiKey', '');

    if (!apiKey) {
      this.logger.warn('AI API Key未配置，返回降级结果');
      await this.writeAuditLog(tenantId, userId, scene, context, model, 0, 0, 0, 'degraded', 'API Key未配置', startTime);
      return { success: false, output: null, error: 'AI服务未配置', degraded: true };
    }

    try {
      // 调用通义千问API（DashScope兼容OpenAI格式）
      const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json() as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const output = data.choices?.[0]?.message?.content || '';
      const inputTokens = data.usage?.prompt_tokens || 0;
      const outputTokens = data.usage?.completion_tokens || 0;
      const cost = this.calcCost(model, inputTokens, outputTokens);
      const latency = Date.now() - startTime;

      // 写审计日志
      await this.writeAuditLog(tenantId, userId, scene, context, model, inputTokens, outputTokens, cost, 'success', null, startTime, output);

      // 尝试解析JSON
      let parsed: any = null;
      try { parsed = JSON.parse(output); } catch { parsed = { raw: output }; }

      return { success: true, output: parsed, tokensUsed: { input: inputTokens, output: outputTokens, cost }, latencyMs: latency, model };
    } catch (e: any) {
      const latency = Date.now() - startTime;
      this.logger.error(`AI调用失败[${scene}]: ${e.message}`);
      await this.writeAuditLog(tenantId, userId, scene, context, model, 0, 0, 0, 'failed', e.message, startTime);
      return { success: false, output: null, error: e.message, degraded: true };
    }
  }

  /** 检查租户配额 */
  async checkQuota(tenantId: number): Promise<{ allowed: boolean; used: number; quota: number }> {
    const db = this.prisma.forTenant(tenantId);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const used = await db.aiAuditLog.count({ where: { createdAt: { gte: monthStart }, status: 'success' } });
    const quota = 5000; // TODO: 从system_settings读取
    return { allowed: used < quota, used, quota };
  }

  private calcCost(model: string, inputTokens: number, outputTokens: number): number {
    // 通义千问定价（元/千token）
    const rates: Record<string, { input: number; output: number }> = {
      'qwen-max': { input: 0.02, output: 0.06 },
      'qwen-plus': { input: 0.004, output: 0.012 },
      'qwen-turbo': { input: 0.002, output: 0.006 },
    };
    const rate = rates[model] || rates['qwen-plus'];
    return Number(((inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output).toFixed(4));
  }

  private async writeAuditLog(tenantId: number, userId: number | null, scene: string, context: any, model: string, inputTokens: number, outputTokens: number, cost: number, status: string, error: string | null, startTime: number, output?: string) {
    try {
      await this.prisma.system.aiAuditLog.create({
        data: { tenantId, scene, userId, targetType: context.targetType, targetId: context.targetId, modelUsed: model, inputTokens, outputTokens, cost, inputSummary: context.inputSummary?.slice(0, 200), outputSummary: output?.slice(0, 200), outputFull: output ? JSON.parse(output.startsWith('{') ? output : JSON.stringify({ raw: output })) : undefined, status: status as any, errorMessage: error, latencyMs: Date.now() - startTime },
      });
    } catch (e) { this.logger.error(`审计日志写入失败: ${e}`); }
  }
}

export interface AiResult {
  success: boolean;
  output: any;
  error?: string;
  degraded?: boolean;
  tokensUsed?: { input: number; output: number; cost: number };
  latencyMs?: number;
  model?: string;
}
