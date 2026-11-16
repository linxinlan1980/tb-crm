import { ApiExcludeController } from '@nestjs/swagger';
import { Controller, Get, Post, Put, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LeadService } from './lead.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('线索管理')
@ApiBearerAuth()
@ApiExcludeController()
@Controller('leads')
export class LeadController {
  constructor(private readonly leadService: LeadService) {}

  @Get()
  @Permissions('lead:read')
  @ApiOperation({ summary: '线索列表' })
  findAll(@TenantId() tid: number, @Query() query: any) {
    return this.leadService.findAll(tid, { page: +query.page || 1, pageSize: +query.pageSize || 20, status: query.status, source: query.source, assigneeId: query.assignee_id ? +query.assignee_id : undefined, keyword: query.keyword, scoreMin: query.score_min ? +query.score_min : undefined, scoreMax: query.score_max ? +query.score_max : undefined });
  }

  @Get(':id')
  @Permissions('lead:read')
  @ApiOperation({ summary: '线索详情' })
  findOne(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.leadService.findOne(tid, id);
  }

  @Post()
  @Permissions('lead:create')
  @ApiOperation({ summary: '创建线索' })
  create(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: any) {
    return this.leadService.create(tid, userId, dto);
  }

  @Post(':id/score')
  @Permissions('lead:update')
  @ApiOperation({ summary: '重新评分' })
  rescore(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.leadService.rescore(tid, id);
  }

  @Post(':id/assign')
  @Permissions('lead:assign')
  @ApiOperation({ summary: '分配线索' })
  assign(@TenantId() tid: number, @CurrentUser('userId') managerId: number, @Param('id', ParseIntPipe) id: number, @Body('assigneeId', ParseIntPipe) assigneeId: number) {
    return this.leadService.assign(tid, managerId, id, assigneeId);
  }

  @Post(':id/convert')
  @Permissions('lead:convert')
  @ApiOperation({ summary: '线索转客户（+可选转商机）' })
  convert(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: { createOpportunity?: boolean; oppName?: string; oppAmount?: number }) {
    return this.leadService.convert(tid, userId, id, dto);
  }

  @Post(':id/reject')
  @Permissions('lead:reject')
  @ApiOperation({ summary: '标记不合格' })
  reject(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body('reason') reason: string) {
    return this.leadService.reject(tid, userId, id, reason);
  }

  @Get(':id/follow-ups')
  @Permissions('lead:read')
  @ApiOperation({ summary: '线索跟进记录' })
  async getFollowUps(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    const lead: any = await this.leadService.findOne(tid, id);
    return lead.followUps || [];
  }

  @Post(':id/follow-ups')
  @Permissions('lead:update')
  @ApiOperation({ summary: '创建线索跟进' })
  createFollowUp(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.leadService.createFollowUp(tid, userId, id, dto);
  }
}
