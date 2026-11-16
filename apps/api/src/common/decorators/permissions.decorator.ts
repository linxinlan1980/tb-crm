import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * 声明端点所需权限点
 * 使用：@Permissions('customer:create') 或 @Permissions('customer:create', 'customer:update')
 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
