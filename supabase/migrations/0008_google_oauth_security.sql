-- Google OAuth state is single-use, short-lived, and backend-only.
-- Store only a SHA-256 digest; the value sent to Google is never persisted.
create table public.google_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint google_oauth_states_hash_check
    check (state_hash ~ '^[0-9a-f]{64}$')
);

create index google_oauth_states_expires_at_idx
  on public.google_oauth_states (expires_at);

alter table public.google_oauth_states enable row level security;

create or replace function public.consume_google_oauth_state(
  p_state_hash text,
  p_now timestamptz default now()
) returns table(user_id uuid)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.google_oauth_states
  set consumed_at = p_now
  where state_hash = p_state_hash
    and consumed_at is null
    and expires_at > p_now
  returning google_oauth_states.user_id;
$$;

revoke all on function public.consume_google_oauth_state(text, timestamptz) from public;
grant execute on function public.consume_google_oauth_state(text, timestamptz) to service_role;
