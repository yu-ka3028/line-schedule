import { Hono } from 'hono';

import {
  ConfigurationError,
  isGoogleOAuthEnabled,
  isLineAsyncProcessingEnabled,
  readGoogleOAuthConfig,
  readQstashConfig,
  readWebhookEncryptionKey,
  type GoogleOAuthConfig,
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
  createLinePushExecutor,
  LinePushRetryableError,
  type LinePushExecutorResult,
} from './line-push-executor.js';
import {
  createLinePushClient,
  type LinePushClient,
} from './line-push-client.js';
import {
  createSupabaseLinePushStore,
  type LinePushStore,
} from './line-push-store.js';
import {
  createSupabaseProcessingJobStore,
  type ProcessingJobStore,
} from './processing-job-store.js';
import {
  createSupabaseLineEventStore,
  type LineEventStore,
} from './line-event-store.js';
import {
  dispatchLineEventPublish,
  dispatchLineEventPublishBatch,
  createSupabaseLineOutboxStore,
  type LineOutboxStore,
} from './line-outbox.js';
import {
  createQstashPublisher,
  readQstashPublisherConfig,
  type QstashPublisher,
} from './qstash-publisher.js';
import {
  LineEventValidationError,
  parseLineWebhookPayload,
} from './line-events.js';
import { readBodyWithLimit, verifyLineSignature } from './line-signature.js';
import {
  GoogleOAuthCallbackError,
  handleGoogleOAuthCallback,
  type GoogleOAuthCallbackDependencies,
} from './google-oauth-callback.js';
import { createSupabaseGoogleConnectionStore } from './google-connection-store.js';
import { createSupabaseGoogleOAuthStateStore } from './google-oauth-state-store.js';
import { GoogleapisOAuthTokenProvider } from './google-oauth-provider.js';

import {
  createSupabaseUsageLogStore,
  type UsageLogStore,
} from './usage-log-store.js';

export type AppDependencies = {
  line?: {
    /** @deprecated synchronous replies are intentionally ignored. */
    replyClient?: unknown;
    usageLogs?: UsageLogStore;
    outbox?: LineOutboxStore;
    publisher?: QstashPublisher;
  };
  oauth?: {
    callback?: GoogleOAuthCallbackDependencies;
    config?: GoogleOAuthConfig;
  };
  qstash?: {
    config?: QstashConfig;
    verifier?: QstashSignatureVerifier;
    jobs?: ProcessingJobStore;
    executor?: JobExecutor;
    linePushStore?: LinePushStore;
    linePushClient?: LinePushClient;
    linePushUsageLogs?: UsageLogStore;
    outbox?: LineOutboxStore;
    publisher?: QstashPublisher;
  };
};

