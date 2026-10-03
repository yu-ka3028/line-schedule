import type { LineTextMessageEvent } from './line-events.js';
import type { ReplyClient, ReplyOutcome } from './line-reply-client.js';
import type { SyncUsageMetadata, UsageLogStore } from './usage-log-store.js';

export type SyncTextOutcome =
  'replied' | 'reply_unavailable' | 'timeout' | 'error' | 'skipped';

export type SyncTextDependencies = {
  replyClient: ReplyClient;
  usageLogs?: UsageLogStore;
  now?: () => number;
  deadlineMs?: number;
  deadlineAt?: number;
  persistenceMs?: number;
};

const defaultNow = (): number => performance.now();
const usageLogTimeoutMs = 100;
export const syncDiagnosticEvent = 'sync_text_diagnostic';

type SyncDiagnosticTiming = Pick<
  SyncUsageMetadata,
  'outcome' | 'total_ms' | 'persistence_ms' | 'reply_ms'
>;

function logSyncDiagnostic(payload: SyncDiagnosticTiming): void {
  console.info(syncDiagnosticEvent, payload);
}

export function logSyncSkip(
  reason: 'not_single_user_text' | 'not_inserted' | 'duplicate',
): void {
  console.info(syncDiagnosticEvent, { reason });
}

export async function processSyncText(
  event: LineTextMessageEvent | undefined,
  dependencies: SyncTextDependencies,
): Promise<SyncTextOutcome> {
  const now = dependencies.now ?? defaultNow;
  const started = now();
  if (!event || event.source.type !== 'user') {
    logSyncSkip('not_single_user_text');
    return 'skipped';
  }

  const deadline =
    dependencies.deadlineAt ?? Date.now() + (dependencies.deadlineMs ?? 800);
  let replyOutcome: ReplyOutcome = 'error';
  const replyStarted = now();
  try {
    replyOutcome = await dependencies.replyClient.reply(
      event.replyToken,
      deadline,
    );
  } catch {
    replyOutcome = 'error';
  }
  const outcome: SyncTextOutcome = replyOutcome;
  const metadata: SyncUsageMetadata = {
    schema_version: 1,
    outcome,
    total_ms: Math.max(0, Math.round(now() - started)),
    persistence_ms: Math.max(0, Math.round(dependencies.persistenceMs ?? 0)),
    reply_ms: Math.max(0, Math.round(now() - replyStarted)),
  };
  const usageLog = dependencies.usageLogs;
  const remainingMs = Math.max(0, deadline - Date.now());
  if (usageLog && remainingMs > 0) {
    const timeoutMs = Math.min(usageLogTimeoutMs, remainingMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        usageLog.record(metadata),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('usage log timeout')),
            timeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } catch {
      // Usage telemetry must never change the webhook response.
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  logSyncDiagnostic({
    outcome: metadata.outcome,
    total_ms: metadata.total_ms,
    persistence_ms: metadata.persistence_ms,
    reply_ms: metadata.reply_ms,
  });
  return outcome;
}
