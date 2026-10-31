import { Controller, Get, Post, Put, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ContractService } from './contract.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('合同管理')
@ApiBearerAuth()
@Controller('contracts')
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  @Get()
  @Permissions('contract:read')
  @ApiOperation({ summary: '合同列表' })
  findAll(@TenantId() tid: number, @Query() query: any) {
    return this.contractService.findAll(tid, { page: +query.page || 1, pageSize: +query.pageSize || 20, status: query.status, contractType: query.contract_type, customerId: query.customer_id ? +query.customer_id : undefined, ownerId: query.owner_id ? +query.owner_id : undefined, keyword: query.keyword, expiringDays: query.expiring_days ? +query.expiring_days : undefined });
  }

  @Get('expiring')
  @Permissions('contract:read')
  @ApiOperation({ summary: '即将到期合同（90天内）' })
  getExpiring(@TenantId() tid: number) {
    return this.contractService.checkExpiring(tid);
  }

  @Get(':id')
  @Permissions('contract:read')
  @ApiOperation({ summary: '合同详情' })
  findOne(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.contractService.findOne(tid, id);
  }

  @Post()
  @Permissions('contract:create')
  @ApiOperation({ summary: '创建合同' })
  create(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: any) {
    return this.contractService.create(tid, userId, dto);
  }

  @Post(':id/sign')
  @Permissions('contract:sign')
  @ApiOperation({ summary: '确认签约（触发里程碑+回款计划+立项）' })
  sign(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: { signDate: string; signedByCustomer?: string; signedByUs?: string; sealType?: string }) {
    return this.contractService.sign(tid, userId, id, dto);
  }

  @Post(':id/terminate')
  @Permissions('contract:terminate')
  @ApiOperation({ summary: '终止合同' })
  terminate(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body('reason') reason: string) {
    return this.contractService.terminate(tid, userId, id, reason);
  }
}
