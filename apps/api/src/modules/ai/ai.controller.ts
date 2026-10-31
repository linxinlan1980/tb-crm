import { Controller, Post, Get, Body, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AiGatewayService } from './gateway/ai-gateway.service';
import { SummaryScene } from './scenes/summary.scene';
import { ProfileScene } from './scenes/profile.scene';
import { RecommendScene } from './scenes/recommend.scene';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/current-user.decorator';

@ApiTags('AI副驾驶')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private gateway: AiGatewayService,
    private summaryScene: SummaryScene,
    private profileScene: ProfileScene,
    private recommendScene: RecommendScene,
  ) {}

  @Post('summary')
  @Permissions('ai:use')
  @ApiOperation({ summary: '跟进纪要AI整理' })
  summary(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Body() dto: { rawText: string; targetType: string; targetId: number; customerName?: string; contactName?: string; opportunityStage?: string }) {
    return this.summaryScene.execute(tid, userId, dto);
  }

  @Post('customer-profile/:customerId')
  @Permissions('ai:use')
  @ApiOperation({ summary: '客户画像生成/刷新' })
  customerProfile(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('customerId', ParseIntPipe) customerId: number) {
    return this.profileScene.execute(tid, userId, customerId);
  }

  @Get('action-recommend/:targetType/:targetId')
  @Permissions('ai:use')
  @ApiOperation({ summary: '下一步行动推荐' })
  actionRecommend(@TenantId() tid: number, @CurrentUser('userId') userId: number, @Param('targetType') targetType: 'customer' | 'opportunity', @Param('targetId', ParseIntPipe) targetId: number) {
    return this.recommendScene.execute(tid, userId, targetType, targetId);
  }

  @Get('usage')
  @Permissions('ai:view_usage')
  @ApiOperation({ summary: 'Token用量统计' })
  async usage(@TenantId() tid: number) {
    return this.gateway.checkQuota(tid);
  }
}
