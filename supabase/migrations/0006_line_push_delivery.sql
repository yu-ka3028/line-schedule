-- Durable LINE Push delivery state. Apply after 0005; do not edit prior migrations.
create table public.line_push_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  processing_job_id uuid not null unique references public.processing_jobs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending',
  attempt integer not null default 0,
  lease_expires_at timestamptz,
  processing_token uuid,
  retry_key uuid not null default extensions.gen_random_uuid(),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_push_deliveries_status_check check (status in ('pending', 'sending', 'sent', 'failed', 'blocked')),
  constraint line_push_deliveries_attempt_check check (attempt >= 0),
  constraint line_push_deliveries_error_check check (last_error is null or last_error in ('retryable', 'blocked', 'expired', 'inactive'))
);
create index line_push_deliveries_due_idx on public.line_push_deliveries (status, next_attempt_at);
create trigger line_push_deliveries_set_updated_at before update on public.line_push_deliveries
for each row execute function public.set_updated_at();
alter table public.line_push_deliveries enable row level security;

create or replace function public.claim_line_push_delivery(p_job_id uuid, p_processing_token uuid)
returns table(outcome text, recipient_id text, retry_key uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare j public.processing_jobs%rowtype; d public.line_push_deliveries%rowtype; u public.users%rowtype;
begin
  select * into j from public.processing_jobs where id = p_job_id and job_type = 'line_event_process' for update;
  if not found then return query select 'not_found'::text, null::text, null::uuid; return; end if;
  insert into public.line_push_deliveries(processing_job_id, user_id)
    values (j.id, j.user_id) on conflict (processing_job_id) do nothing;
  select * into d from public.line_push_deliveries where processing_job_id = j.id for update;
  if d.status = 'sent' then return query select 'sent'::text, null::text, d.retry_key; return; end if;
  if j.expires_at <= now() then update public.line_push_deliveries set status = 'blocked', last_error = 'expired' where id = d.id; return query select 'expired'::text, null::text, d.retry_key; return; end if;
  select * into u from public.users where id = d.user_id;
  if not found or u.status <> 'active' then update public.line_push_deliveries set status = 'blocked', last_error = 'inactive' where id = d.id; return query select 'blocked'::text, null::text, d.retry_key; return; end if;
  if d.status = 'blocked' or d.status = 'failed' then return query select d.status::text, null::text, d.retry_key; return; end if;
  if d.status = 'sending' and d.lease_expires_at > now() and d.processing_token = p_processing_token then return query select 'busy'::text, null::text, d.retry_key; return; end if;
  if d.next_attempt_at > now() then return query select 'not_due'::text, null::text, d.retry_key; return; end if;
  if d.attempt >= 5 then update public.line_push_deliveries set status = 'failed', last_error = 'retryable' where id = d.id; return query select 'failed'::text, null::text, d.retry_key; return; end if;
  update public.line_push_deliveries set status = 'sending', attempt = attempt + 1, processing_token = p_processing_token, lease_expires_at = now() + interval '5 minutes', last_error = null where id = d.id;
  return query select 'claimed'::text, u.line_user_id, d.retry_key;
end; $$;

create or replace function public.complete_line_push_delivery(p_job_id uuid, p_processing_token uuid, p_retry_key uuid)
returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.line_push_deliveries set status = 'sent', sent_at = coalesce(sent_at, now()), lease_expires_at = null, processing_token = null, last_error = null
    where processing_job_id = p_job_id and processing_token = p_processing_token and retry_key = p_retry_key;
  if found then return query select 'sent'::text; return; end if;
  if exists (select 1 from public.line_push_deliveries where processing_job_id = p_job_id and status = 'sent' and retry_key = p_retry_key) then return query select 'sent'::text; else return query select 'token_mismatch'::text; end if;
end; $$;

create or replace function public.fail_line_push_delivery(p_job_id uuid, p_processing_token uuid, p_retry_key uuid, p_error text)
returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare d public.line_push_deliveries%rowtype;
begin
  select * into d from public.line_push_deliveries where processing_job_id = p_job_id and retry_key = p_retry_key and processing_token = p_processing_token for update;
  if not found then return query select 'token_mismatch'::text; return; end if;
  if p_error = 'blocked' then update public.line_push_deliveries set status = 'blocked', last_error = 'blocked', lease_expires_at = null, processing_token = null where id = d.id; return query select 'failed'::text; return; end if;
  if d.attempt >= 5 then update public.line_push_deliveries set status = 'failed', last_error = 'retryable', lease_expires_at = null, processing_token = null where id = d.id; return query select 'failed'::text; return; end if;
  update public.line_push_deliveries set status = 'pending', last_error = 'retryable', next_attempt_at = now() + interval '1 minute', lease_expires_at = null, processing_token = null where id = d.id;
  return query select 'requeued'::text;
end; $$;

revoke all on table public.line_push_deliveries from public, anon, authenticated;
revoke execute on function public.claim_line_push_delivery(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.complete_line_push_delivery(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.fail_line_push_delivery(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_line_push_delivery(uuid, uuid) to service_role;
grant execute on function public.complete_line_push_delivery(uuid, uuid, uuid) to service_role;
grant execute on function public.fail_line_push_delivery(uuid, uuid, uuid, text) to service_role;
