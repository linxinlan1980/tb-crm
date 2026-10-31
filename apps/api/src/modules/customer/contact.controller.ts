import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ContactService } from './contact.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('客户管理-联系人')
@ApiBearerAuth()
@Controller()
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Get('customers/:id/contacts')
  @Permissions('customer:read')
  @ApiOperation({ summary: '联系人列表' })
  findByCustomer(@TenantId() tid: number, @Param('id', ParseIntPipe) customerId: number) {
    return this.contactService.findByCustomer(tid, customerId);
  }

  @Post('customers/:id/contacts')
  @Permissions('customer:create')
  @ApiOperation({ summary: '创建联系人' })
  create(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) customerId: number, @Body() dto: any) {
    return this.contactService.create(tid, userId, customerId, dto);
  }

  @Put('contacts/:id')
  @Permissions('customer:update')
  @ApiOperation({ summary: '更新联系人' })
  update(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.contactService.update(tid, id, dto);
  }

  @Delete('contacts/:id')
  @Permissions('customer:update')
  @ApiOperation({ summary: '删除联系人' })
  remove(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.contactService.remove(tid, id);
  }
}
