import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../database/prisma.service';

/**
 * 审计日志拦截器
 * 自动记录所有POST/PUT/DELETE操作到audit_logs表
 * 使用方式：在Controller或Module级别 @UseInterceptors(AuditLogInterceptor)
 *
 * 记录内容：who(user) + when(timestamp) + what(action) + which(object) + from/to(before/after)
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user, ip, headers } = request;

    // 只记录写操作
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          // 异步写入，不阻塞响应
          this.writeLog({
            tenantId: user?.tenantId,
            userId: user?.userId,
            action: this.inferAction(method, url),
            objectType: this.inferObjectType(url),
            objectId: responseData?.id || this.extractIdFromUrl(url),
            objectNo: responseData?.code || responseData?.contractNo || responseData?.orderNo || null,
            afterData: this.sanitize(body),
            ipAddress: ip,
            userAgent: headers['user-agent']?.slice(0, 300),
          }).catch(() => {}); // 静默失败，不影响业务
        },
        error: () => {
          // 失败操作也记录（便于安全审计）
          this.writeLog({
            tenantId: user?.tenantId,
            userId: user?.userId,
            action: this.inferAction(method, url) + '_failed',
            objectType: this.inferObjectType(url),
            objectId: this.extractIdFromUrl(url),
            ipAddress: ip,
            userAgent: headers['user-agent']?.slice(0, 300),
          }).catch(() => {});
        },
      }),
    );
  }

  private async writeLog(data: any) {
    if (!data.tenantId) return;
    await this.prisma.system.auditLog.create({ data });
  }

  private inferAction(method: string, url: string): string {
    if (method === 'POST') return url.includes('/import') ? 'import' : 'create';
    if (method === 'PUT' || method === 'PATCH') return 'update';
    if (method === 'DELETE') return 'delete';
    return method.toLowerCase();
  }

  private inferObjectType(url: string): string {
    // /api/v1/customers/123 → customer
    // /api/v1/system/users → user
    const parts = url.replace('/api/v1/', '').split('/').filter(Boolean);
    const resource = parts[0] || 'unknown';
    // 去复数
    return resource.endsWith('s') ? resource.slice(0, -1) : resource;
  }

  private extractIdFromUrl(url: string): number | null {
    const match = url.match(/\/(\d+)(?:\/|$)/);
    return match ? parseInt(match[1]) : null;
  }

  /** 移除敏感字段（密码/token/密钥） */
  private sanitize(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const clone = { ...body };
    delete clone.password;
    delete clone.passwordHash;
    delete clone.token;
    delete clone.accessToken;
    delete clone.refreshToken;
    delete clone.secret;
    delete clone.apiKey;
    return clone;
  }
}
