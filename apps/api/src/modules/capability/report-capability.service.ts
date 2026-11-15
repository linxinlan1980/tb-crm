import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '../../common/types/actor';
import { PrismaService } from '../../database/prisma.service';
import { AnalyticsService } from '../workspace/analytics.service';
import { allowedReportCapabilities } from '../workspace/analytics.contract';
import { json, validateActor } from '../workspace/command-runner';

export function reportInput(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('报表参数必须为对象');
  const numeric: Record<string, [number, number]> = {
    year: [2000, 2100], month: [0, 12], ownerId: [1, 2147483647], deptId: [1, 2147483647],
    contractId: [1, 2147483647], page: [1, 1000000], pageSize: [1, 100],
  };
  const enums: Record<string, readonly string[]> = {
    source: ['managed', 'legacy'], detail: ['contracts', 'plans', 'receipts', 'balances', 'overdue'],
    bucket: ['open', 'won', 'lost', 'closed', 'undated'],
  };
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(input).sort(([a], [b]) => a.localeCompare(b))) {
    if (Object.hasOwn(numeric, key)) {
      const [min, max] = numeric[key];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new BadRequestException(key + '必须为范围内整数');
      query[key] = String(value);
    } else if (Object.hasOwn(enums, key) && typeof value === 'string' && enums[key].includes(value)) query[key] = value;
    else throw new BadRequestException('存在未定义或无效报表参数');
  }
  return query;
}
@Injectable()
export class ReportCapabilityService {
  constructor(private readonly analytics: AnalyticsService, private readonly prisma: PrismaService) {}
  async invoke(actor: Actor, id: string, input: unknown, trace?: { grantId: string; agentExecutionId: string }) {
    const definition = allowedReportCapabilities(actor).find(c => c.id === id);
    if (!definition) throw new ForbiddenException('无权调用此报表能力');
    const executionId = randomUUID();
    const evidence = { capabilityId: id, version: definition.version, effect: 'read', executor: trace ? 'agent' : 'human', ...trace };
    try {
      const query = reportInput(input);
      const result = id === 'report.sales.forecast' ? await this.analytics.forecast(actor, query) : await this.analytics.collections(actor, query);
      await this.prisma.system.auditLog.create({ data: {
        tenantId: actor.tenantId, userId: actor.userId, action: 'capability.succeeded', objectType: 'capability', objectNo: executionId,
        afterData: json({ ...evidence, inputHash: createHash('sha256').update(JSON.stringify(query)).digest('hex'), generatedAt: result.generatedAt }),
      } });
      await validateActor(this.prisma.system, actor);
      return { executionId, capabilityId: id, version: definition.version, result };
    } catch (error) {
      await this.prisma.system.auditLog.create({ data: { tenantId: actor.tenantId, userId: actor.userId, action: 'capability.failed', objectType: 'capability', objectNo: executionId, afterData: json(evidence) } });
      throw error;
    }
  }
}
