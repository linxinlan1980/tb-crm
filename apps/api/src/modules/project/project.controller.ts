import { Controller, Get, Post, Put, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectService } from './project.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('项目交付')
@ApiBearerAuth()
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  @Permissions('project:read')
  @ApiOperation({ summary: '项目列表' })
  findAll(@TenantId() tid: number, @Query() query: any) {
    return this.projectService.findAll(tid, { page: +query.page || 1, pageSize: +query.pageSize || 20, status: query.status, stage: query.stage, pmId: query.pm_id ? +query.pm_id : undefined, customerId: query.customer_id ? +query.customer_id : undefined, keyword: query.keyword });
  }

  @Get('workbench')
  @Permissions('project:read')
  @ApiOperation({ summary: 'PM工作台' })
  getWorkbench(@TenantId() tid: number, @CurrentUser('userId') userId: number) {
    return this.projectService.getWorkbench(tid, userId);
  }

  @Get(':id')
  @Permissions('project:read')
  @ApiOperation({ summary: '项目详情' })
  findOne(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.projectService.findOne(tid, id);
  }

  @Post()
  @Permissions('project:create')
  @ApiOperation({ summary: '创建项目/立项' })
  create(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: any) {
    return this.projectService.create(tid, userId, dto);
  }

  @Post(':id/activate')
  @Permissions('project:approve')
  @ApiOperation({ summary: '激活项目（审批通过后）' })
  activate(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.projectService.activate(tid, id);
  }

  @Post('milestones/:milestoneId/complete')
  @Permissions('milestone:complete')
  @ApiOperation({ summary: '确认里程碑完成' })
  completeMilestone(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('milestoneId', ParseIntPipe) milestoneId: number, @Body() dto: { actualDate: string; attachmentIds?: any[] }) {
    return this.projectService.completeMilestone(tid, userId, milestoneId, dto);
  }

  @Post(':id/close')
  @Permissions('project:complete')
  @ApiOperation({ summary: '验收结项' })
  close(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.projectService.close(tid, userId, id, dto);
  }

  @Post(':id/recalc-cost')
  @Permissions('project:view_cost')
  @ApiOperation({ summary: '重算项目成本/毛利' })
  recalcCost(@TenantId() tid: number, @Param('id', ParseIntPipe) id: number) {
    return this.projectService.recalcCost(tid, id);
  }
}
