import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/0006_line_push_delivery.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('LINE push delivery migration', () => {
  it('defines durable idempotent delivery state and safe RPC boundaries', () => {
    expect(migration).toContain('create table public.line_push_deliveries');
    expect(migration).toContain('processing_job_id uuid not null unique');
    expect(migration).toContain(
      "'pending', 'sending', 'sent', 'failed', 'blocked'",
    );
    expect(migration).toContain('retry_key uuid not null');
    expect(migration).toContain('claim_line_push_delivery');
    expect(migration).toContain('p_processing_token uuid');
    expect(migration).toContain('enable row level security');
    expect(migration).toContain(
      'grant execute on function public.claim_line_push_delivery',
    );
    expect(migration).toContain(
      "last_error in ('retryable', 'blocked', 'expired', 'inactive')",
    );
  });
});
