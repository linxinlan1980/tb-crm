import { Controller, Get, Put, Post, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('通知中心')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifyService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: '通知列表' })
  findAll(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Query() query: any) {
    return this.notifyService.findAll(tid, userId, { page: +query.page || 1, pageSize: +query.pageSize || 20, isRead: query.is_read !== undefined ? query.is_read === 'true' : undefined });
  }

  @Get('unread-count')
  @ApiOperation({ summary: '未读数量' })
  unreadCount(@TenantId() tid: number, @CurrentUser('userId') userId: number) {
    return this.notifyService.unreadCount(tid, userId);
  }

  @Put(':id/read')
  @ApiOperation({ summary: '标记已读' })
  markRead(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.notifyService.markRead(tid, userId, id);
  }

  @Put('read-all')
  @ApiOperation({ summary: '全部已读' })
  markAllRead(@TenantId() tid: number, @CurrentUser('userId') userId: number) {
    return this.notifyService.markAllRead(tid, userId);
  }
}
