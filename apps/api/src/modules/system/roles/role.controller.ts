import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RoleService } from './role.service';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { TenantId } from '../../../common/decorators/current-user.decorator';

@ApiTags('系统管理-角色')
@ApiBearerAuth()
@Controller('system/roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @Permissions('system:role')
  @ApiOperation({ summary: '角色列表' })
  findAll(@TenantId() tid: number) { return this.roleService.findAll(tid); }

  @Get(':id')
  @Permissions('system:role')
  @ApiOperation({ summary: '角色详情' })
  findOne(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) { return this.roleService.findOne(tid, id); }

  @Post()
  @Permissions('system:role')
  @ApiOperation({ summary: '创建角色' })
  create(@TenantId() tid: number, @Body() dto: any) { return this.roleService.create(tid, dto); }

  @Put(':id')
  @Permissions('system:role')
  @ApiOperation({ summary: '更新角色' })
  update(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.roleService.update(tid, id, dto); }

  @Delete(':id')
  @Permissions('system:role')
  @ApiOperation({ summary: '删除角色' })
  remove(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) { return this.roleService.remove(tid, id); }
}
