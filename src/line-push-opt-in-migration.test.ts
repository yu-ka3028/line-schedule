import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../supabase/migrations/0007_line_push_opt_in.sql', import.meta.url),
  'utf8',
);

describe('LINE push opt-in migration', () => {
  it('defaults every existing and new user to disabled', () => {
    expect(migration).toContain(
      'add column push_enabled boolean not null default false',
    );
  });

  it('gates the claim before returning a recipient and uses an allowlisted error', () => {
    expect(migration).toContain('if not u.push_enabled then');
    expect(migration).toContain("last_error = 'push_disabled'");
    expect(migration).toContain("'push_disabled'");
    expect(migration).toContain("return query select 'blocked'::text");
  });

  it('keeps the management RPC service-role-only and uses an internal id', () => {
    expect(migration).toContain(
      'create or replace function public.set_user_push_enabled(p_user_id uuid, p_enabled boolean)',
    );
    expect(migration).toContain(
      'revoke execute on function public.set_user_push_enabled(uuid, boolean) from public, anon, authenticated',
    );
    expect(migration).toContain(
      'grant execute on function public.set_user_push_enabled(uuid, boolean) to service_role',
    );
    expect(migration).toContain('set search_path = public, pg_temp');
  });
});
