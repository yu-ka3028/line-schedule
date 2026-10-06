import { describe, expect, it } from 'vitest';

import {
  createGoogleOAuthStart,
  GoogleOAuthStartError,
} from './google-oauth-start.js';
import { hashGoogleOAuthState } from './google-oauth-state.js';
import type {
  GoogleOAuthStateRecord,
  GoogleOAuthStateStore,
} from './google-oauth-state.js';

const now = new Date('2025-05-01T00:00:00.000Z');
const config = {
  clientId: 'client-id',
  clientSecret: 'super-secret',
  redirectUri: 'https://example.com/oauth/google/callback',
};

class FakeStateStore implements GoogleOAuthStateStore {
  value?: GoogleOAuthStateRecord;
  shouldFail = false;

  async create(value: GoogleOAuthStateRecord): Promise<void> {
    if (this.shouldFail) throw new Error('database failure');
    this.value = value;
  }

  async consume(): Promise<{ userId: string } | null> {
    return null;
  }
}

describe('Google OAuth start service', () => {
  it('stores only the state hash and returns the authorization URL', async () => {
    const stateStore = new FakeStateStore();
    const url = await createGoogleOAuthStart('internal-user', {
      config,
      stateStore,
      now: () => now,
      stateTtlMs: 5 * 60 * 1000,
    });
    const parsed = new URL(url);
    const state = parsed.searchParams.get('state')!;

    expect(stateStore.value).toEqual({
      hash: hashGoogleOAuthState(state),
      userId: 'internal-user',
      expiresAt: new Date('2025-05-01T00:05:00.000Z'),
    });
    expect(stateStore.value!.hash).not.toBe(state);
    expect(parsed.searchParams.get('client_id')).toBe(config.clientId);
    expect(parsed.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    expect(parsed.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/calendar.events',
    );
    expect(parsed.searchParams.get('response_type')).toBe('code');
  });

  it('classifies invalid input and configuration without exposing secrets', async () => {
    const stateStore = new FakeStateStore();
    await expect(
      createGoogleOAuthStart('   ', { config, stateStore }),
    ).rejects.toMatchObject({ code: 'invalid-user-id' });

    const secret = 'do-not-expose';
    await expect(
      createGoogleOAuthStart('user', {
        config: { ...config, redirectUri: 'not-a-url', clientSecret: secret },
        stateStore,
      }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
    try {
      await createGoogleOAuthStart('user', {
        config: { ...config, redirectUri: 'not-a-url', clientSecret: secret },
        stateStore,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('does not return a URL when state storage fails', async () => {
    const stateStore = new FakeStateStore();
    stateStore.shouldFail = true;

    await expect(
      createGoogleOAuthStart('user', { config, stateStore }),
    ).rejects.toMatchObject({
      code: 'state-store-failure',
      name: 'GoogleOAuthStartError',
    });
  });

  it('does not include the client secret in the returned URL', async () => {
    const url = await createGoogleOAuthStart('user', {
      config,
      stateStore: new FakeStateStore(),
    });
    expect(url).not.toContain(config.clientSecret);
    expect(url).not.toContain('client_secret');
  });

  it('uses a typed service error for invalid input', async () => {
    await expect(
      createGoogleOAuthStart('', { config, stateStore: new FakeStateStore() }),
    ).rejects.toBeInstanceOf(GoogleOAuthStartError);
  });
});
