import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConfigurationError,
  isGoogleOAuthEnabled,
  readGoogleOAuthConfig,
  readSupabaseConfig,
} from './config.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Google OAuth config', () => {
  it('is disabled by default and only enables for the literal true value', () => {
    expect(isGoogleOAuthEnabled()).toBe(false);
    vi.stubEnv('GOOGLE_OAUTH_ENABLED', 'TRUE');
    expect(isGoogleOAuthEnabled()).toBe(false);
    vi.stubEnv('GOOGLE_OAUTH_ENABLED', 'true');
    expect(isGoogleOAuthEnabled()).toBe(true);
  });

  it('reads a fixed callback URI without exposing values in errors', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
    vi.stubEnv(
      'GOOGLE_REDIRECT_URI',
      'https://example.com/oauth/google/callback',
    );
    expect(readGoogleOAuthConfig().redirectUri).toBe(
      'https://example.com/oauth/google/callback',
    );
  });

  it('rejects a callback URI with a query or wrong path', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('GOOGLE_REDIRECT_URI', 'https://example.com/other');
    expect(() => readGoogleOAuthConfig()).toThrow(ConfigurationError);
  });
});

describe('readSupabaseConfig', () => {
  it('accepts a Supabase Cloud URL', () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only-service-role-key');

    expect(readSupabaseConfig().url).toBe('https://project.supabase.co');
  });

  it('accepts localhost over HTTP', () => {
    vi.stubEnv('SUPABASE_URL', 'http://localhost:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only-service-role-key');

    expect(readSupabaseConfig().url).toBe('http://localhost:54321');
  });

  it.each([
    'http://project.supabase.co',
    'https://supabase.co',
    'https://project.supabase.co.example.com',
    'https://user:password@project.supabase.co',
    'https://example.com',
  ])('rejects an unsafe URL: %s', (url) => {
    vi.stubEnv('SUPABASE_URL', url);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only-service-role-key');

    expect(() => readSupabaseConfig()).toThrow(ConfigurationError);
  });
});
