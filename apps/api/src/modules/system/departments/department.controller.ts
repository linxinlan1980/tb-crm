import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DepartmentService } from './department.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { TenantId } from '../../../common/decorators/current-user.decorator';

@ApiTags('系统管理-部门')
@ApiBearerAuth()
@Controller('system/departments')
export class DepartmentController {
  constructor(private readonly deptService: DepartmentService) {}

  @Get('tree')
  @ApiOperation({ summary: '获取部门树' })
  getTree(@TenantId() tenantId: number) {
    return this.deptService.getTree(tenantId);
  }

  @Post()
  @Permissions('system:department')
  @ApiOperation({ summary: '创建部门' })
  create(@TenantId() tenantId: number, @Body() dto: { name: string; code?: string; parentId?: number; leaderId?: number; sortOrder?: number }) {
    return this.deptService.create(tenantId, dto);
  }

  @Put(':id')
  @Permissions('system:department')
  @ApiOperation({ summary: '更新部门' })
  update(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.deptService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @Permissions('system:department')
  @ApiOperation({ summary: '删除部门' })
  remove(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.deptService.remove(tenantId, id);
  }
}
