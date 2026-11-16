import { PrismaService } from './prisma.service';

describe('Prisma tenant boundary (query extension)', () => {
  const prisma = new PrismaService();
  afterAll(async () => { await prisma.$disconnect(); });
  it('preserves generated model delegates through the real system accessor', () => {
    expect(typeof prisma.system.user.findFirst).toBe('function');
    expect(typeof prisma.system.auditLog.create).toBe('function');
    expect(typeof prisma.forTenant(1).customer.findMany).toBe('function');
  });
  it.each([undefined, 0, -1, NaN, 1.5])('fails closed for missing or invalid tenant %p', (tenant) => {
    expect(() => prisma.forTenant(tenant as number)).toThrow('有效租户上下文缺失');
  });
  async function intercept(model: string, operation: string, args: Record<string, unknown>) {
    let handler: (input: unknown) => Promise<unknown> = async () => null;
    const spy = jest.spyOn(prisma, '$extends').mockImplementation((extension) => {
      if (!extension || typeof extension !== 'object' || !('query' in extension)) return {} as never;
      handler = (extension as { query: { $allModels: { $allOperations: typeof handler } } }).query.$allModels.$allOperations;
      return {} as never;
    });
    prisma.forTenant(1);
    spy.mockRestore();
    const query = jest.fn().mockResolvedValue(null);
    await handler({ model, operation, args, query });
    return query;
  }
  it('overrides spoofed tenant IDs and filters soft deleted customers before lookup', async () => {
    const query = await intercept('Customer', 'findUnique', { where: { id: 2, tenantId: 99 } });
    expect(query).toHaveBeenCalledWith({ where: { id: 2, tenantId: 1, deletedAt: null } });
  });
  it('does not add nonexistent soft-delete fields to audit or relation tables', async () => {
    const query = await intercept('AuditLog', 'findMany', {});
    expect(query).toHaveBeenCalledWith({ where: { tenantId: 1 } });
  });
  it('pins created records to the caller tenant', async () => {
    const query = await intercept('Customer', 'create', { data: { name: 'Fixture', tenantId: 99 } });
    expect(query).toHaveBeenCalledWith({ data: { name: 'Fixture', tenantId: 1 } });
  });
  it('rejects tenant reassignment', async () => {
    await expect(intercept('Customer', 'update', { where: { id: 2 }, data: { tenantId: 99 } })).rejects.toThrow();
  });
  it('rejects system models through tenant clients', async () => {
    await expect(intercept('Tenant', 'findMany', {})).rejects.toThrow();
  });
});
