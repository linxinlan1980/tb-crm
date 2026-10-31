import { Controller, Get, Post, Param, Query, BadRequestException } from '@nestjs/common';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { PlatformService, platform } from './platform.service';
@Controller('integrations')
@Permissions('system:integration')
export class IntegrationController {
  constructor(private readonly service: PlatformService) {}
  @Get() list(@CurrentUser() a: Actor) {
    return this.service.statuses(a);
  }
  @Post(':code/test') test(@CurrentUser() a: Actor, @Param('code') code: string) {
    return this.service.test(platform(code), a);
  }
  @Get(':code/directory') directory(
    @CurrentUser() a: Actor,
    @Param('code') code: string,
    @Query() q: Record<string, string>,
  ) {
    return this.service.directory(platform(code), a, q);
  }
  @Get(':code/departments') departments(
    @CurrentUser() a: Actor,
    @Param('code') code: string,
    @Query() q: Record<string, string>,
  ) {
    return this.service.departments(platform(code), a, q);
  }
  @Post(':code/sync') sync() {
    throw new BadRequestException('请先预览并核对身份映射；自动导入与外发审批同步尚未开放');
  }
}
