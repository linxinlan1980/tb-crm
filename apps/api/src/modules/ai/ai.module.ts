import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiGatewayService } from './gateway/ai-gateway.service';
import { SummaryScene } from './scenes/summary.scene';
import { ProfileScene } from './scenes/profile.scene';
import { RecommendScene } from './scenes/recommend.scene';

@Module({
  controllers: [AiController],
  providers: [AiGatewayService, SummaryScene, ProfileScene, RecommendScene],
  exports: [AiGatewayService],
})
export class AiModule {}
