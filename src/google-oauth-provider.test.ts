import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  setCredentials: vi.fn(),
  userinfoGet: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn(() => ({
        getToken: mocks.getToken,
        setCredentials: mocks.setCredentials,
      })),
    },
    oauth2: vi.fn(() => ({
      userinfo: { get: mocks.userinfoGet },
    })),
  },
}));

import { GoogleapisOAuthTokenProvider } from './google-oauth-provider.js';

describe('Googleapis OAuth token provider', () => {
  it('requires the requested OIDC and Calendar scopes before userinfo', async () => {
    mocks.getToken.mockResolvedValue({
      tokens: {
        access_token: 'access-value',
        expiry_date: Date.now() + 60_000,
        scope: 'https://www.googleapis.com/auth/calendar.events',
      },
    });

    await expect(
      new GoogleapisOAuthTokenProvider({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/oauth/google/callback',
      }).exchangeCode('authorization-code'),
    ).rejects.toThrow('missing required scopes');
    expect(mocks.userinfoGet).not.toHaveBeenCalled();
  });

  it('returns the account identity and granted scopes', async () => {
    mocks.getToken.mockResolvedValue({
      tokens: {
        access_token: 'access-value',
        expiry_date: Date.now() + 60_000,
        scope: 'openid https://www.googleapis.com/auth/calendar.events',
        refresh_token: 'refresh-value',
      },
    });
    mocks.userinfoGet.mockResolvedValue({ data: { id: 'google-account' } });

    await expect(
      new GoogleapisOAuthTokenProvider({
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://example.com/oauth/google/callback',
      }).exchangeCode('authorization-code'),
    ).resolves.toMatchObject({
      googleAccountId: 'google-account',
      accessToken: 'access-value',
      refreshToken: 'refresh-value',
      scopes: ['openid', 'https://www.googleapis.com/auth/calendar.events'],
    });
  });
});
