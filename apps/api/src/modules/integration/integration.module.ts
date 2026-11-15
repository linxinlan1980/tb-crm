import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { PlatformService } from './platform.service';
import { DirectorySyncController } from './directory-sync.controller';
import { DirectorySyncService } from './directory-sync.service';
@Module({
  controllers: [IntegrationController, DirectorySyncController],
  providers: [PlatformService, DirectorySyncService],
  exports: [PlatformService],
})
export class IntegrationModule {}
