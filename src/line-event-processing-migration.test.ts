import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/0009_line_event_processing_read.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('LINE event processing read migration', () => {
  it('only returns the event for a matching active processing lease', () => {
    expect(migration).toContain("j.job_type = 'line_event_process'");
    expect(migration).toContain("j.status = 'processing'");
    expect(migration).toContain('j.processing_token = p_processing_token');
    expect(migration).toContain('j.processing_lease_expires_at > now()');
    expect(migration).toContain(
      '(j.expires_at is null or j.expires_at > now())',
    );
  });

  it('uses a locking-safe read shape and exposes only the minimal columns', () => {
    expect(migration).toContain(
      'returns table(user_id uuid, payload_ciphertext text)',
    );
    expect(migration).toContain('select e.user_id, e.payload_ciphertext');
    expect(migration).not.toMatch(/select\s+\*/i);
  });

  it('keeps the RPC service-role-only', () => {
    expect(migration).toContain(
      'revoke all on function public.read_line_event_for_processing_job(uuid, uuid)',
    );
    expect(migration).toContain(
      'grant execute on function public.read_line_event_for_processing_job(uuid, uuid)\n  to service_role',
    );
    expect(migration).toContain('set search_path = public, pg_temp');
  });
});
