import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  catch(error: unknown, host: ArgumentsHost): void {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : null;
    const details = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
    if (status >= 500) this.logger.error(error instanceof Error ? error.stack : 'Unhandled exception');
    host.switchToHttp().getResponse<Response>().status(status).json({
      code: details.code ?? status,
      message: status >= 500 ? '系统异常，请联系管理员' : details.message ?? body ?? '请求失败',
    });
  }
}
