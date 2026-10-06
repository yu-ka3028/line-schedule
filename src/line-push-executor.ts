import type { JobExecutor } from './processing-jobs.js';
import { createLineOAuthPushText } from './line-oauth-push.js';
import type { LineEventProcessingStore } from './line-event-processing-store.js';
import type { LinePushClient } from './line-push-client.js';
import type { LinePushStore } from './line-push-store.js';

export type LinePushExecutionOutcome =
  'sent' | 'already_sent' | 'blocked' | 'expired' | 'terminal';

export class LinePushRetryableError extends Error {
  readonly outcome = 'retry';

  constructor() {
    super('line_push_retryable');
  }
}

export type LinePushExecutorResult = { outcome: LinePushExecutionOutcome };

export type LineOAuthPushExecutorDependencies = {
  processingStore: LineEventProcessingStore;
  encryptionKey: Buffer;
  createGoogleOAuthStart: (userId: string) => Promise<string>;
};

export function createLinePushExecutor(
  store: LinePushStore,
  client: LinePushClient,
  oauth?: LineOAuthPushExecutorDependencies,
): JobExecutor {
  return async (job, processingToken) => {
    const delivery = await store.claim(job.jobId, processingToken);
    if (delivery.outcome !== 'claimed') {
      if (delivery.outcome === 'busy' || delivery.outcome === 'not_due')
        throw new LinePushRetryableError();
      if (delivery.outcome === 'sent') return { outcome: 'already_sent' };
      if (delivery.outcome === 'expired') return { outcome: 'expired' };
      if (delivery.outcome === 'blocked') return { outcome: 'blocked' };
      return { outcome: 'terminal' };
    }
    let result;
    if (oauth) {
      try {
        const event = await oauth.processingStore.read(
          job.jobId,
          processingToken,
        );
        if (!event) throw new Error('line_event_processing_record_missing');
        const text = await createLineOAuthPushText(
          event.payloadCiphertext,
          event.userId,
          {
            encryptionKey: oauth.encryptionKey,
            createGoogleOAuthStart: oauth.createGoogleOAuthStart,
          },
        );
        if (text !== null) {
          if (!client.pushText) throw new Error('line_push_text_unavailable');
          result = await client.pushText(
            delivery.recipientId,
            delivery.retryKey,
            text,
          );
        } else {
          result = await client.push(delivery.recipientId, delivery.retryKey);
        }
      } catch {
        result = 'retryable' as const;
      }
    } else {
      result = await client.push(delivery.recipientId, delivery.retryKey);
    }
    if (result === 'sent') {
      const completed = await store.sent(
        job.jobId,
        processingToken,
        delivery.retryKey,
      );
      if (completed !== 'sent') throw new Error('line_push_completion_failed');
      return { outcome: 'sent' };
    }
    const status = await store.fail(
      job.jobId,
      processingToken,
      delivery.retryKey,
      result,
    );
    if (result === 'retryable' || status === 'requeued')
      throw new LinePushRetryableError();
    if (result === 'blocked') return { outcome: 'blocked' };
    return { outcome: 'terminal' };
  };
}
