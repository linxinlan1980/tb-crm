import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FollowUpService } from './follow-up.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('跟进记录')
@ApiBearerAuth()
@Controller('follow-ups')
export class FollowUpController {
  constructor(private readonly followUpService: FollowUpService) {}

  @Get()
  @Permissions('customer:read')
  @ApiOperation({ summary: '跟进记录列表' })
  findAll(@TenantId() tid: number, @Query() query: any) {
    return this.followUpService.findAll(tid, { targetType: query.target_type, targetId: query.target_id ? +query.target_id : undefined, customerId: query.customer_id ? +query.customer_id : undefined, createdBy: query.created_by ? +query.created_by : undefined, page: +query.page || 1, pageSize: +query.pageSize || 20 });
  }

  @Post()
  @Permissions('follow_up:create')
  @ApiOperation({ summary: '创建跟进记录' })
  create(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: any) {
    return this.followUpService.create(tid, userId, dto);
  }

  @Put(':id')
  @Permissions('follow_up:create')
  @ApiOperation({ summary: '编辑跟进记录（限24h内）' })
  update(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.followUpService.update(tid, userId, id, dto);
  }

  @Delete(':id')
  @Permissions('follow_up:create')
  @ApiOperation({ summary: '删除跟进记录（限24h内）' })
  remove(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.followUpService.remove(tid, userId, id);
  }
}
