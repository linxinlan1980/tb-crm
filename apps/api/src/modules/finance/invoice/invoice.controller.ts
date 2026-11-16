import { ApiExcludeController } from '@nestjs/swagger';
import { Controller, Get, Post, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InvoiceService } from './invoice.service';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../../common/decorators/current-user.decorator';

@ApiTags('财务-发票管理')
@ApiBearerAuth()
@ApiExcludeController()
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Get()
  @Permissions('invoice:read')
  @ApiOperation({ summary: '发票列表' })
  findAll(@TenantId() tid: number, @Query() query: any) {
    return this.invoiceService.findAll(tid, { page: +query.page || 1, pageSize: +query.pageSize || 20, contractId: query.contract_id ? +query.contract_id : undefined, customerId: query.customer_id ? +query.customer_id : undefined, status: query.status });
  }

  @Post()
  @Permissions('invoice:create')
  @ApiOperation({ summary: '开票申请' })
  create(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: any) {
    return this.invoiceService.create(tid, userId, dto);
  }

  @Post(':id/issue')
  @Permissions('invoice:issue')
  @ApiOperation({ summary: '确认开票（填实际发票号）' })
  issue(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.invoiceService.issue(tid, userId, id, dto);
  }
}
