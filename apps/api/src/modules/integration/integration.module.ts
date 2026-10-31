import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { PlatformService } from './platform.service';
@Module({controllers:[IntegrationController],providers:[PlatformService],exports:[PlatformService]})
export class IntegrationModule {}
