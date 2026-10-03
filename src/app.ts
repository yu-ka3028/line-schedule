import { Hono } from 'hono';

import {
  ConfigurationError,
  readQstashConfig,
  type QstashConfig,
} from './config.js';
import {
  createQstashSignatureVerifier,
  type QstashSignatureVerifier,
} from './qstash-signature.js';
import {
  MAX_QSTASH_BODY_BYTES,
  parseProcessingJobPayload,
  type JobExecutor,
} from './processing-jobs.js';
import {
  createSupabaseProcessingJobStore,
  type ProcessingJobStore,
} from './processing-job-store.js';
import {
  createSupabaseLineEventStore,
  type LineEventStore,
} from './line-event-store.js';
import {
  LineEventValidationError,
  parseLineWebhookPayload,
} from './line-events.js';
import { readBodyWithLimit, verifyLineSignature } from './line-signature.js';
import {
  createLineReplyClient,
  type ReplyClient,
} from './line-reply-client.js';
import { logSyncSkip, processSyncText } from './sync-text-processor.js';
import {
  createSupabaseUsageLogStore,
  type UsageLogStore,
} from './usage-log-store.js';

export type AppDependencies = {
  line?: {
    replyClient?: ReplyClient;
    usageLogs?: UsageLogStore;
  };
  qstash?: {
    config?: QstashConfig;
    verifier?: QstashSignatureVerifier;
    jobs?: ProcessingJobStore;
    executor?: JobExecutor;
  };
};

