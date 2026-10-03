import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/0005_qstash_executor_safety.sql',
    import.meta.url,
  ),
  'utf8',
);
const initialSchema = readFileSync(
  new URL('../supabase/migrations/0001_initial.sql', import.meta.url),
  'utf8',
);

describe('QStash executor safety migration', () => {
  it('caps existing LINE TTLs without deleting jobs', () => {
    expect(migration).toMatch(
      /expires_at is null or expires_at > created_at \+ interval '15 minutes'/,
    );
    expect(initialSchema).toMatch(/created_at timestamptz not null/);
    expect(migration).not.toMatch(/delete\s+from\s+public\.processing_jobs/i);
  });

  it('marks expired LINE outbox rows as publish-skipped and excludes them', () => {
    expect(migration).toContain(
      "publish_status = case when publish_status = 'published' then 'published' else 'skipped' end",
    );
    expect(migration).toContain("next_publish_at = 'infinity'::timestamptz");
    expect(migration).toMatch(
      /job_type = 'line_event_process' and expires_at > now\(\)/,
    );
    expect(migration).toContain('fail_or_requeue_line_event_job');
    expect(migration).toContain("if j.job_type = 'line_event_process' then");
  });
});
