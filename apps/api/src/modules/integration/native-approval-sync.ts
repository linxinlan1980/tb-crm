/** Only transient read failures may retry; never retry native approval creation. */
export class NativeApprovalReadError extends Error {
  readonly retryable: boolean;
  readonly retryAfterSeconds: number;
  constructor(cause: unknown) {
    super('钉钉审批结果读取失败，请核对网络、工具授权及同步记录');
    const e = cause && typeof cause === 'object' ? (cause as Record<string, unknown>) : {};
    let detail: Record<string, unknown> = e;
    if (typeof e.stdout === 'string') {
      try {
        const parsed: unknown = JSON.parse(e.stdout);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) detail = parsed as Record<string, unknown>;
      } catch {
        /* Keep unknown failures non-retryable. */
      }
    }
    this.retryable =
      detail.retryable === true || ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ECONNREFUSED'].includes(String(e.code));
    const seconds = Number(detail.retry_after_seconds);
    this.retryAfterSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
  }
}
export function nativeReadFailure(previous: Record<string, unknown>, error: unknown, now: Date) {
  const oldCount = Number(previous.retryCount);
  const retryCount = (Number.isSafeInteger(oldCount) && oldCount >= 0 ? oldCount : 0) + 1;
  const retryable = error instanceof NativeApprovalReadError && error.retryable && retryCount < 5;
  const seconds =
    error instanceof NativeApprovalReadError
      ? Math.max(60 * 2 ** Math.min(retryCount - 1, 4), error.retryAfterSeconds)
      : 0;
  return {
    retryCount,
    lastAttemptAt: now.toISOString(),
    nextRetryAt: retryable ? new Date(now.getTime() + seconds * 1000).toISOString() : null,
    error: retryable
      ? '钉钉读取暂时失败，将自动重试；未改写本地审批。'
      : '自动读取或证据核对失败，已暂停；未覆盖本地审批，请管理员核查后手动读取。',
  };
}
