import { decryptWebhookPayload } from './crypto.js';
import type {
  DecryptedGoogleConnection,
  EncryptedGoogleConnection,
  GoogleConnectionReader,
} from './google-connection-store.js';
import {
  createSupabaseGoogleConnectionStore,
  SupabaseGoogleConnectionStore,
} from './google-connection-store.js';
import { readWebhookEncryptionKey } from './config.js';

export class GoogleCalendarConnectionNotFoundError extends Error {
  constructor() {
    super('Google Calendar connection was not found');
    this.name = 'GoogleCalendarConnectionNotFoundError';
  }
}

export class GoogleCalendarRefreshTokenMissingError extends Error {
  constructor() {
    super('Google Calendar refresh token is missing');
    this.name = 'GoogleCalendarRefreshTokenMissingError';
  }
}

/** Decrypts at the application boundary; ciphertext never leaves the store boundary. */
export function decryptGoogleCalendarConnection(
  connection: EncryptedGoogleConnection,
  encryptionKey: Buffer,
): DecryptedGoogleConnection {
  if (!connection.accessTokenCiphertext)
    throw new Error('Google Calendar access token is missing');
  return {
    userId: connection.userId,
    googleAccountId: connection.googleAccountId,
    accessToken: decryptWebhookPayload(
      connection.accessTokenCiphertext,
      encryptionKey,
    ),
    ...(connection.refreshTokenCiphertext
      ? {
          refreshToken: decryptWebhookPayload(
            connection.refreshTokenCiphertext,
            encryptionKey,
          ),
        }
      : {}),
    tokenExpiresAt: connection.tokenExpiresAt,
    scopes: connection.scopes,
  };
}

export async function readGoogleCalendarConnection(
  reader: GoogleConnectionReader,
  userId: string,
  encryptionKey: Buffer,
): Promise<DecryptedGoogleConnection> {
  const connection = await reader.getByUserId(userId);
  if (!connection) throw new GoogleCalendarConnectionNotFoundError();
  return decryptGoogleCalendarConnection(connection, encryptionKey);
}

export function createSupabaseGoogleCalendarConnectionReader(): GoogleConnectionReader {
  return createSupabaseGoogleConnectionStore() as SupabaseGoogleConnectionStore;
}

export function readGoogleCalendarConnectionWithConfiguredKey(
  reader: GoogleConnectionReader,
  userId: string,
): Promise<DecryptedGoogleConnection> {
  return readGoogleCalendarConnection(
    reader,
    userId,
    readWebhookEncryptionKey(),
  );
}

// A refresh token is optional in OAuth's initial response; callers that require
// refresh capability should fail explicitly rather than treating access tokens
// as durable credentials.
export function assertRefreshToken(
  connection: DecryptedGoogleConnection,
): asserts connection is DecryptedGoogleConnection & { refreshToken: string } {
  if (!connection.refreshToken)
    throw new GoogleCalendarRefreshTokenMissingError();
}
