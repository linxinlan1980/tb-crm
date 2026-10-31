import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentPlanService } from './payment-plan.service';
import { AgingService } from '../aging/aging.service';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { TenantId } from '../../../common/decorators/current-user.decorator';

@ApiTags('财务-回款与账龄')
@ApiBearerAuth()
@Controller('finance')
export class PaymentPlanController {
  constructor(private readonly planService: PaymentPlanService, private readonly agingService: AgingService) {}

  @Get('payment-plans')
  @Permissions('payment_plan:read')
  @ApiOperation({ summary: '回款计划列表' })
  findPlans(@TenantId() tid: number, @Query() query: any) {
    return this.planService.findAll(tid, { page: +query.page || 1, pageSize: +query.pageSize || 20, contractId: query.contract_id ? +query.contract_id : undefined, customerId: query.customer_id ? +query.customer_id : undefined, status: query.status, overdueOnly: query.overdue_only === 'true', dueBefore: query.due_before });
  }

  @Get('payment-plans/:id')
  @Permissions('payment_plan:read')
  @ApiOperation({ summary: '回款计划详情' })
  findPlan(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.planService.findOne(tid, id);
  }

  @Get('overview')
  @Permissions('finance:read')
  @ApiOperation({ summary: '财务总览' })
  getOverview(@TenantId() tid: number) {
    return this.planService.getOverview(tid);
  }

  @Get('aging')
  @Permissions('aging:read')
  @ApiOperation({ summary: '账龄汇总（四桶）' })
  getAging(@TenantId() tid: number) {
    return this.agingService.getSummary(tid);
  }

  @Get('aging/subjects')
  @Permissions('aging:read')
  @ApiOperation({ summary: '客户级账龄榜' })
  getAgingBySubject(@TenantId() tid: number) {
    return this.agingService.getBySubject(tid);
  }

  @Get('aging/detail')
  @Permissions('aging:read')
  @ApiOperation({ summary: '逐笔账龄明细' })
  getAgingDetail(@TenantId() tid: number, @Query() query: any) {
    return this.agingService.getDetail(tid, { bucket: query.bucket, customerId: query.customer_id ? +query.customer_id : undefined, keyword: query.keyword });
  }
}
