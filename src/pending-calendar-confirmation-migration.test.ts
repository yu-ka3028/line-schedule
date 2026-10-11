import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/0012_pending_calendar_confirmation_lease.sql',
    import.meta.url,
  ),
  'utf8',
);

const previousMigration = readFileSync(
  new URL(
    '../supabase/migrations/0011_pending_calendar_confirmations.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('pending calendar confirmation lease migration', () => {
  it('is a forward-only migration and removes legacy RPC overloads explicitly', () => {
    expect(migration).toContain(
      'drop function if exists public.finish_pending_calendar_confirmation(uuid, text, timestamptz)',
    );
    expect(migration).toContain(
      'drop function if exists public.requeue_pending_calendar_confirmation(uuid, text, timestamptz)',
    );
    expect(migration).toContain(
      'drop function if exists public.claim_pending_calendar_confirmation(uuid, timestamptz)',
    );
    expect(migration).toContain('p_processing_token uuid');
    expect(migration).toContain('processing_token = gen_random_uuid()');
    expect(migration).toContain("status = 'retryable'");
    expect(migration).toContain("status = 'expired'");
    expect(migration).not.toContain('delete from');
    expect(migration).not.toContain('truncate');
  });

  it('recovers expired leases while enforcing token and confirmation expiry', () => {
    expect(migration).toContain('lease_until <= p_now');
    expect(migration).toContain('processing_token = p_processing_token');
    expect(migration).toContain('lease_until > p_now');
    expect(migration).toContain('expires_at > p_now');
    expect(migration).toContain('set search_path = public, pg_temp');
    expect(migration).toContain('alter table');
    expect(migration).toContain('service_role');
    expect(previousMigration).not.toContain(
      '0012_pending_calendar_confirmation',
    );
  });
});
