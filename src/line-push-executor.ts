import type { JobExecutor } from './processing-jobs.js';
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
export type LinePushTextProvider = (
  job: Parameters<JobExecutor>[0],
  processingToken: string,
) => Promise<string | null>;

export function createLinePushExecutor(
  store: LinePushStore,
  client: LinePushClient,
  textProvider?: LinePushTextProvider,
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
    let text: string | null = null;
    if (textProvider) {
      try {
        text = await textProvider(job, processingToken);
      } catch {
        const status = await store.fail(
          job.jobId,
          processingToken,
          delivery.retryKey,
          'retryable',
        );
        if (status === 'token_mismatch' || status === 'not_found')
          throw new Error('line_push_completion_failed');
        throw new LinePushRetryableError();
      }
    }
    if (text === null && textProvider) {
      const status = await store.fail(
        job.jobId,
        processingToken,
        delivery.retryKey,
        'blocked',
      );
      if (status === 'token_mismatch' || status === 'not_found')
        throw new Error('line_push_completion_failed');
      return { outcome: 'blocked' };
    }
    let result: Awaited<ReturnType<LinePushClient['push']>>;
    if (text !== null && textProvider) {
      if (!client.pushText) throw new LinePushRetryableError();
      result = await client.pushText(
        delivery.recipientId,
        delivery.retryKey,
        text,
      );
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