export function createApp(
  store?: LineEventStore,
  dependencies: AppDependencies = {},
): Hono {
  const app = new Hono();
  const seenTextEvents = new Map<string, number>();
  const seenTextEventTtlMs = 10 * 60 * 1000;
  const seenTextEventLimit = 1000;

  app.post('/webhooks/qstash/jobs', async (c) => {
    let config: QstashConfig;
    try {
      config = dependencies.qstash?.config ?? readQstashConfig();
    } catch (error) {
      if (error instanceof ConfigurationError)
        return c.json({ error: 'configuration_unavailable' }, 503);
      throw error;
    }
    const signature = c.req.header('upstash-signature');
    if (!signature) return c.json({ error: 'invalid_signature' }, 401);
    const contentType = c.req
      .header('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/json')
      return c.json({ error: 'unsupported_media_type' }, 415);
    const rawBody = await readBodyWithLimit(c.req.raw, MAX_QSTASH_BODY_BYTES);
    if (rawBody === null)
      return c.json({ error: 'request_entity_too_large' }, 413);
    let body: string;
    try {
      body = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
    } catch {
      return c.json({ error: 'invalid_encoding' }, 400);
    }
    const verifier =
      dependencies.qstash?.verifier ?? createQstashSignatureVerifier(config);
    try {
      if (!(await verifier.verify(body, signature)))
        return c.json({ error: 'invalid_signature' }, 401);
    } catch {
      // Receiver.verify throws for malformed or invalid QStash signatures.
      return c.json({ error: 'invalid_signature' }, 401);
    }
    let job;
    try {
      job = parseProcessingJobPayload(JSON.parse(body));
    } catch {
      return c.json({ error: 'invalid_payload' }, 400);
    }
    let store: ProcessingJobStore;
    try {
      store = dependencies.qstash?.jobs ?? createSupabaseProcessingJobStore();
    } catch (error) {
      if (error instanceof ConfigurationError)
        return c.json({ error: 'configuration_unavailable' }, 503);
      throw error;
    }
    let claim;
    try {
      claim = await store.claim(job.jobId);
    } catch {
      return c.json({ error: 'job_store_unavailable' }, 500);
    }
    if (
      claim.outcome === 'terminal' ||
      claim.outcome === 'expired' ||
      claim.outcome === 'not_found' ||
      claim.outcome === 'inactive'
    )
      return c.json({ ok: true }, 200);
    if (claim.outcome === 'busy' || claim.outcome === 'not_due' || !claim.token)
      return c.json({ error: 'job_not_ready' }, 500);
    // Calendar execution is intentionally unavailable until the handler is implemented.
    // Failing safely keeps the job retryable instead of falsely marking it succeeded.
    const executor =
      dependencies.qstash?.executor ??
      (async () => {
        throw new Error('handler_unavailable');
      });
    try {
      await executor(job, claim.token);
      const result = await store.succeed(job.jobId, claim.token);
      return result === 'succeeded'
        ? c.json({ ok: true }, 200)
        : c.json({ error: 'job_store_unavailable' }, 500);
    } catch {
      try {
        const result = await store.failOrRequeue(
          job.jobId,
          claim.token,
          'handler_unavailable',
        );
        return result === 'failed'
          ? c.json({ ok: true }, 200)
          : c.json({ error: 'job_retryable_failure' }, 500);
      } catch {
        return c.json({ error: 'job_store_unavailable' }, 500);
      }
    }
  });

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post('/webhooks/line', async (c) => {
    const webhookStartedAt = Date.now();
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    if (!channelSecret) {
      return c.json({ error: 'configuration_unavailable' }, 503);
    }

    const signature = c.req.header('x-line-signature');
    if (!signature) {
      return c.json({ error: 'invalid_signature' }, 401);
    }

    const contentType = c.req
      .header('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/json') {
      return c.json({ error: 'unsupported_media_type' }, 415);
    }

    const rawBody = await readBodyWithLimit(c.req.raw);
    if (rawBody === null) {
      return c.json({ error: 'request_entity_too_large' }, 413);
    }

    if (!verifyLineSignature(rawBody, signature, channelSecret)) {
      return c.json({ error: 'invalid_signature' }, 401);
    }

    let payload;
    try {
      payload = parseLineWebhookPayload(rawBody);
    } catch (error) {
      if (error instanceof LineEventValidationError) {
        return c.json({ error: 'invalid_payload' }, 400);
      }
      throw error;
    }

    if (payload.events.length === 0) return c.json({ ok: true }, 200);

    const eventStore =
      store ??
      (() => {
        try {
          return createSupabaseLineEventStore();
        } catch (error) {
          if (error instanceof ConfigurationError) return null;
          throw error;
        }
      })();
    if (!eventStore) return c.json({ error: 'configuration_unavailable' }, 503);

    const persistenceStarted = performance.now();
    let saveResult;
    try {
      saveResult = await eventStore.save(payload);
    } catch {
      // Do not expose persistence details or event contents to the caller.
      return c.json({ error: 'persistence_unavailable' }, 500);
    }

    const candidate = payload.events[0];
    const persistenceMs = Math.max(
      0,
      Math.round(performance.now() - persistenceStarted),
    );
    const textEvent =
      payload.events.length === 1 &&
      candidate?.type === 'message' &&
      (candidate.message as { type?: string }).type === 'text' &&
      candidate.source.type === 'user'
        ? (candidate as import('./line-events.js').LineTextMessageEvent)
        : undefined;
    if (!textEvent) {
      logSyncSkip('not_single_user_text');
    } else if (saveResult?.inserted !== true) {
      logSyncSkip('not_inserted');
    } else {
      const now = Date.now();
      for (const [eventId, seenAt] of seenTextEvents) {
        if (now - seenAt >= seenTextEventTtlMs) seenTextEvents.delete(eventId);
      }
      if (seenTextEvents.has(textEvent.webhookEventId)) {
        logSyncSkip('duplicate');
        return c.json({ ok: true }, 200);
      }
      while (seenTextEvents.size >= seenTextEventLimit) {
        const oldestEventId = seenTextEvents.keys().next().value;
        if (oldestEventId === undefined) break;
        seenTextEvents.delete(oldestEventId);
      }
      seenTextEvents.set(textEvent.webhookEventId, now);
      let usageLogs = dependencies.line?.usageLogs;
      if (!usageLogs) {
        try {
          usageLogs = createSupabaseUsageLogStore();
        } catch {
          usageLogs = undefined;
        }
      }
      await processSyncText(textEvent, {
        replyClient: dependencies.line?.replyClient ?? createLineReplyClient(),
        usageLogs,
        deadlineAt: webhookStartedAt + 800,
        persistenceMs,
      });
    }

    return c.json({ ok: true }, 200);
  });

  return app;
}

export const app = createApp();
export default app;
