import { decryptWebhookPayload } from './crypto.js';
import type { LineEventProcessingStore } from './line-event-processing-store.js';
import type { ProcessingJob } from './processing-jobs.js';

const MAX_PUSH_TEXT_LENGTH = 2000;
const PUSH_PREFIX = 'Google連携はこちら:\n';

type GoogleOAuthStart = (userId: string) => Promise<string>;

type StoredEvent = {
  type?: unknown;
  source?: { type?: unknown; userId?: unknown };
  message?: { type?: unknown; text?: unknown };
};

export type LineOAuthPushTextDependencies = {
  eventStore: LineEventProcessingStore;
  encryptionKey: Buffer;
  createGoogleOAuthStart: GoogleOAuthStart;
};

export class LineOAuthPushProcessingError extends Error {
  constructor() {
    super('line_oauth_push_processing_failed');
    this.name = 'LineOAuthPushProcessingError';
  }
}

function parseTargetEvent(plaintext: string): boolean {
  try {
    const value = JSON.parse(plaintext) as StoredEvent;
    return (
      value.type === 'message' &&
      value.source?.type === 'user' &&
      typeof value.source.userId === 'string' &&
      value.source.userId.length > 0 &&
      value.message?.type === 'text' &&
      value.message.text === 'Google連携'
    );
  } catch {
    throw new LineOAuthPushProcessingError();
  }
}

export function createLineOAuthPushTextProvider(
  dependencies: LineOAuthPushTextDependencies,
) {
  return async (job: ProcessingJob, processingToken: string) => {
    const record = await dependencies.eventStore.read(
      job.jobId,
      processingToken,
    );
    if (!record) throw new LineOAuthPushProcessingError();

    let plaintext: string;
    try {
      plaintext = decryptWebhookPayload(
        record.payloadCiphertext,
        dependencies.encryptionKey,
      );
    } catch {
      throw new LineOAuthPushProcessingError();
    }
    if (!parseTargetEvent(plaintext)) return null;

    let url: string;
    try {
      url = await dependencies.createGoogleOAuthStart(record.userId);
    } catch {
      throw new LineOAuthPushProcessingError();
    }
    const text = `${PUSH_PREFIX}${url}`;
    if (text.length > MAX_PUSH_TEXT_LENGTH) {
      throw new LineOAuthPushProcessingError();
    }
    return text;
  };
}

export { MAX_PUSH_TEXT_LENGTH };
