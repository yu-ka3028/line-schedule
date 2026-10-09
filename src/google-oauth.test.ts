import { describe, expect, it } from 'vitest';

import { buildGoogleOAuthUrl, GOOGLE_REQUIRED_SCOPES } from './google-oauth.js';

const options = {
  clientId: 'client-id.apps.googleusercontent.com',
  redirectUri: 'https://example.com/oauth/google/callback',
  state: 'state-value',
};

describe('Google OAuth URL', () => {
  it('uses the minimum calendar scope and safe offline flow defaults', () => {
    const url = new URL(buildGoogleOAuthUrl(options));
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(url.searchParams.get('scope')).toBe(
      GOOGLE_REQUIRED_SCOPES.join(' '),
    );
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe(options.state);
  });

  it('rejects insecure non-local redirect URIs', () => {
    expect(() =>
      buildGoogleOAuthUrl({
        ...options,
        redirectUri: 'http://example.com/callback',
      }),
    ).toThrow();
  });
});
