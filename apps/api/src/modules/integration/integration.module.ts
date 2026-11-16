import { ApprovalModule } from '../approval/approval.module';
import { NativeApprovalController } from './native-approval.controller';
import { NativeApprovalService } from './native-approval.service';
import { CalendarController, ActivitySyncController } from './activity.controller';
import { CalendarService } from './calendar.service';
import { ActivitySyncService } from './activity-sync.service';
import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { PlatformService } from './platform.service';
import { DirectorySyncController } from './directory-sync.controller';
import { DirectorySyncService } from './directory-sync.service';
import { CalendarInboundService } from './calendar-inbound.service';
@Module({
  imports:[ApprovalModule],
  controllers: [NativeApprovalController,IntegrationController, DirectorySyncController, CalendarController, ActivitySyncController],
  providers: [NativeApprovalService,PlatformService, DirectorySyncService, CalendarService, ActivitySyncService, CalendarInboundService],
  exports: [PlatformService],
})
export class IntegrationModule {}
