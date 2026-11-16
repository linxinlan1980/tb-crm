import { createHash } from 'node:crypto';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { SourceArchiveService } from './source-archive.service';
import type { Actor } from '../../common/types/actor';
import type { PrismaService } from '../../database/prisma.service';
const actor: Actor = { tenantId: 1, userId: 1, deptId: null, roles: ['super_admin'], permissions: ['*'], dataScope: 'all', sessionId: 'synthetic-session' };
function setup(options: { revoked?: boolean; foreign?: boolean; corrupt?: boolean } = {}) {
  const bytes = Buffer.from('synthetic workbook');
  const archive = { id: '00000000-0000-4000-8000-000000000001', tenantId: 1, filename: 'synthetic.xlsx', size: bytes.length, contentBytes: options.corrupt ? Buffer.from('changed') : bytes, sha256: createHash('sha256').update(bytes).digest('hex'), sheets: [{ name: '来源', headers: ['甲方', '金额'], rows: [{ sourceRow: 3, cells: ['公司甲', 10] }, { sourceRow: 4, cells: ['公司乙', 20] }] }] };
  const tx = {
    authSession: { findFirst: jest.fn().mockResolvedValue(options.revoked ? null : { id: actor.sessionId }) },
    user: { findFirst: jest.fn().mockResolvedValue({ deptId: null, roles: [{ role: { code: 'super_admin', permissions: ['*'], dataScope: 'all' } }] }) },
    sourceArchive: { findFirst: jest.fn().mockImplementation(({ where }: { where: { tenantId: number } }) => options.foreign || where.tenantId !== 1 ? null : archive), findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = { system: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } } as unknown as PrismaService;
  return { service: new SourceArchiveService(prisma), tx, archive };
}
describe('historical source privacy and integrity', () => {
  it('rejects non-admins despite broad business read permissions', async () => {
    const { service } = setup();
    await expect(service.list({ ...actor, roles: ['gm'] })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rechecks revoked sessions before reading source rows', async () => {
    const { service, archive } = setup({ revoked: true });
    await expect(service.rows(actor, archive.id, {})).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not disclose another company source', async () => {
    const { service, archive } = setup({ foreign: true });
    await expect(service.rows(actor, archive.id, {})).rejects.toBeInstanceOf(NotFoundException);
  });
  it('retains original row numbers and safely filters bounded rows', async () => {
    const { service, archive, tx } = setup();
    const r = await service.rows(actor, archive.id, { keyword: '公司乙' });
    expect(r.items).toEqual([{ sourceRow: 4, cells: ['公司乙', 20] }]);
    expect(r.meta.total).toBe(1);
    expect(tx.sourceArchive.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: archive.id, tenantId: 1 } }));
    expect(r.archive.sheets).toBeUndefined();
  });
  it('rejects invalid pagination and checksum corruption', async () => {
    const { service, archive } = setup({ corrupt: true });
    await expect(service.rows(actor, archive.id, { page: '-1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.download(actor, archive.id)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('audits downloads without storing document bytes in the audit', async () => {
    const { service, archive, tx } = setup();
    const r = await service.download(actor, archive.id);
    expect(createHash('sha256').update(Buffer.from(r.contentBase64, 'base64')).digest('hex')).toBe(archive.sha256);
    expect(tx.auditLog.create.mock.calls[0][0].data.afterData).toEqual({ id: archive.id, sha256: archive.sha256 });
  });
});
