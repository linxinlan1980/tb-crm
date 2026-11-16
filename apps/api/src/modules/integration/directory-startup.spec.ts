import { PrismaService } from '../../database/prisma.service';
import { DepartmentService } from '../system/departments/department.service';
import { UserService } from '../system/users/user.service';
import { DirectorySyncService } from './directory-sync.service';
describe('optional directory bridge startup compatibility', () => {
  const previous = { ...process.env };
  afterEach(() => {
    for (const key of ['DWS_PROFILE', 'DWS_EXPECTED_CORP_ID', 'DWS_EXPECTED_USER_ID']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  function service(updateMany?: jest.Mock) {
    return new DirectorySyncService(
      { system: updateMany ? { integrationRun: { updateMany } } : {} } as unknown as PrismaService,
      {} as DepartmentService,
      {} as UserService,
    );
  }
  function bind() {
    process.env.DWS_PROFILE = 'fixture';
    process.env.DWS_EXPECTED_CORP_ID = 'fixture-corp';
    process.env.DWS_EXPECTED_USER_ID = 'fixture-reader';
  }
  it('does not touch optional integration tables when no profile is bound', async () => {
    delete process.env.DWS_PROFILE;
    await expect(service().onModuleInit()).resolves.toBeUndefined();
  });
  it('marks unfinished reads interrupted for a bound installation', async () => {
    bind();
    const update = jest.fn().mockResolvedValue({ count: 1 });
    await service(update).onModuleInit();
    expect(update).toHaveBeenCalledWith({
      where: { provider: 'dws-dingtalk', kind: 'directory', status: 'reading' },
      data: { status: 'interrupted' },
    });
  });
  it('does not swallow missing-migration failures when the bridge is bound', async () => {
    bind();
    const failure = new Error('missing integration table');
    await expect(service(jest.fn().mockRejectedValue(failure)).onModuleInit()).rejects.toBe(failure);
  });
});
