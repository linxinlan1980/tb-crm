import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { DingtalkService } from './dingtalk/dingtalk.service';
import { YonyouService } from './yonyou/yonyou.service';
import { EmailService } from './email/email.service';

@Module({
  controllers: [IntegrationController],
  providers: [DingtalkService, YonyouService, EmailService],
  exports: [DingtalkService, YonyouService, EmailService],
})
export class IntegrationModule {}
