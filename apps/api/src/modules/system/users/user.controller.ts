import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { TenantId } from '../../../common/decorators/current-user.decorator';

@ApiTags('系统管理-用户')
@ApiBearerAuth()
@Controller('system/users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @Permissions('system:user')
  @ApiOperation({ summary: '用户列表' })
  findAll(@TenantId() tid: number, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('deptId') deptId?: string, @Query('status') status?: string, @Query('keyword') keyword?: string) {
    return this.userService.findAll(tid, { page: Number(page) || 1, pageSize: Number(pageSize) || 20, deptId: deptId ? +deptId : undefined, status, keyword });
  }

  @Get(':id')
  @Permissions('system:user')
  @ApiOperation({ summary: '用户详情' })
  findOne(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(tid, id);
  }

  @Post()
  @Permissions('system:user')
  @ApiOperation({ summary: '创建用户' })
  create(@TenantId() tid: number, @Body() dto: any) {
    return this.userService.create(tid, dto);
  }

  @Put(':id')
  @Permissions('system:user')
  @ApiOperation({ summary: '更新用户' })
  update(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.userService.update(tid, id, dto);
  }

  @Post(':id/reset-password')
  @Permissions('system:user')
  @ApiOperation({ summary: '重置密码' })
  resetPassword(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number, @Body('password') password: string) {
    return this.userService.resetPassword(tid, id, password);
  }

  @Delete(':id')
  @Permissions('system:user')
  @ApiOperation({ summary: '停用用户' })
  remove(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.userService.remove(tid, id);
  }
}
