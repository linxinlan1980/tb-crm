import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import type { Actor } from '../../../common/types/actor';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AccessPolicyService } from './access-policy.service';
import { accessPolicyContracts } from './access-policy.contract';
@Controller('system/access-policy')
export class AccessPolicyController {
  constructor(private service: AccessPolicyService) {}
  @Get('people/:id') person(@CurrentUser() actor: Actor, @Param('id', ParseIntPipe) id: number) {
    return this.service.person(actor, id);
  }
  @Get('schema') schema() {
    return accessPolicyContracts;
  }
  @Get() state(@CurrentUser() actor: Actor) {
    return this.service.state(actor);
  }
  @Post('roles/:id') save(
    @CurrentUser() actor: Actor,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.save(actor, id, body);
  }
}
