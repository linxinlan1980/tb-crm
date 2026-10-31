import { ApiExcludeController } from '@nestjs/swagger';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('经营仪表盘')
@ApiBearerAuth()
@ApiExcludeController()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: '首页概览KPI' })
  getOverview(@TenantId() tid: number, @CurrentUser('userId') userId: number) {
    return this.dashboardService.getOverview(tid, userId);
  }

  @Get('funnel')
  @Permissions('dashboard:team')
  @ApiOperation({ summary: '销售漏斗' })
  getFunnel(@TenantId() tid: number, @Query('owner_id') ownerId?: string) {
    return this.dashboardService.getFunnel(tid, ownerId ? +ownerId : undefined);
  }

  @Get('revenue-forecast')
  @Permissions('dashboard:business')
  @ApiOperation({ summary: '回款预测（未来6月）' })
  getRevenueForecast(@TenantId() tid: number) {
    return this.dashboardService.getRevenueForecast(tid);
  }

  @Get('customer-health')
  @Permissions('dashboard:team')
  @ApiOperation({ summary: '客户健康度分布' })
  getCustomerHealth(@TenantId() tid: number) {
    return this.dashboardService.getCustomerHealth(tid);
  }

  @Get('project-stats')
  @Permissions('dashboard:project')
  @ApiOperation({ summary: '项目交付统计' })
  getProjectStats(@TenantId() tid: number) {
    return this.dashboardService.getProjectStats(tid);
  }
}
