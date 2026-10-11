-- Replace the lease RPCs from 0011 without touching existing rows.
-- 0011 shipped finish/requeue with both the legacy three-argument shape and
-- the token-aware shape on some environments, so remove both overloads.
drop function if exists public.claim_pending_calendar_confirmation(uuid, timestamptz);
drop function if exists public.finish_pending_calendar_confirmation(uuid, text, timestamptz);
drop function if exists public.finish_pending_calendar_confirmation(uuid, text, uuid, timestamptz);
drop function if exists public.requeue_pending_calendar_confirmation(uuid, text, timestamptz);
drop function if exists public.requeue_pending_calendar_confirmation(uuid, text, uuid, timestamptz);

-- Keep the table protection explicit for environments where 0011 was applied
-- through a schema diff rather than the migration runner.
alter table public.pending_calendar_confirmations enable row level security;
revoke all on table public.pending_calendar_confirmations from public;

create or replace function public.claim_pending_calendar_confirmation(
  p_user_id uuid,
  p_now timestamptz default now()
) returns setof public.pending_calendar_confirmations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Confirmation expiry wins over an active or expired worker lease.
  update public.pending_calendar_confirmations
     set status = 'expired', lease_until = null, processing_token = null,
         updated_at = p_now
   where user_id = p_user_id
     and status in ('pending', 'retryable', 'processing')
     and expires_at <= p_now;

  -- Recover an unexpired item whose worker lease expired.  Clearing the token
  -- prevents the previous worker from completing the recovered item.
  update public.pending_calendar_confirmations
     set status = 'retryable', lease_until = null, processing_token = null,
         updated_at = p_now
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
         set status = 'processing', processing_token = gen_random_uuid(),
             lease_until = p_now + interval '2 minutes', updated_at = p_now
        from candidate
       where p.id = candidate.id
       returning p.*
    )
    select * from claimed;
end
$$;

create or replace function public.finish_pending_calendar_confirmation(
  p_user_id uuid,
  p_operation_key text,
  p_processing_token uuid,
  p_now timestamptz default now()
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.pending_calendar_confirmations
     set status = 'confirmed', lease_until = null, processing_token = null,
         updated_at = p_now
   where user_id = p_user_id
     and operation_key = p_operation_key
     and status = 'processing'
     and processing_token = p_processing_token
     and expires_at > p_now
     and lease_until > p_now;
  return found;
end
$$;

create or replace function public.requeue_pending_calendar_confirmation(
  p_user_id uuid,
  p_operation_key text,
  p_processing_token uuid,
  p_now timestamptz default now()
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.pending_calendar_confirmations
     set status = case when expires_at <= p_now then 'expired' else 'retryable' end,
         lease_until = null, processing_token = null, updated_at = p_now
   where user_id = p_user_id
     and operation_key = p_operation_key
     and status = 'processing'
     and processing_token = p_processing_token
     and lease_until > p_now;
  return found;
end
$$;

revoke all on function public.claim_pending_calendar_confirmation(uuid, timestamptz) from public;
revoke all on function public.finish_pending_calendar_confirmation(uuid, text, uuid, timestamptz) from public;
revoke all on function public.requeue_pending_calendar_confirmation(uuid, text, uuid, timestamptz) from public;
grant execute on function public.claim_pending_calendar_confirmation(uuid, timestamptz) to service_role;
grant execute on function public.finish_pending_calendar_confirmation(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.requeue_pending_calendar_confirmation(uuid, text, uuid, timestamptz) to service_role;