export function createApp(
  store?: LineEventStore,
  dependencies: AppDependencies = {},
): Hono {
  const app = new Hono();

  app.post('/webhooks/qstash/outbox-dispatch', async (c) => {
    // A disabled flag is a hard safety boundary: do not construct clients or
    // make any QStash/DB calls while disabled.
    if (!isLineAsyncProcessingEnabled()) return c.json({ ok: true }, 200);
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
      dependencies.qstash?.verifier ??
      createQstashSignatureVerifier(
        config,
        config.dispatcherUrl ?? '/webhooks/qstash/outbox-dispatch',
      );
    try {
      if (!(await verifier.verify(body, signature)))
        return c.json({ error: 'invalid_signature' }, 401);
    } catch {
      return c.json({ error: 'invalid_signature' }, 401);
    }
    try {
      const value = JSON.parse(body) as unknown;
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        Object.keys(value).length !== 1 ||
        (value as { kind?: unknown }).kind !== 'outbox_dispatch'
      )
        return c.json({ error: 'invalid_payload' }, 400);
    } catch {
      return c.json({ error: 'invalid_payload' }, 400);
    }
    try {
      const outbox =
        dependencies.qstash?.outbox ?? createSupabaseLineOutboxStore();
      const publisher =
        dependencies.qstash?.publisher ??
        createQstashPublisher(readQstashPublisherConfig());
      await dispatchLineEventPublishBatch(outbox, publisher, 10);
      return c.json({ ok: true }, 200);
    } catch {
      return c.json({ error: 'dispatcher_unavailable' }, 500);
    }
  });

  app.post('/webhooks/qstash/jobs', async (c) => {
    // Deliberately stop before config/client construction, signature verification,
    // claims, or executors. QStash may receive a 200 while the feature is off;
    // this is an explicit no-side-effect hard-stop, not an authentication result.
    if (!isLineAsyncProcessingEnabled()) return c.json({ ok: true }, 200);
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
      dependencies.qstash?.verifier ??
      createQstashSignatureVerifier(config, config.receiverUrl);
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
    // The payload remains jobId-only; the trusted DB claim supplies job_type.
    // Unknown/unimplemented types must stay retryable and never be successful.
    const jobType = claim.jobType ?? 'line_event_process';
    let executor = dependencies.qstash?.executor;
    let pushUsage: UsageLogStore | undefined;
    try {
      if (
        jobType !== 'line_event_process' &&
        !['calendar_create', 'calendar_update', 'calendar_delete'].includes(
          jobType,
        )
      )
        throw new Error('unknown_job_type');
      if (!executor && jobType === 'line_event_process') {
        const pushStore =
          dependencies.qstash?.linePushStore ?? createSupabaseLinePushStore();
        const pushClient =
          dependencies.qstash?.linePushClient ?? createLinePushClient();
        executor = createLinePushExecutor(pushStore, pushClient);
      }
      if (!executor) throw new Error('handler_unavailable');
      if (jobType === 'line_event_process') {
        pushUsage = dependencies.qstash?.linePushUsageLogs;
        if (!pushUsage) {
          try {
            pushUsage = createSupabaseUsageLogStore();
          } catch (error) {
            if (!(error instanceof ConfigurationError)) throw error;
            // Delivery remains available when optional telemetry is not
            // configured; the feature flag still prevents this path entirely.
          }
        }
      }
      try {
        await pushUsage?.record({
          schema_version: 1,
          operation: 'line_push',
          outcome: 'line_push_attempt',
        });
      } catch {
        /* telemetry must not affect delivery */
      }
      const execution = (await executor(
        job,
        claim.token,
      )) as LinePushExecutorResult | void;
      const outcome = execution?.outcome ?? 'sent';
      try {
        await pushUsage?.record({
          schema_version: 1,
          operation: 'line_push',
          outcome: `line_push_${outcome}`,
        });
      } catch {
        /* telemetry must not affect delivery */
      }
      const result = await store.succeed(job.jobId, claim.token);
      return result === 'succeeded'
        ? c.json({ ok: true }, 200)
        : c.json({ error: 'job_store_unavailable' }, 500);
    } catch (error) {
      try {
        if (jobType === 'line_event_process' && pushUsage) {
          try {
            await pushUsage.record({
              schema_version: 1,
              operation: 'line_push',
              outcome:
                error instanceof LinePushRetryableError ||
                error instanceof Error
                  ? 'line_push_retry'
                  : 'line_push_terminal',
            });
          } catch {
            /* telemetry must not affect delivery */
          }
        }
        const result =
          jobType === 'line_event_process' && store.failOrRequeueLineEvent
            ? await store.failOrRequeueLineEvent(
                job.jobId,
                claim.token,
                'handler_unavailable',
              )
            : await store.failOrRequeue(
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

  app.get('/oauth/google/callback', async (c) => {
    // Keep the route inert until explicitly enabled: no config, clients, state
    // consumption, or database access is allowed on the disabled path.
    if (!isGoogleOAuthEnabled()) return c.json({ error: 'not_found' }, 404);

    if (c.req.query('error') !== undefined)
      return c.json({ error: 'oauth_denied' }, 400);
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return c.json({ error: 'invalid_oauth_request' }, 400);

    try {
      let callback = dependencies.oauth?.callback;
      if (!callback) {
        const config = dependencies.oauth?.config ?? readGoogleOAuthConfig();
        callback = {
          stateStore: createSupabaseGoogleOAuthStateStore(),
          codeExchanger: new GoogleapisOAuthTokenProvider(config),
          connectionStore: createSupabaseGoogleConnectionStore(),
          encryptionKey: readWebhookEncryptionKey(),
        };
      }
      await handleGoogleOAuthCallback({ code, state }, callback);
      return c.text('Google OAuth connection successful.', 200);
    } catch (error) {
      if (error instanceof GoogleOAuthCallbackError)
        return c.json({ error: 'invalid_oauth_callback' }, 400);
      if (error instanceof ConfigurationError)
        return c.json({ error: 'configuration_unavailable' }, 503);
      return c.json({ error: 'oauth_callback_unavailable' }, 500);
    }
  });

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post('/webhooks/line', async (c) => {
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

    let saveResult;
    try {
      saveResult = await eventStore.save(payload);
    } catch {
      // Do not expose persistence details or event contents to the caller.
      return c.json({ error: 'persistence_unavailable' }, 500);
    }

    if (!isLineAsyncProcessingEnabled()) return c.json({ ok: true }, 200);

    const jobIds = Array.isArray(saveResult?.jobIds) ? saveResult.jobIds : [];
    let publishStatus: 'published' | 'retry_due' | 'skipped' = 'skipped';
    if (jobIds.length > 0) {
      try {
        const outbox =
          dependencies.line?.outbox ?? createSupabaseLineOutboxStore();
        const publisher =
          dependencies.line?.publisher ??
          createQstashPublisher(readQstashPublisherConfig());
        for (const jobId of jobIds) {
          const result = await dispatchLineEventPublish(
            jobId,
            outbox,
            publisher,
          );
          if (result === 'retry_due') publishStatus = result;
          else if (result === 'published' && publishStatus === 'skipped')
            publishStatus = result;
        }
      } catch {
        publishStatus = 'retry_due';
      }
      let usageLogs = dependencies.line?.usageLogs;
      if (!usageLogs) {
        try {
          usageLogs = createSupabaseUsageLogStore();
        } catch {
          usageLogs = undefined;
        }
      }
      try {
        await usageLogs?.record({
          schema_version: 1,
          outcome: 'outbox_publish',
          publish_status: publishStatus,
        });
      } catch {
        /* telemetry must not change the LINE response */
      }
    }

    return c.json({ ok: true }, 200);
  });

  return app;
}

export const app = createApp();
export default app;
