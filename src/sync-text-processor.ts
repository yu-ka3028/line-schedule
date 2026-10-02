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

export async function processSyncText(
  event: LineTextMessageEvent | undefined,
  dependencies: SyncTextDependencies,
): Promise<SyncTextOutcome> {
  const now = dependencies.now ?? defaultNow;
  const started = now();
  if (!event || event.source.type !== 'user') return 'skipped';

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
    try {
      await Promise.race([
        usageLog.record(metadata),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('usage log timeout')),
            timeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } catch {
      // Usage telemetry must never change the webhook response.
    }
  }
  return outcome;
}
