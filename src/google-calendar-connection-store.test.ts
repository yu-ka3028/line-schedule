import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { encryptWebhookPayload } from './crypto.js';
import {
  decryptGoogleCalendarConnection,
  GoogleCalendarRefreshTokenMissingError,
  readGoogleCalendarConnection,
} from './google-calendar-connection-store.js';
import type { EncryptedGoogleConnection } from './google-connection-store.js';

const key = randomBytes(32);
const encrypted: EncryptedGoogleConnection = {
  userId: 'user-id',
  googleAccountId: 'account-id',
  accessTokenCiphertext: encryptWebhookPayload('access-token', key),
  refreshTokenCiphertext: null,
  tokenExpiresAt: null,
  scopes: ['calendar.events'],
};

describe('Google Calendar connection boundary', () => {
  it('decrypts tokens only after reading an internal connection', async () => {
    const reader = { getByUserId: async () => encrypted };
    await expect(
      readGoogleCalendarConnection(reader, 'user-id', key),
    ).resolves.toMatchObject({
      userId: 'user-id',
      accessToken: 'access-token',
    });
  });

  it('preserves an absent refresh token and can reject it explicitly', () => {
    const connection = decryptGoogleCalendarConnection(encrypted, key);
    expect(connection).not.toHaveProperty('refreshToken');
    expect(() => {
      if (!connection.refreshToken)
        throw new GoogleCalendarRefreshTokenMissingError();
    }).toThrow(GoogleCalendarRefreshTokenMissingError);
  });
});
