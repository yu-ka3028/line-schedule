-- LINE Push opt-in gate. Apply after 0006; do not edit prior migrations.
alter table public.users
  add column push_enabled boolean not null default false;

-- Keep user records backend-only; operators must use the service-role RPC below.
alter table public.users enable row level security;

create or replace function public.claim_line_push_delivery(p_job_id uuid, p_processing_token uuid)
returns table(outcome text, recipient_id text, retry_key uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare j public.processing_jobs%rowtype; d public.line_push_deliveries%rowtype; u public.users%rowtype;
begin
  select * into j from public.processing_jobs
    where id = p_job_id
      and job_type = 'line_event_process'
      and status = 'processing'
      and processing_token = p_processing_token
      and processing_lease_expires_at > now()
    for update;
  if not found then return query select 'not_found'::text, null::text, null::uuid; return; end if;
  insert into public.line_push_deliveries(processing_job_id, user_id)
    values (j.id, j.user_id) on conflict (processing_job_id) do nothing;
  select * into d from public.line_push_deliveries where processing_job_id = j.id for update;
  if d.status = 'sent' then return query select 'sent'::text, null::text, d.retry_key; return; end if;
  if j.expires_at <= now() then
    update public.line_push_deliveries set status = 'blocked', last_error = 'expired' where id = d.id;
    return query select 'expired'::text, null::text, d.retry_key; return;
  end if;
  if d.status = 'blocked' or d.status = 'failed' then
    return query select d.status::text, null::text, d.retry_key; return;
  end if;
  select * into u from public.users where id = d.user_id;
  if not found or u.status <> 'active' then
    update public.line_push_deliveries set status = 'blocked', last_error = 'inactive' where id = d.id;
    return query select 'blocked'::text, null::text, d.retry_key; return;
  end if;
  if not u.push_enabled then
    update public.line_push_deliveries
      set status = 'blocked', last_error = 'push_disabled', lease_expires_at = null, processing_token = null
      where id = d.id;
    return query select 'blocked'::text, null::text, d.retry_key; return;
  end if;
  if d.status = 'sending' and d.lease_expires_at > now() and d.processing_token = p_processing_token then
    return query select 'busy'::text, null::text, d.retry_key; return;
  end if;
  if d.next_attempt_at > now() then return query select 'not_due'::text, null::text, d.retry_key; return; end if;
  if d.attempt >= 5 then
    update public.line_push_deliveries set status = 'failed', last_error = 'retryable', lease_expires_at = null, processing_token = null where id = d.id;
    return query select 'failed'::text, null::text, d.retry_key; return;
  end if;
  update public.line_push_deliveries set status = 'sending', attempt = attempt + 1, processing_token = p_processing_token, lease_expires_at = now() + interval '5 minutes', last_error = null where id = d.id;
  return query select 'claimed'::text, u.line_user_id, d.retry_key;
end; $$;

alter table public.line_push_deliveries
  drop constraint line_push_deliveries_error_check,
  add constraint line_push_deliveries_error_check
    check (last_error is null or last_error in ('retryable', 'blocked', 'expired', 'inactive', 'push_disabled'));

-- Management-only opt-in switch. The argument is an internal user UUID and is
-- never included in logs or error responses by the application.
create or replace function public.set_user_push_enabled(p_user_id uuid, p_enabled boolean)
returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.users set push_enabled = p_enabled where id = p_user_id;
  if found then return query select 'updated'::text;
  else return query select 'not_found'::text;
  end if;
end; $$;

revoke all on table public.users from public, anon, authenticated;
revoke execute on function public.claim_line_push_delivery(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.set_user_push_enabled(uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_line_push_delivery(uuid, uuid) to service_role;
grant execute on function public.set_user_push_enabled(uuid, boolean) to service_role;
