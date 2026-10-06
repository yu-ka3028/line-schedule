import { decryptWebhookPayload } from './crypto.js';

export const MAX_PUSH_TEXT_LENGTH = 2000;
const PUSH_PREFIX = 'Google連携はこちら:\n';
const TARGET_TEXT = 'Google連携';

type GoogleOAuthStart = (userId: string) => Promise<string>;

type StoredEvent = {
  type?: unknown;
  message?: { type?: unknown; text?: unknown };
};

export type LineOAuthPushTextDependencies = {
  encryptionKey: Buffer;
  createGoogleOAuthStart: GoogleOAuthStart;
};

export type LineOAuthPushProcessingErrorCode =
  | 'decrypt-failure'
  | 'invalid-event'
  | 'state-store-failure'
  | 'oauth-start-failure'
  | 'message-too-long';

export class LineOAuthPushProcessingError extends Error {
  constructor(public readonly code: LineOAuthPushProcessingErrorCode) {
    super('line_oauth_push_processing_failed');
    this.name = 'LineOAuthPushProcessingError';
  }
}

function isTargetEvent(plaintext: string): boolean {
  let value: StoredEvent;
  try {
    value = JSON.parse(plaintext) as StoredEvent;
  } catch {
    throw new LineOAuthPushProcessingError('invalid-event');
  }
  return (
    value.type === 'message' &&
    value.message?.type === 'text' &&
    value.message.text === TARGET_TEXT
  );
}

/** Returns a dynamic push body for the exact OAuth command, or null for other events. */
export async function createLineOAuthPushText(
  payloadCiphertext: string,
  userId: string,
  dependencies: LineOAuthPushTextDependencies,
): Promise<string | null> {
  let plaintext: string;
  try {
    plaintext = decryptWebhookPayload(
      payloadCiphertext,
      dependencies.encryptionKey,
    );
  } catch {
    throw new LineOAuthPushProcessingError('decrypt-failure');
  }

  if (!isTargetEvent(plaintext)) return null;

  let url: string;
  try {
    url = await dependencies.createGoogleOAuthStart(userId);
  } catch (error) {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'state-store-failure'
        ? 'state-store-failure'
        : 'oauth-start-failure';
    throw new LineOAuthPushProcessingError(code);
  }

  const text = `${PUSH_PREFIX}${url}`;
  if (text.length > MAX_PUSH_TEXT_LENGTH)
    throw new LineOAuthPushProcessingError('message-too-long');
  return text;
}
