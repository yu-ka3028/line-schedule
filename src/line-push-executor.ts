import type { JobExecutor } from './processing-jobs.js';
import type { LinePushClient } from './line-push-client.js';
import type { LinePushStore } from './line-push-store.js';

export function createLinePushExecutor(
  store: LinePushStore,
  client: LinePushClient,
): JobExecutor {
  return async (job, processingToken) => {
    const delivery = await store.claim(job.jobId, processingToken);
    if (delivery.outcome !== 'claimed') {
      if (delivery.outcome === 'busy' || delivery.outcome === 'not_due')
        throw new Error('line_push_retryable');
      return;
    }
    const result = await client.push(delivery.recipientId, delivery.retryKey);
    if (result === 'sent') {
      const completed = await store.sent(
        job.jobId,
        processingToken,
        delivery.retryKey,
      );
      if (completed !== 'sent') throw new Error('line_push_completion_failed');
      return;
    }
    const status = await store.fail(
      job.jobId,
      processingToken,
      delivery.retryKey,
      result,
    );
    if (result === 'retryable' || status === 'requeued')
      throw new Error('line_push_retryable');
  };
}
