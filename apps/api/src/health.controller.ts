import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@ApiTags('系统')
@Controller()
export class HealthController {
  @Get('health')
  @Public()
  @ApiOperation({ summary: '健康检查' })
  check() {
    return {
      status: 'ok',
      service: 'partneros-crm-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
