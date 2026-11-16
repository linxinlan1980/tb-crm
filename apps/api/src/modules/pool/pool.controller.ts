import { ApiExcludeController } from '@nestjs/swagger';
import { Controller, Get, Post, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PoolService } from './pool.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('公私海管理')
@ApiBearerAuth()
@ApiExcludeController()
@Controller('pool')
export class PoolController {
  constructor(private readonly poolService: PoolService) {}

  @Get('public')
  @Permissions('pool:read_public')
  @ApiOperation({ summary: '公海客户列表' })
  findPublic(@TenantId() tid: number, @Query() query: any) {
    return this.poolService.findPublic(tid, { page: +query.page || 1, pageSize: +query.pageSize || 20, industry: query.industry, level: query.level, keyword: query.keyword });
  }

  @Get('private')
  @Permissions('customer:read')
  @ApiOperation({ summary: '我的私海列表' })
  findPrivate(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Query() query: any) {
    return this.poolService.findPrivate(tid, userId, { page: +query.page || 1, pageSize: +query.pageSize || 20, keyword: query.keyword });
  }

  @Post('claim')
  @Permissions('pool:claim')
  @ApiOperation({ summary: '领取客户' })
  claim(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body('customerId', ParseIntPipe) customerId: number) {
    return this.poolService.claim(tid, userId, customerId);
  }

  @Post('assign')
  @Permissions('pool:assign')
  @ApiOperation({ summary: '分配客户' })
  assign(@TenantId() tid: number, @CurrentUser('userId') managerId: number, @Body() dto: { customerIds: number[]; toUserId: number; reason?: string }) {
    return this.poolService.assign(tid, managerId, dto.customerIds, dto.toUserId, dto.reason);
  }

  @Post('batch-assign')
  @Permissions('pool:batch_assign')
  @ApiOperation({ summary: '批量分配' })
  batchAssign(@TenantId() tid: number, @CurrentUser('userId') managerId: number, @Body() dto: { customerIds: number[]; toUserId: number; reason?: string }) {
    return this.poolService.assign(tid, managerId, dto.customerIds, dto.toUserId, dto.reason);
  }

  @Post('return')
  @Permissions('pool:return')
  @ApiOperation({ summary: '退回公海' })
  returnToPublic(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: { customerId: number; reason: string }) {
    return this.poolService.returnToPublic(tid, userId, dto.customerId, dto.reason);
  }

  @Post('transfer')
  @Permissions('pool:transfer')
  @ApiOperation({ summary: '转移客户' })
  transfer(@TenantId() tid: number, @CurrentUser('userId') managerId: number, @Body() dto: { customerId: number; toUserId: number; reason?: string }) {
    return this.poolService.transfer(tid, managerId, dto.customerId, dto.toUserId, dto.reason);
  }

  @Get('logs')
  @Permissions('pool:view_logs')
  @ApiOperation({ summary: '流转日志' })
  findLogs(@TenantId() tid: number, @Query() query: any) {
    return this.poolService.findLogs(tid, { page: +query.page || 1, pageSize: +query.pageSize || 20, customerId: query.customer_id ? +query.customer_id : undefined, userId: query.user_id ? +query.user_id : undefined, action: query.action });
  }

  @Get('statistics')
  @Permissions('pool:read_public')
  @ApiOperation({ summary: '池统计' })
  getStatistics(@TenantId() tid: number) {
    return this.poolService.getStatistics(tid);
  }

  @Post('recycle-check')
  @Permissions('system:pool_config')
  @ApiOperation({ summary: '手动触发回收检查' })
  recycleCheck(@TenantId() tid: number) {
    return this.poolService.autoRecycle(tid);
  }
}
