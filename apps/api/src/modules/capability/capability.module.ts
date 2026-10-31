import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module';
import { CapabilityController } from './capability.controller';
import { CapabilityService } from './capability.service';

@Module({ imports: [CustomerModule], controllers: [CapabilityController], providers: [CapabilityService] })
export class CapabilityModule {}
