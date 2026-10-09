import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../supabase/migrations/0001_initial.sql', import.meta.url),
  'utf8',
);

describe('Google connection security migration', () => {
  it('keeps google connections behind backend-only RLS', () => {
    expect(migration).toContain(
      'alter table public.google_connections enable row level security',
    );
    expect(migration).toContain(
      'Encrypted ciphertext only; never store an OAuth access token in plaintext.',
    );
    expect(migration).toContain(
      'Encrypted ciphertext only; never store an OAuth refresh token in plaintext.',
    );
  });
});
