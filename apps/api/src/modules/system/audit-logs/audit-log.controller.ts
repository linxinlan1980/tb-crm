import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { TenantId } from '../../../common/decorators/current-user.decorator';

@ApiTags('系统管理-操作日志')
@ApiBearerAuth()
@Controller('system/audit-logs')
export class AuditLogController {
  constructor(private readonly auditService: AuditLogService) {}

  @Get()
  @Permissions('system:audit_log')
  @ApiOperation({ summary: '查询操作日志' })
  findAll(@TenantId() tid: number, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('userId') userId?: string, @Query('objectType') objectType?: string, @Query('objectId') objectId?: string, @Query('action') action?: string, @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.auditService.findAll(tid, { page: Number(page) || 1, pageSize: Number(pageSize) || 20, userId: userId ? +userId : undefined, objectType, objectId: objectId ? +objectId : undefined, action, dateFrom, dateTo });
  }
}
