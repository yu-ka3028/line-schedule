-- Calendar creates are held encrypted until an explicit confirmation.
create table public.pending_calendar_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  operation_key text not null,
  command_ciphertext text not null,
  expires_at timestamptz not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pending_calendar_confirmations_status_check
    check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  constraint pending_calendar_confirmations_operation_key_check
    check (operation_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$'),
  constraint pending_calendar_confirmations_ciphertext_check
    check (command_ciphertext ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);

create unique index pending_calendar_confirmations_user_operation_unique
  on public.pending_calendar_confirmations (user_id, operation_key);
create index pending_calendar_confirmations_expires_at_idx
  on public.pending_calendar_confirmations (expires_at);

alter table public.pending_calendar_confirmations enable row level security;
revoke all on table public.pending_calendar_confirmations from public;

create or replace function public.confirm_pending_calendar_confirmation(
  p_user_id uuid,
  p_operation_key text,
  p_now timestamptz default now()
) returns table(command_ciphertext text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.pending_calendar_confirmations
  set status = 'expired', updated_at = p_now
  where user_id = p_user_id and operation_key = p_operation_key
    and status = 'pending' and expires_at <= p_now;

  return query
  update public.pending_calendar_confirmations
  set status = 'confirmed', updated_at = p_now
  where user_id = p_user_id and operation_key = p_operation_key
    and status = 'pending' and expires_at > p_now
  returning pending_calendar_confirmations.command_ciphertext;
end
$$;

create or replace function public.cancel_pending_calendar_confirmation(
  p_user_id uuid,
  p_operation_key text,
  p_now timestamptz default now()
) returns table(command_ciphertext text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.pending_calendar_confirmations
  set status = 'expired', updated_at = p_now
  where user_id = p_user_id and operation_key = p_operation_key
    and status = 'pending' and expires_at <= p_now;

  return query
  update public.pending_calendar_confirmations
  set status = 'cancelled', updated_at = p_now
  where user_id = p_user_id and operation_key = p_operation_key
    and status = 'pending' and expires_at > p_now
  returning pending_calendar_confirmations.command_ciphertext;
end
$$;

revoke all on function public.confirm_pending_calendar_confirmation(uuid, text, timestamptz) from public;
revoke all on function public.cancel_pending_calendar_confirmation(uuid, text, timestamptz) from public;
grant execute on function public.confirm_pending_calendar_confirmation(uuid, text, timestamptz) to service_role;
grant execute on function public.cancel_pending_calendar_confirmation(uuid, text, timestamptz) to service_role;
