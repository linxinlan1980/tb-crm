import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { Actor } from '../../common/types/actor';
import { DirectorySyncService } from './directory-sync.service';
import { directoryCapabilities } from './directory-contract';
@Controller('integrations/dingtalk-bridge')
@Permissions('system:integration')
export class DirectorySyncController {
  constructor(private service: DirectorySyncService) {}
  @Get('schema') schema() {
    return directoryCapabilities;
  }
  @Get() state(@CurrentUser() actor: Actor) {
    return this.service.state(actor);
  }
  @Post('settings') configure(@CurrentUser() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.service.configure(actor, body);
  }
  @Post('directory/preview') preview(@CurrentUser() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.service.preview(actor, body);
  }
  @Post('directory/apply') apply(@CurrentUser() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.service.apply(actor, body);
  }
}
