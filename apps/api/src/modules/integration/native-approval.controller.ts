import { BadRequestException, HttpException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { NativeApprovalService } from './native-approval.service';
import { nativeApprovalCapabilities } from './native-approval.contract';
@Controller('integrations/dingtalk-native-approval')
export class NativeApprovalController {
  constructor(private readonly service: NativeApprovalService) {}
  private safe<T>(promise: Promise<T>) {
    return promise.catch((e: unknown) => {
      if (e instanceof HttpException) throw e;
      throw new BadRequestException(e instanceof Error ? e.message : '钉钉审批核对失败，未变更本地审批');
    });
  }
  @Get('schema') schema() {
    return nativeApprovalCapabilities;
  }
  @Get() state(@CurrentUser() a: Actor) {
    return this.safe(this.service.state(a));
  }
  @Post('settings') configure(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.safe(this.service.configure(a, b));
  }
  @Post('probe') probe(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.safe(this.service.probe(a, b));
  }
  @Post('prepare') prepare(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.safe(this.service.prepare(a, b));
  }
  @Post('runs/:id/dispatch') dispatch(
    @CurrentUser() a: Actor,
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.safe(this.service.dispatch(a, id, b));
  }
  @Post('runs/:id/reconcile') reconcile(
    @CurrentUser() a: Actor,
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.safe(this.service.reconcile(a, id, b));
  }
}
