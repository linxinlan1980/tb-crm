import { ApiExcludeController } from '@nestjs/swagger';
import { Controller, Get, Post, Put, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ActionPlanService } from './action-plan.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('行动计划')
@ApiBearerAuth()
@ApiExcludeController()
@Controller('actions')
export class ActionPlanController {
  constructor(private readonly actionService: ActionPlanService) {}

  @Get()
  @Permissions('action:read')
  @ApiOperation({ summary: '行动计划列表' })
  findAll(@TenantId() tid: number, @Query() query: any) {
    return this.actionService.findAll(tid, { targetType: query.target_type, targetId: query.target_id ? +query.target_id : undefined, assigneeId: query.assignee_id ? +query.assignee_id : undefined, status: query.status, dueBefore: query.due_before, page: +query.page || 1, pageSize: +query.pageSize || 20 });
  }

  @Get('today')
  @Permissions('action:read')
  @ApiOperation({ summary: '今日待办' })
  findToday(@TenantId() tid: number, @CurrentUser('userId') userId: number) {
    return this.actionService.findToday(tid, userId);
  }

  @Get('overdue')
  @Permissions('action:read')
  @ApiOperation({ summary: '逾期行动' })
  findOverdue(@TenantId() tid: number, @CurrentUser('userId') userId: number) {
    return this.actionService.findOverdue(tid, userId);
  }

  @Post()
  @Permissions('action:create')
  @ApiOperation({ summary: '创建行动计划' })
  create(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: any) {
    return this.actionService.create(tid, userId, dto);
  }

  @Put(':id')
  @Permissions('action:update')
  @ApiOperation({ summary: '更新行动计划' })
  update(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.actionService.update(tid, id, dto);
  }

  @Post(':id/complete')
  @Permissions('action:update')
  @ApiOperation({ summary: '完成行动' })
  complete(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.actionService.complete(tid, id);
  }
}
