import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 获取当前请求用户信息
 * 使用：@CurrentUser() user / @CurrentUser('userId') userId
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return null;
    return data ? user[data] : user;
  },
);

/**
 * 获取当前租户ID
 * 使用：@TenantId() tenantId: number
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.tenantId;
  },
);
