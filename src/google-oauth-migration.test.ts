import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/0008_google_oauth_security.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Google OAuth security migration', () => {
  it('stores only a unique hash and enables backend-only access', () => {
    expect(migration).toContain('state_hash text not null unique');
    expect(migration).toContain("check (state_hash ~ '^[0-9a-f]{64}$')");
    expect(migration).toContain(
      'alter table public.google_oauth_states enable row level security',
    );
    expect(migration).toContain('consumed_at timestamptz');
  });

  it('consumes a valid state atomically and only once', () => {
    expect(migration).toContain('consumed_at is null');
    expect(migration).toContain('expires_at > p_now');
    expect(migration).toContain('set consumed_at = p_now');
  });
});
