import { Module } from '@nestjs/common';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';
import { MilestoneService } from './milestone/milestone.service';

@Module({
  controllers: [ContractController],
  providers: [ContractService, MilestoneService],
  exports: [ContractService, MilestoneService],
})
export class ContractModule {}
