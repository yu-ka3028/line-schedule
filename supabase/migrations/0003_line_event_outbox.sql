-- Phase 1 LINE webhook outbox. This migration is additive; 0001/0002 are unchanged.

alter table public.processing_jobs
  add column publish_status text not null default 'pending',
  add column publish_attempts integer not null default 0,
  add column next_publish_at timestamptz not null default now(),
  add column publish_lease_token uuid,
  add column publish_lease_expires_at timestamptz,
  add column last_publish_error text,
  add column published_at timestamptz;

alter table public.processing_jobs
  drop constraint processing_jobs_job_type_check;
alter table public.processing_jobs
  add constraint processing_jobs_job_type_check check
    (job_type in ('calendar_create', 'calendar_update', 'calendar_delete', 'line_event_process'));
alter table public.processing_jobs
  add constraint processing_jobs_publish_status_check check
    (publish_status in ('pending', 'publishing', 'published', 'retry_due'));
alter table public.processing_jobs
  add constraint processing_jobs_publish_attempts_check check (publish_attempts >= 0);
create unique index processing_jobs_inbound_event_job_type_unique
  on public.processing_jobs (inbound_event_id, job_type)
  where inbound_event_id is not null;
create index processing_jobs_publish_due_idx
  on public.processing_jobs (publish_status, next_publish_at);

-- The application supplies ciphertext; this function never receives a reply token
-- or plaintext. It is intentionally limited to user-originated events by the
-- caller contract and creates the event and its outbox job in one transaction.
create or replace function public.save_line_event_and_enqueue_job(
  p_line_event_id text,
  p_line_user_id text,
  p_message_type text,
  p_payload_ciphertext text
) returns table(event_id uuid, job_id uuid, inserted boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare u public.users%rowtype; e public.inbound_events%rowtype; j public.processing_jobs%rowtype;
begin
  insert into public.users(line_user_id) values (p_line_user_id)
    on conflict (line_user_id) do update set updated_at = public.users.updated_at
    returning * into u;
  select * into e from public.inbound_events where line_event_id = p_line_event_id for update;
  if found then
    select * into j from public.processing_jobs
      where inbound_event_id = e.id and job_type = 'line_event_process';
    if not found then
      insert into public.processing_jobs(user_id, inbound_event_id, idempotency_key, job_type)
        values (u.id, e.id, 'line-event:' || p_line_event_id, 'line_event_process')
        on conflict (idempotency_key) do update set updated_at = public.processing_jobs.updated_at
        returning * into j;
    end if;
    return query select e.id, j.id, false;
    return;
  end if;
  insert into public.inbound_events(user_id, line_event_id, message_type, payload_ciphertext)
    values (u.id, p_line_event_id, p_message_type, p_payload_ciphertext)
    returning * into e;
  insert into public.processing_jobs(user_id, inbound_event_id, idempotency_key, job_type)
    values (u.id, e.id, 'line-event:' || p_line_event_id, 'line_event_process')
    returning * into j;
  return query select e.id, j.id, true;
end; $$;

create or replace function public.claim_line_event_publish(p_job_id uuid)
returns table(outcome text, lease_token uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare j public.processing_jobs%rowtype; t uuid := extensions.gen_random_uuid();
begin
  select * into j from public.processing_jobs where id = p_job_id for update;
  if not found then return query select 'not_found'::text, null::uuid; return; end if;
  if j.publish_status = 'published' then return query select 'published'::text, null::uuid; return; end if;
  if j.publish_status = 'publishing' and j.publish_lease_expires_at > now()
    then return query select 'busy'::text, null::uuid; return; end if;
  if j.next_publish_at > now() then return query select 'not_due'::text, null::uuid; return; end if;
  update public.processing_jobs set publish_status = 'publishing', publish_attempts = publish_attempts + 1,
    publish_lease_token = t, publish_lease_expires_at = now() + interval '15 seconds', last_publish_error = null
    where id = j.id;
  return query select 'claimed'::text, t;
end; $$;

create or replace function public.finish_line_event_publish(
  p_job_id uuid, p_lease_token uuid, p_success boolean, p_message_id text, p_error text
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_success then
    update public.processing_jobs set publish_status = 'published', qstash_message_id = p_message_id,
      published_at = now(), publish_lease_token = null, publish_lease_expires_at = null, last_publish_error = null
      where id = p_job_id and publish_status = 'publishing' and publish_lease_token = p_lease_token;
  else
    update public.processing_jobs set publish_status = 'retry_due',
      next_publish_at = now() + interval '1 minute', publish_lease_token = null,
      publish_lease_expires_at = null, last_publish_error = left(coalesce(p_error, 'publish_failed'), 200)
      where id = p_job_id and publish_status = 'publishing' and publish_lease_token = p_lease_token;
  end if;
  if found then return query select case when p_success then 'published' else 'retry_due' end::text;
  else return query select 'token_mismatch'::text; end if;
end; $$;

revoke execute on function public.save_line_event_and_enqueue_job(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.claim_line_event_publish(uuid) from public, anon, authenticated;
revoke execute on function public.finish_line_event_publish(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.save_line_event_and_enqueue_job(text, text, text, text) to service_role;
grant execute on function public.claim_line_event_publish(uuid) to service_role;
grant execute on function public.finish_line_event_publish(uuid, uuid, boolean, text, text) to service_role;
