import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigurationError, readSupabaseConfig } from './config.js';

afterEach(() => {
  vi.unstubAllEnvs();
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
