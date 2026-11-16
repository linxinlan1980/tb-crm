import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 标记端点为公开（不需要JWT认证）
 * 使用：@Public()
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
