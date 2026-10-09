import { describe, expect, it } from 'vitest';

import { decryptWebhookPayload } from './crypto.js';
import {
  handleGoogleOAuthCallback,
  type GoogleOAuthCodeExchanger,
  type GoogleOAuthTokenSet,
} from './google-oauth-callback.js';
import { GOOGLE_OPENID_SCOPE } from './google-oauth.js';
import type {
  EncryptedGoogleConnection,
  GoogleConnectionStore,
} from './google-connection-store.js';
import type { GoogleOAuthStateStore } from './google-oauth-state.js';

const key = Buffer.alloc(32, 7);
const now = new Date('2025-05-01T00:00:00.000Z');

class FakeStateStore implements GoogleOAuthStateStore {
  consumed = false;
  async create(): Promise<void> {}
  async consume(): Promise<{ userId: string } | null> {
    if (this.consumed) return null;
    this.consumed = true;
    return { userId: 'internal-user' };
  }
}

class FakeConnectionStore implements GoogleConnectionStore {
  value: EncryptedGoogleConnection | undefined;
  async upsert(connection: EncryptedGoogleConnection): Promise<void> {
    this.value = connection;
  }
}

class FakeExchanger implements GoogleOAuthCodeExchanger {
  calls = 0;
  constructor(private readonly result: GoogleOAuthTokenSet) {}
  async exchangeCode(): Promise<GoogleOAuthTokenSet> {
    this.calls += 1;
    return this.result;
  }
}

function validTokens(): GoogleOAuthTokenSet {
  return {
    googleAccountId: 'google-account',
    accessToken: 'access-value',
    refreshToken: 'refresh-value',
    tokenExpiresAt: new Date('2025-05-01T01:00:00.000Z'),
    scopes: [
      GOOGLE_OPENID_SCOPE,
      'https://www.googleapis.com/auth/calendar.events',
    ],
  };
}

describe('Google OAuth callback service', () => {
  it('consumes state before exchanging and stores encrypted credentials', async () => {
    const stateStore = new FakeStateStore();
    const exchanger = new FakeExchanger(validTokens());
    const connectionStore = new FakeConnectionStore();

    await handleGoogleOAuthCallback(
      { code: 'authorization-code', state: 'oauth-state' },
      {
        stateStore,
        codeExchanger: exchanger,
        connectionStore,
        encryptionKey: key,
        now: () => now,
      },
    );

    expect(exchanger.calls).toBe(1);
    expect(connectionStore.value?.userId).toBe('internal-user');
    expect(connectionStore.value?.accessTokenCiphertext).not.toBe(
      'access-value',
    );
    expect(connectionStore.value?.refreshTokenCiphertext).not.toBe(
      'refresh-value',
    );
    expect(
      decryptWebhookPayload(connectionStore.value!.accessTokenCiphertext!, key),
    ).toBe('access-value');
  });

  it('does not exchange a replayed state', async () => {
    const stateStore = new FakeStateStore();
    const exchanger = new FakeExchanger(validTokens());
    const connectionStore = new FakeConnectionStore();
    const dependencies = {
      stateStore,
      codeExchanger: exchanger,
      connectionStore,
      encryptionKey: key,
      now: () => now,
    };

    await handleGoogleOAuthCallback(
      { code: 'code', state: 'state' },
      dependencies,
    );
    await expect(
      handleGoogleOAuthCallback({ code: 'code', state: 'state' }, dependencies),
    ).rejects.toThrow('invalid or expired');
    expect(exchanger.calls).toBe(1);
  });

  it('keeps the refresh token absent when Google does not return one', async () => {
    const tokens = validTokens();
    tokens.refreshToken = null;
    const connectionStore = new FakeConnectionStore();

    await handleGoogleOAuthCallback(
      { code: 'code', state: 'state' },
      {
        stateStore: new FakeStateStore(),
        codeExchanger: new FakeExchanger(tokens),
        connectionStore,
        encryptionKey: key,
        now: () => now,
      },
    );

    expect(connectionStore.value?.refreshTokenCiphertext).toBeUndefined();
  });

  it('rejects tokens without the OIDC scope', async () => {
    const tokens = validTokens();
    tokens.scopes = ['https://www.googleapis.com/auth/calendar.events'];

    await expect(
      handleGoogleOAuthCallback(
        { code: 'code', state: 'state' },
        {
          stateStore: new FakeStateStore(),
          codeExchanger: new FakeExchanger(tokens),
          connectionStore: new FakeConnectionStore(),
          encryptionKey: key,
          now: () => now,
        },
      ),
    ).rejects.toThrow('Required Google OAuth scope is missing');
  });

  it('consumes state even when code exchange fails', async () => {
    const stateStore = new FakeStateStore();
    const exchanger: GoogleOAuthCodeExchanger = {
      exchangeCode: async () => {
        throw new Error('provider failure');
      },
    };

    await expect(
      handleGoogleOAuthCallback(
        { code: 'code', state: 'state' },
        {
          stateStore,
          codeExchanger: exchanger,
          connectionStore: new FakeConnectionStore(),
          encryptionKey: key,
          now: () => now,
        },
      ),
    ).rejects.toThrow('code exchange failed');
    expect(stateStore.consumed).toBe(true);
  });
});
