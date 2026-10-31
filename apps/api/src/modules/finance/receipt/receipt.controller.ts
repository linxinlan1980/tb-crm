import { Controller, Get, Post, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReceiptService } from './receipt.service';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../../common/decorators/current-user.decorator';

@ApiTags('财务-收款核销')
@ApiBearerAuth()
@Controller('finance/receipts')
export class ReceiptController {
  constructor(private readonly receiptService: ReceiptService) {}

  @Post()
  @Permissions('receipt:create')
  @ApiOperation({ summary: '创建收款单（草稿）' })
  create(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: any) {
    return this.receiptService.create(tid, userId, dto);
  }

  @Post(':id/confirm')
  @Permissions('receipt:confirm')
  @ApiOperation({ summary: '确认收款（核销生效）' })
  confirm(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.receiptService.confirm(tid, userId, id);
  }

  @Post(':id/void')
  @Permissions('receipt:void')
  @ApiOperation({ summary: '作废收款' })
  void(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body('reason') reason: string) {
    return this.receiptService.void(tid, userId, id, reason);
  }

  @Get('audit')
  @Permissions('finance:read')
  @ApiOperation({ summary: '审计自洽检查' })
  audit(@TenantId() tid: number) {
    return this.receiptService.audit(tid);
  }
}
