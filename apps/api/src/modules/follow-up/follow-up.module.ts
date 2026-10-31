import { Module } from '@nestjs/common';
import { FollowUpController } from './follow-up.controller';
import { FollowUpService } from './follow-up.service';
import { ActionPlanController } from './action-plan.controller';
import { ActionPlanService } from './action-plan.service';

@Module({
  controllers: [FollowUpController, ActionPlanController],
  providers: [FollowUpService, ActionPlanService],
  exports: [FollowUpService, ActionPlanService],
})
export class FollowUpModule {}
