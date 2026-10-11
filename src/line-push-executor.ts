import type { JobExecutor } from './processing-jobs.js';
import { decryptWebhookPayload } from './crypto.js';
import {
  executeCalendarCreateText,
  CalendarCreateFlowError,
  CALENDAR_CREATE_SUCCESS_TEXT,
  type CalendarCreateFlowDependencies,
} from './calendar-create-flow.js';
import { createLineOAuthPushTextFromPlaintextPayload } from './line-oauth-push.js';
import type { LineEventProcessingStore } from './line-event-processing-store.js';
import { LINE_PUSH_TEXT, type LinePushClient } from './line-push-client.js';
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
  calendarCreate?: CalendarCreateFlowDependencies;
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
        const plaintext = decryptWebhookPayload(
          event.payloadCiphertext,
          oauth.encryptionKey,
        );
        let storedEvent: unknown;
        try {
          storedEvent = JSON.parse(plaintext);
        } catch {
          throw new Error('line_event_invalid');
        }
        const message =
          typeof storedEvent === 'object' && storedEvent !== null
            ? (storedEvent as {
                type?: unknown;
                message?: { type?: unknown; text?: unknown };
              })
            : undefined;
        const text =
          message?.type === 'message' &&
          message.message?.type === 'text' &&
          typeof message.message.text === 'string'
            ? message.message.text
            : null;
        if (text === 'Google連携') {
          const oauthText = await createLineOAuthPushTextFromPlaintextPayload(
            plaintext,
            event.userId,
            { createGoogleOAuthStart: oauth.createGoogleOAuthStart },
          );
          if (!oauthText || !client.pushText)
            throw new Error('line_push_text_unavailable');
          result = await client.pushText(
            delivery.recipientId,
            delivery.retryKey,
            oauthText,
          );
        } else if (text?.startsWith('予定登録')) {
          if (!oauth.calendarCreate || !client.pushText)
            throw new Error('line_push_text_unavailable');
          try {
            await executeCalendarCreateText(
              text,
              event.userId,
              job.jobId,
              oauth.calendarCreate,
            );
            result = await client.pushText(
              delivery.recipientId,
              delivery.retryKey,
              CALENDAR_CREATE_SUCCESS_TEXT,
            );
          } catch (error) {
            if (
              error instanceof CalendarCreateFlowError &&
              error.code === 'invalid_input'
            ) {
              result = await client.pushText(
                delivery.recipientId,
                delivery.retryKey,
                LINE_PUSH_TEXT,
              );
            } else {
              result = 'retryable' as const;
            }
          }
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
