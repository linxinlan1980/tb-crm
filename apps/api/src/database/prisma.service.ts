import { Injectable, OnModuleInit, OnModuleDestroy, ForbiddenException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

/** Scoped access fails closed. Fields are checked against the generated model metadata. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }

  forTenant(tenantId: number) {
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
      throw new ForbiddenException({ code: 13, message: '有效租户上下文缺失' });
    }
    // Callback receivers are owned by Prisma, so retain the original client explicitly.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const client = this;
    return this.$extends({ query: { $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const fields = Prisma.dmmf.datamodel.models.find((entry) => entry.name === model)?.fields || [];
        if (!fields.some((field) => field.name === 'tenantId')) {
          throw new ForbiddenException('系统对象必须通过显式系统入口访问');
        }
        const hasSoftDelete = fields.some((field) => field.name === 'deletedAt');
        // Prisma's all-model union cannot express runtime model metadata.
        const scoped = args as Record<string, any>;
        const scope = { tenantId, ...(hasSoftDelete ? { deletedAt: null } : {}) };
        if (['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
          'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany'].includes(operation)) {
          scoped.where = { ...scoped.where, ...scope };
        }
        if (operation === 'upsert') throw new ForbiddenException('租户写入请使用显式创建或更新动作');
        if (['create', 'createMany', 'createManyAndReturn'].includes(operation)) {
          scoped.data = Array.isArray(scoped.data)
            ? scoped.data.map((entry) => ({ ...entry, tenantId })) : { ...scoped.data, tenantId };
        }
        if (['update', 'updateMany'].includes(operation) && scoped.data && 'tenantId' in scoped.data) {
          throw new ForbiddenException('禁止更改记录所属租户');
        }
        if (hasSoftDelete && ['delete', 'deleteMany'].includes(operation)) {
          const delegateName = model[0].toLowerCase() + model.slice(1);
          // Runtime-selected delegate; where is always scoped above.
            const delegate = (client as any)[delegateName];
          return delegate[operation === 'delete' ? 'update' : 'updateMany']({
            where: scoped.where, data: { deletedAt: new Date() },
          });
        }
        return query(args);
      },
    } } });
  }

  /** Only login, explicit transactions and scheduled scans may use system access. */
  get system(): PrismaService { return this; }
}
