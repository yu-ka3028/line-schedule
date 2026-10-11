-- Calendar creates are held encrypted until an explicit confirmation.
create table public.pending_calendar_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  operation_key text not null,
  command_ciphertext text not null,
  confirmation_ciphertext text not null default 'v1.a.a.a',
  expires_at timestamptz not null,
  status text not null default 'pending',
  -- lease_until is worker lease expiry; expires_at is confirmation expiry.
  lease_until timestamptz,
  processing_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pending_calendar_confirmations_status_check
    check (status in ('pending', 'processing', 'retryable', 'confirmed', 'cancelled', 'expired')),
  constraint pending_calendar_confirmations_operation_key_check
    check (operation_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$'),
  constraint pending_calendar_confirmations_ciphertext_check
    check (command_ciphertext ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  constraint pending_calendar_confirmations_confirmation_ciphertext_check
    check (confirmation_ciphertext ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);
create unique index pending_calendar_confirmations_user_operation_unique on public.pending_calendar_confirmations (user_id, operation_key);
create index pending_calendar_confirmations_user_status_idx on public.pending_calendar_confirmations (user_id, status, created_at desc);
alter table public.pending_calendar_confirmations enable row level security;
revoke all on table public.pending_calendar_confirmations from public;

create or replace function public.claim_pending_calendar_confirmation(p_user_id uuid, p_now timestamptz default now())
returns setof public.pending_calendar_confirmations language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Confirmation expiry is terminal, even when a worker lease is still active.
  update public.pending_calendar_confirmations
    set status = 'expired', lease_until = null, processing_token = null, updated_at = p_now
    where user_id = p_user_id
      and status in ('pending', 'retryable', 'processing')
      and expires_at <= p_now;

  -- A worker lease expiry makes an unexpired confirmation retryable.
  update public.pending_calendar_confirmations
    set status = 'retryable', lease_until = null, processing_token = null, updated_at = p_now
    where user_id = p_user_id
      and status = 'processing'
      and expires_at > p_now
      and lease_until <= p_now;

  return query
    with candidate as (
      select id
        from public.pending_calendar_confirmations
       where user_id = p_user_id
         and status in ('pending', 'retryable')
         and expires_at > p_now
       order by created_at desc
       for update skip locked
       limit 1
    ), claimed as (
      update public.pending_calendar_confirmations p
         set status = 'processing',
             processing_token = gen_random_uuid(),
             lease_until = p_now + interval '2 minutes',
             updated_at = p_now
        from candidate
       where p.id = candidate.id
       returning p.*
    )
    select * from claimed;
end $$;

create or replace function public.confirm_pending_calendar_confirmation(p_user_id uuid, p_operation_key text, p_now timestamptz default now()) returns table(command_ciphertext text) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.pending_calendar_confirmations set status = 'expired', updated_at = p_now where user_id = p_user_id and operation_key = p_operation_key and status = 'pending' and expires_at <= p_now;
  return query update public.pending_calendar_confirmations set status = 'confirmed', updated_at = p_now where user_id = p_user_id and operation_key = p_operation_key and status = 'pending' and expires_at > p_now returning command_ciphertext;
end $$;
create or replace function public.cancel_pending_calendar_confirmation(p_user_id uuid, p_operation_key text, p_now timestamptz default now()) returns table(command_ciphertext text) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.pending_calendar_confirmations set status = 'expired', updated_at = p_now where user_id = p_user_id and operation_key = p_operation_key and status = 'pending' and expires_at <= p_now;
  return query update public.pending_calendar_confirmations set status = 'cancelled', updated_at = p_now where user_id = p_user_id and operation_key = p_operation_key and status = 'pending' and expires_at > p_now returning command_ciphertext;
end $$;

create or replace function public.finish_pending_calendar_confirmation(p_user_id uuid, p_operation_key text, p_processing_token uuid, p_now timestamptz default now()) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.pending_calendar_confirmations
     set status = 'confirmed', lease_until = null, processing_token = null, updated_at = p_now
   where user_id = p_user_id and operation_key = p_operation_key
     and processing_token = p_processing_token and status = 'processing'
     and expires_at > p_now and lease_until > p_now;
  return found;
end $$;
create or replace function public.requeue_pending_calendar_confirmation(p_user_id uuid, p_operation_key text, p_processing_token uuid, p_now timestamptz default now()) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.pending_calendar_confirmations
     set status = case when expires_at <= p_now then 'expired' else 'retryable' end,
         lease_until = null, processing_token = null, updated_at = p_now
   where user_id = p_user_id and operation_key = p_operation_key
     and processing_token = p_processing_token and status = 'processing'
     and lease_until > p_now;
  return found;
end $$;

revoke all on function public.claim_pending_calendar_confirmation(uuid, timestamptz) from public;
revoke all on function public.confirm_pending_calendar_confirmation(uuid, text, timestamptz) from public;
revoke all on function public.cancel_pending_calendar_confirmation(uuid, text, timestamptz) from public;
revoke all on function public.finish_pending_calendar_confirmation(uuid, text, uuid, timestamptz) from public;
revoke all on function public.requeue_pending_calendar_confirmation(uuid, text, uuid, timestamptz) from public;
grant execute on function public.claim_pending_calendar_confirmation(uuid, timestamptz) to service_role;
grant execute on function public.confirm_pending_calendar_confirmation(uuid, text, timestamptz) to service_role;
grant execute on function public.cancel_pending_calendar_confirmation(uuid, text, timestamptz) to service_role;
grant execute on function public.finish_pending_calendar_confirmation(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.requeue_pending_calendar_confirmation(uuid, text, uuid, timestamptz) to service_role;
