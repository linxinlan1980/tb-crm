import { ApiExcludeController } from '@nestjs/swagger';
import { Controller, Get, Post, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrderService } from './order.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('订单管理')
@ApiBearerAuth()
@ApiExcludeController()
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @Permissions('order:read')
  @ApiOperation({ summary: '订单列表' })
  findAll(@TenantId() tid: number, @Query() query: any) {
    return this.orderService.findAll(tid, { page: +query.page || 1, pageSize: +query.pageSize || 20, contractId: query.contract_id ? +query.contract_id : undefined, customerId: query.customer_id ? +query.customer_id : undefined, status: query.status });
  }

  @Get(':id')
  @Permissions('order:read')
  @ApiOperation({ summary: '订单详情' })
  findOne(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.orderService.findOne(tid, id);
  }

  @Post()
  @Permissions('order:create')
  @ApiOperation({ summary: '创建订单' })
  create(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: any) {
    return this.orderService.create(tid, userId, dto);
  }

  @Post(':id/confirm')
  @Permissions('order:confirm')
  @ApiOperation({ summary: '确认订单（含信用校验）' })
  confirm(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body('overrideReason') overrideReason?: string) {
    return this.orderService.confirm(tid, userId, id, overrideReason);
  }

  @Post('credit-check')
  @Permissions('order:read')
  @ApiOperation({ summary: '信用预检' })
  creditCheck(@TenantId() tid: number, @Body() dto: { customerId: number; amount: number; contractId?: number }) {
    return this.orderService.creditCheck(tid, dto.customerId, dto.amount, dto.contractId);
  }
}
