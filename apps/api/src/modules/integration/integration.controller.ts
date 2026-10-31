import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { TenantId } from '../../common/decorators/current-user.decorator';
import { DingtalkService } from './dingtalk/dingtalk.service';
import { YonyouService } from './yonyou/yonyou.service';
import { EmailService } from './email/email.service';
import { connectorRegistry } from './connector.interface';

@ApiTags('集成管理')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationController {
  constructor(
    private dingtalk: DingtalkService,
    private yonyou: YonyouService,
    private email: EmailService,
  ) {
    // 注册连接器到全局注册表
    connectorRegistry.register(dingtalk);
    connectorRegistry.register(yonyou);
    connectorRegistry.register(email);
  }

  @Get()
  @Permissions('system:integration')
  @ApiOperation({ summary: '已启用集成列表' })
  async list() {
    const connectors = connectorRegistry.list();
    const statuses = await connectorRegistry.healthCheckAll();
    return connectors.map((c) => ({ code: c.code, name: c.name, ...statuses[c.code] }));
  }

  @Post(':code/test')
  @Permissions('system:integration')
  @ApiOperation({ summary: '连接测试' })
  async test(@Param('code') code: string) {
    const connector = connectorRegistry.get(code);
    if (!connector) return { success: false, error: `连接器 ${code} 不存在` };
    const status = await connector.healthCheck();
    return status;
  }

  @Post(':code/sync')
  @Permissions('system:integration')
  @ApiOperation({ summary: '手动触发同步' })
  async sync(@TenantId() tid: number, @Param('code') code: string, @Body() payload: any) {
    const connector = connectorRegistry.get(code);
    if (!connector) return { success: false, error: `连接器 ${code} 不存在` };
    return connector.sync(payload.direction || 'outbound', payload);
  }
}
