import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { AnalyticsService } from './analytics.service';
import { hasPermission } from './access';
const inputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    year: { type: 'integer', minimum: 2000, maximum: 2100 },
    month: { type: 'integer', minimum: 0, maximum: 12 },
    ownerId: { type: 'integer', minimum: 1 },
    deptId: { type: 'integer', minimum: 1 },
    contractId: { type: 'integer', minimum: 1 },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    source: { enum: ['managed', 'legacy'] },
    detail: { enum: ['contracts', 'plans', 'receipts', 'balances', 'overdue'] },
    bucket: { enum: ['open', 'won', 'lost', 'closed', 'undated'] },
  },
};
export const analyticsCapabilities = [
  {
    id: 'report.sales.forecast',
    version: '1.0',
    permission: 'opportunity:read',
    effect: 'read',
    endpoint: 'GET /analytics/forecast',
    inputSchema,
  },
  {
    id: 'report.cash.collections',
    version: '1.0',
    permission: 'finance:read',
    effect: 'read',
    endpoint: 'GET /analytics/collections',
    inputSchema,
    additionalPermissions: ['contract:read'],
  },
].map((c) => ({
  ...c,
  outputSchema: { type: 'object', required: ['version', 'generatedAt', 'summary', 'monthly', 'notices'] },
  guards: [
    'authenticated tenant/actor',
    'object and record visibility',
    'RepeatableRead snapshot',
    'read-only; no state effect',
    'bounded query rejects truncation',
  ],
}));
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}
  @Get('options') options(@CurrentUser() a: Actor) {
    return this.service.options(a);
  }
  @Get('schema') schema(@CurrentUser() a: Actor) {
    return analyticsCapabilities.filter(
      (c) =>
        hasPermission(a, c.permission) &&
        (!('additionalPermissions' in c) || c.additionalPermissions?.every((p) => hasPermission(a, p))),
    );
  }
  @Get('forecast') forecast(@CurrentUser() a: Actor, @Query() q: Record<string, string>) {
    return this.service.forecast(a, q);
  }
  @Get('collections') collections(@CurrentUser() a: Actor, @Query() q: Record<string, string>) {
    return this.service.collections(a, q);
  }
}
