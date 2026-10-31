import { PrismaClient } from '@prisma/client';

/**
 * 共享PrismaClient实例（单例）
 * 多租户Scope通过 apps/api/src/database/prisma.service.ts 的 forTenant() 实现
 * 此处仅导出裸Client供seed脚本/worker/migration使用
 */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({ log: ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export { PrismaClient };
