import type { Actor } from '../../common/types/actor';
import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('客户管理')
@ApiBearerAuth()
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  @Permissions('customer:read')
  @ApiOperation({ summary: '客户列表（分页+筛选+排序）' })
  findAll(@TenantId() tid: number, @CurrentUser() actor: Actor, @Query() query: any) {
    return this.customerService.findAll(tid, {
      page: +query.page || 1, pageSize: +query.pageSize || 20,
      poolType: query.pool_type, industry: query.industry, level: query.level,
      ownerId: query.owner_id ? +query.owner_id : undefined, status: query.status,
      keyword: query.keyword, tag: query.tag, sort: query.sort, order: query.order,
    }, actor);
  }

  @Get('group-tree')
  @Permissions('customer:read')
  @ApiOperation({ summary: '集团-子公司树' })
  getGroupTree(@TenantId() tid: number) {
    return this.customerService.getGroupTree(tid);
  }

  @Post('check-duplicate')
  @Permissions('customer:create')
  @ApiOperation({ summary: '去重校验' })
  checkDuplicate(@TenantId() tid: number, @Body() dto: { name?: string; creditCode?: string }) {
    return this.customerService.checkDuplicate(tid, dto);
  }

  @Get(':id')
  @Permissions('customer:read')
  @ApiOperation({ summary: '客户详情（360°）' })
  findOne(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() actor: Actor) {
    return this.customerService.findOne(tid, id, actor);
  }

  @Post()
  @Permissions('customer:create')
  @ApiOperation({ summary: '创建客户' })
  create(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: any) {
    return this.customerService.create(tid, userId, dto);
  }

  @Put(':id')
  @Permissions('customer:update')
  @ApiOperation({ summary: '更新客户' })
  update(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.customerService.update(tid, userId, id, dto);
  }

  @Delete(':id')
  @Permissions('customer:delete')
  @ApiOperation({ summary: '删除客户（软删除）' })
  remove(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.customerService.remove(tid, userId, id);
  }

  @Get(':id/statistics')
  @Permissions('customer:read')
  @ApiOperation({ summary: '客户统计' })
  getStatistics(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.customerService.getStatistics(tid, id);
  }
}
