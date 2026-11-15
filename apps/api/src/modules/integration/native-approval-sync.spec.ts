import { NativeApprovalReadError, nativeReadFailure } from './native-approval-sync';
describe('native approval read retry', () => {
  const now = new Date('2026-11-15T00:00:00Z');
  it('retries a network read with bounded backoff and preserves a successful-read timestamp', () => {
    const error = new NativeApprovalReadError({ code: 'ECONNRESET' });
    const first = nativeReadFailure({ lastPolledAt: '2026-11-14T00:00:00Z' }, error, now);
    expect(first.retryCount).toBe(1);
    expect(first.nextRetryAt).toBe('2026-11-15T00:01:00.000Z');
    expect(nativeReadFailure(first, error, now).nextRetryAt).toBe('2026-11-15T00:02:00.000Z');
  });
  it('honors an explicit provider retry interval', () => {
    expect(
      nativeReadFailure(
        {},
        new NativeApprovalReadError({ stdout: JSON.stringify({ retryable: true, retry_after_seconds: 300 }) }),
        now,
      ).nextRetryAt,
    ).toBe('2026-11-15T00:05:00.000Z');
  });
  it('stops after the fifth failure', () => {
    expect(
      nativeReadFailure({ retryCount: 4 }, new NativeApprovalReadError({ code: 'ETIMEDOUT' }), now).nextRetryAt,
    ).toBeNull();
  });
  it.each([
    new Error('identity changed'),
    new NativeApprovalReadError({ code: 'EACCES' }),
    new NativeApprovalReadError({ stdout: 'not-json' }),
  ])('does not retry identity, permission or unknown errors', (error) => {
    expect(nativeReadFailure({}, error, now).nextRetryAt).toBeNull();
  });
});
