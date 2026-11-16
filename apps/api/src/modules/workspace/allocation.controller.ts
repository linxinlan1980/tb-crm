import { Body, Controller, Get, Post } from '@nestjs/common';
import type { Actor } from '../../common/types/actor';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceService } from './workspace.service';
import { allocationContracts } from './allocation.contract';
@Controller('customer-allocation')
export class AllocationController {
  constructor(private service: WorkspaceService) {}
  @Get('history') history(@CurrentUser() actor: Actor) {
    return this.service.allocationHistory(actor);
  }
  @Get('schema') schema() {
    return allocationContracts;
  }
  @Get('people') people(@CurrentUser() actor: Actor) {
    return this.service.allocationPeople(actor);
  }
  @Get('owners') owners(@CurrentUser() actor: Actor) {
    return this.service.allocationOwners(actor);
  }
  @Post('preview') preview(@CurrentUser() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.service.allocationPreview(actor, body);
  }
  @Post('commit') commit(@CurrentUser() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.service.allocationCommit(actor, body);
  }
}
