import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { encryptWebhookPayload } from './crypto.js';
import { SupabaseGoogleConnectionStore } from './google-connection-store.js';

function createClientMock() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const client = {
    from: vi.fn(() => ({ upsert })),
  } as unknown as SupabaseClient;
  return { client, upsert };
}

function connection(
  overrides: Partial<
    Parameters<SupabaseGoogleConnectionStore['upsert']>[0]
  > = {},
) {
  return {
    userId: 'user-id',
    googleAccountId: 'google-account-id',
    accessTokenCiphertext: encryptWebhookPayload(
      'access-token-fixture',
      randomBytes(32),
    ),
    refreshTokenCiphertext: encryptWebhookPayload(
      'refresh-token-fixture',
      randomBytes(32),
    ),
    tokenExpiresAt: new Date('2025-01-01T00:00:00.000Z'),
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
    ...overrides,
  };
}

describe('SupabaseGoogleConnectionStore', () => {
  it('accepts only the versioned AES-GCM ciphertext format', async () => {
    const { client, upsert } = createClientMock();
    const store = new SupabaseGoogleConnectionStore(client);

    await expect(
      store.upsert(connection({ accessTokenCiphertext: 'plain-token' })),
    ).rejects.toThrow('must be encrypted');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not include an omitted refresh token in the upsert', async () => {
    const { client, upsert } = createClientMock();
    const store = new SupabaseGoogleConnectionStore(client);

    await store.upsert(connection({ refreshTokenCiphertext: undefined }));

    const [row] = upsert.mock.calls[0] as [Record<string, unknown>];
    expect(row).not.toHaveProperty('refresh_token_ciphertext');
  });

  it('does not include a null refresh token in the upsert', async () => {
    const { client, upsert } = createClientMock();
    const store = new SupabaseGoogleConnectionStore(client);

    await store.upsert(connection({ refreshTokenCiphertext: null }));

    const [row] = upsert.mock.calls[0] as [Record<string, unknown>];
    expect(row).not.toHaveProperty('refresh_token_ciphertext');
  });
});
