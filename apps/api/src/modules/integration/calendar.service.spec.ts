import { calendarDate } from './calendar.service';
import { ActivitySyncService } from './activity-sync.service';
import type { PrismaService } from '../../database/prisma.service';
describe('calendar input and optional integration startup', () => {
  it('normalizes valid Shanghai dates to the same instant', () => {
    expect(calendarDate('2026-11-16T12:00:00+08:00').toISOString()).toBe('2026-11-16T04:00:00.000Z');
  });
  it('normalizes subsecond input to the provider-supported second precision', () => {
    expect(calendarDate('2026-11-16T12:00:00.123+08:00').toISOString()).toBe('2026-11-16T04:00:00.000Z');
  });
  it('rejects missing timezone, nonexistent dates and overflow hours', () => {
    for (const value of ['2026-11-16T12:00:00', '2026-02-30T12:00:00Z', '2026-11-16T24:00:00Z', 'invalid', null])
      expect(() => calendarDate(value)).toThrow();
  });
  it('does not query new tables for an unbound pre-migration installation', async () => {
    const names = ['DWS_PROFILE', 'DWS_EXPECTED_CORP_ID', 'DWS_EXPECTED_USER_ID'] as const;
    const saved = names.map((k) => process.env[k]);
    names.forEach((k) => delete process.env[k]);
    const updateMany = jest.fn();
    const service = new ActivitySyncService({
      system: { activitySyncJob: { updateMany } },
    } as unknown as PrismaService);
    try {
      await service.onModuleInit();
      expect(updateMany).not.toHaveBeenCalled();
    } finally {
      service.onModuleDestroy();
      names.forEach((k, i) => {
        if (saved[i] === undefined) delete process.env[k];
        else process.env[k] = saved[i];
      });
    }
  });
});
