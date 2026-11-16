import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { CapabilityService } from './capability.service';

@ApiTags('业务能力')
@ApiBearerAuth()
@Controller('capabilities')
export class CapabilityController {
  constructor(private readonly capabilities: CapabilityService) {}
  @Get()
  list(@CurrentUser() actor: Actor) {
    return this.capabilities.list(actor);
  }
  @Post(':id/invoke')
  invoke(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() input: unknown) {
    return this.capabilities.invoke(actor, id, input);
  }
}
