import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

/**
 * 权限守卫：检查当前用户是否拥有所需权限点
 *
 * 使用方式：@Permissions('customer:create') 或 @Permissions('customer:*')
 * 权限匹配规则：
 *   - '*' 匹配所有
 *   - 'customer:*' 匹配customer模块所有操作
 *   - 'customer:create' 精确匹配
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true; // No permissions required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException({ code: 3, message: '无权执行此操作' });
    }

    // super_admin has all permissions
    if (user.roles?.includes('super_admin')) {
      return true;
    }

    const userPermissions: string[] = user.permissions || [];

    const hasPermission = requiredPermissions.some((required) => {
      // Exact match
      if (userPermissions.includes(required)) return true;
      // Wildcard: '*' matches all
      if (userPermissions.includes('*')) return true;
      // Module wildcard: 'customer:*' matches 'customer:create'
      const modulePrefix = required.split(':')[0];
      if (userPermissions.includes(`${modulePrefix}:*`)) return true;
      return false;
    });

    if (!hasPermission) {
      throw new ForbiddenException({
        code: 3,
        message: `无权执行此操作（需要权限：${requiredPermissions.join(', ')}）`,
      });
    }

    return true;
  }
}
