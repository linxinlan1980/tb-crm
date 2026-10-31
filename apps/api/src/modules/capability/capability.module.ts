import { WorkspaceModule } from '../workspace/workspace.module';
import { ApprovalModule } from '../approval/approval.module';
import { McpController } from './mcp.controller';
import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module';
import { CapabilityController } from './capability.controller';
import { CapabilityService } from './capability.service';

@Module({
  imports: [CustomerModule, WorkspaceModule, ApprovalModule],
  controllers: [CapabilityController, McpController],
  providers: [CapabilityService],
})
export class CapabilityModule {}
