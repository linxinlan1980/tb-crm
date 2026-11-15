import { CalendarController, ActivitySyncController } from './activity.controller';
import { CalendarService } from './calendar.service';
import { ActivitySyncService } from './activity-sync.service';
import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { PlatformService } from './platform.service';
import { DirectorySyncController } from './directory-sync.controller';
import { DirectorySyncService } from './directory-sync.service';
@Module({
  controllers: [IntegrationController, DirectorySyncController, CalendarController, ActivitySyncController],
  providers: [PlatformService, DirectorySyncService, CalendarService, ActivitySyncService],
  exports: [PlatformService],
})
export class IntegrationModule {}
