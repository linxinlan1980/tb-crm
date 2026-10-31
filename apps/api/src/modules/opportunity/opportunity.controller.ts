import { ApiExcludeController } from '@nestjs/swagger';
import { Controller, Get, Post, Put, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OpportunityService } from './opportunity.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('商机管理')
@ApiBearerAuth()
@ApiExcludeController()
@Controller('opportunities')
export class OpportunityController {
  constructor(private readonly oppService: OpportunityService) {}

  @Get()
  @Permissions('opportunity:read')
  @ApiOperation({ summary: '商机列表' })
  findAll(@TenantId() tid: number, @Query() query: any) {
    return this.oppService.findAll(tid, { page: +query.page || 1, pageSize: +query.pageSize || 20, stage: query.stage, status: query.status, ownerId: query.owner_id ? +query.owner_id : undefined, customerId: query.customer_id ? +query.customer_id : undefined, keyword: query.keyword, isKey: query.is_key === 'true', sort: query.sort, order: query.order });
  }

  @Get('funnel')
  @Permissions('opportunity:read')
  @ApiOperation({ summary: '销售漏斗统计' })
  getFunnel(@TenantId() tid: number, @Query('owner_id') ownerId?: string) {
    return this.oppService.getFunnel(tid, ownerId ? +ownerId : undefined);
  }

  @Get('forecast')
  @Permissions('dashboard:team')
  @ApiOperation({ summary: '销售预测（三档）' })
  getForecast(@TenantId() tid: number, @Query('period') period?: string) {
    return this.oppService.getForecast(tid, period);
  }

  @Get('stalled')
  @Permissions('dashboard:team')
  @ApiOperation({ summary: '停滞预警商机' })
  findStalled(@TenantId() tid: number) {
    return this.oppService.findStalled(tid);
  }

  @Get(':id')
  @Permissions('opportunity:read')
  @ApiOperation({ summary: '商机详情' })
  findOne(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.oppService.findOne(tid, id);
  }

  @Post()
  @Permissions('opportunity:create')
  @ApiOperation({ summary: '创建商机' })
  create(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: any) {
    return this.oppService.create(tid, userId, dto);
  }

  @Post(':id/advance')
  @Permissions('opportunity:advance')
  @ApiOperation({ summary: '推进阶段' })
  advance(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: { targetStage: string; note?: string }) {
    return this.oppService.advanceStage(tid, userId, id, dto.targetStage, dto.note);
  }

  @Post(':id/win')
  @Permissions('opportunity:win')
  @ApiOperation({ summary: '标记赢单' })
  win(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body('contractId') contractId?: number) {
    return this.oppService.win(tid, userId, id, contractId);
  }

  @Post(':id/lose')
  @Permissions('opportunity:lose')
  @ApiOperation({ summary: '标记输单' })
  lose(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: { lossReason: string; lossDetail?: string }) {
    return this.oppService.lose(tid, userId, id, dto.lossReason, dto.lossDetail);
  }
}
