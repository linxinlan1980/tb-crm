import { Controller, Get, Post, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApprovalService } from './approval.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('审批中心')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get('pending')
  @ApiOperation({ summary: '我的待审批' })
  findPending(@TenantId() tid: number, @CurrentUser('userId') userId: number) {
    return this.approvalService.findPending(tid, userId);
  }

  @Get('pending-count')
  @ApiOperation({ summary: '待审批数量（角标）' })
  async pendingCount(@TenantId() tid: number, @CurrentUser('userId') userId: number) {
    const items = await this.approvalService.findPending(tid, userId);
    return { count: items.length };
  }

  @Get('my-initiated')
  @ApiOperation({ summary: '我发起的审批' })
  findMyInitiated(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Query() query: any) {
    return this.approvalService.findMyInitiated(tid, userId, { page: +query.page || 1, pageSize: +query.pageSize || 20, status: query.status });
  }

  @Post()
  @Permissions('approval:create')
  @ApiOperation({ summary: '发起审批' })
  create(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: any) {
    return this.approvalService.create(tid, userId, dto);
  }

  @Post(':approvalId/nodes/:nodeId/approve')
  @Permissions('approval:approve')
  @ApiOperation({ summary: '审批通过' })
  approve(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('approvalId', ParseIntPipe) approvalId: number, @Param('nodeId', ParseIntPipe) nodeId: number, @Body('comment') comment?: string) {
    return this.approvalService.approve(tid, userId, approvalId, nodeId, comment);
  }

  @Post(':approvalId/nodes/:nodeId/reject')
  @Permissions('approval:reject')
  @ApiOperation({ summary: '审批驳回' })
  reject(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('approvalId', ParseIntPipe) approvalId: number, @Param('nodeId', ParseIntPipe) nodeId: number, @Body('comment') comment: string) {
    return this.approvalService.reject(tid, userId, approvalId, nodeId, comment);
  }

  @Post(':id/withdraw')
  @Permissions('approval:withdraw')
  @ApiOperation({ summary: '撤回审批' })
  withdraw(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.approvalService.withdraw(tid, userId, id);
  }
}
