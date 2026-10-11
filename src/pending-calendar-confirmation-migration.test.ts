import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/0011_pending_calendar_confirmations.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('pending calendar confirmations migration', () => {
  it('stores only encrypted command ciphertext with RLS', () => {
    expect(migration).toContain(
      'create table public.pending_calendar_confirmations',
    );
    expect(migration).toContain('command_ciphertext text not null');
    expect(migration).toContain(
      'alter table public.pending_calendar_confirmations enable row level security',
    );
    expect(migration).toContain(
      "status in ('pending', 'confirmed', 'cancelled', 'expired')",
    );
    expect(migration).not.toContain('title text');
  });

  it('uses service-role-only atomic transitions with expiry checks', () => {
    expect(migration).toContain('confirm_pending_calendar_confirmation');
    expect(migration).toContain('cancel_pending_calendar_confirmation');
    expect(migration).toContain("status = 'confirmed'");
    expect(migration).toContain('expires_at > p_now');
    expect(migration).toContain('grant execute on function');
  });
});
