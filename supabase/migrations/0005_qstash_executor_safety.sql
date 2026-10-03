-- QStash executor safety. Apply after 0004; migrations 0001-0004 are immutable.
-- LINE jobs are intentionally short-lived so an old backlog is never pushed.
update public.processing_jobs
set expires_at = created_at + interval '15 minutes'
where job_type = 'line_event_process'
  and (expires_at is null or expires_at > created_at + interval '15 minutes');

alter table public.processing_jobs
  add constraint processing_jobs_line_expiry_check
  check (job_type <> 'line_event_process' or expires_at is not null);

-- `skipped` is terminal for the publish outbox, but distinct from a message
-- that was actually published. Keep the timestamp non-null and out of range.
alter table public.processing_jobs
  drop constraint processing_jobs_publish_status_check;
alter table public.processing_jobs
  add constraint processing_jobs_publish_status_check
  check (publish_status in ('pending', 'publishing', 'published', 'retry_due', 'skipped'));

update public.processing_jobs
set status = case when status not in ('succeeded', 'failed') then 'failed' else status end,
    last_error = case when status not in ('succeeded', 'failed') then 'expired' else last_error end,
    processing_token = null, processing_lease_expires_at = null,
    publish_status = case when publish_status = 'published' then 'published' else 'skipped' end,
    publish_lease_token = null, publish_lease_expires_at = null,
    next_publish_at = 'infinity'::timestamptz
where job_type = 'line_event_process' and expires_at <= now();

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
      insert into public.processing_jobs(user_id, inbound_event_id, idempotency_key, job_type, expires_at)
        values (u.id, e.id, 'line-event:' || p_line_event_id, 'line_event_process', now() + interval '15 minutes')
        on conflict (idempotency_key) do update set updated_at = public.processing_jobs.updated_at
        returning * into j;
    end if;
    return query select e.id, j.id, false;
    return;
  end if;
  insert into public.inbound_events(user_id, line_event_id, message_type, payload_ciphertext)
    values (u.id, p_line_event_id, p_message_type, p_payload_ciphertext)
    returning * into e;
  insert into public.processing_jobs(user_id, inbound_event_id, idempotency_key, job_type, expires_at)
    values (u.id, e.id, 'line-event:' || p_line_event_id, 'line_event_process', now() + interval '15 minutes')
    returning * into j;
  return query select e.id, j.id, true;
end; $$;

create or replace function public.claim_processing_job(p_job_id uuid)
returns table(outcome text, processing_token uuid, job_type text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare j public.processing_jobs%rowtype; t uuid := extensions.gen_random_uuid();
begin
  select * into j from public.processing_jobs where id = p_job_id for update;
  if not found then return query select 'not_found'::text, null::uuid, null::text; return; end if;
  if j.expires_at is not null and j.expires_at <= now() then
    if j.job_type = 'line_event_process' then
      update public.processing_jobs
        set status = case when status not in ('succeeded', 'failed') then 'failed' else status end,
          last_error = case when status not in ('succeeded', 'failed') then 'expired' else last_error end,
          processing_token = null, processing_lease_expires_at = null,
          publish_status = case when publish_status = 'published' then 'published' else 'skipped' end,
          publish_lease_token = null, publish_lease_expires_at = null,
          next_publish_at = 'infinity'::timestamptz
        where id = j.id;
    end if;
    return query select 'expired'::text, null::uuid, j.job_type; return;
  end if;
  if not exists (select 1 from public.users u where u.id = j.user_id and u.status = 'active') then
    return query select 'inactive'::text, null::uuid, j.job_type; return;
  end if;
  if j.status in ('succeeded','failed') then return query select 'terminal'::text, null::uuid, j.job_type; return; end if;
  if j.status = 'processing' and (j.processing_lease_expires_at is null or j.processing_lease_expires_at > now()) then
    return query select 'busy'::text, null::uuid, j.job_type; return;
  end if;
  if j.status = 'queued' and j.available_at > now() then return query select 'not_due'::text, null::uuid, j.job_type; return; end if;
  if j.attempts >= 5 then
    update public.processing_jobs set status = 'failed', last_error = 'attempt_limit' where id = j.id;
    return query select 'terminal'::text, null::uuid, j.job_type; return;
  end if;
  update public.processing_jobs set status = 'processing', attempts = attempts + 1,
    processing_token = t, processing_lease_expires_at = now() + interval '5 minutes', last_error = null
    where id = j.id;
  return query select 'claimed'::text, t, j.job_type;
end; $$;

create or replace function public.claim_line_event_publish(p_job_id uuid)
returns table(outcome text, lease_token uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare j public.processing_jobs%rowtype; t uuid := extensions.gen_random_uuid();
begin
  select * into j from public.processing_jobs where id = p_job_id for update;
  if not found or j.job_type <> 'line_event_process' then return query select 'not_found'::text, null::uuid; return; end if;
  if j.expires_at <= now() then
    update public.processing_jobs
      set status = case when status not in ('succeeded', 'failed') then 'failed' else status end,
        last_error = case when status not in ('succeeded', 'failed') then 'expired' else last_error end,
        processing_token = null, processing_lease_expires_at = null,
        publish_status = case when publish_status = 'published' then 'published' else 'skipped' end,
        publish_lease_token = null, publish_lease_expires_at = null,
        next_publish_at = 'infinity'::timestamptz
      where id = j.id;
    return query select 'not_found'::text, null::uuid; return;
  end if;
  if j.publish_status = 'published' then return query select 'published'::text, null::uuid; return; end if;
  if j.publish_status = 'publishing' and j.publish_lease_expires_at > now() then return query select 'busy'::text, null::uuid; return; end if;
  if j.next_publish_at > now() then return query select 'not_due'::text, null::uuid; return; end if;
  update public.processing_jobs set publish_status = 'publishing', publish_attempts = publish_attempts + 1,
    publish_lease_token = t, publish_lease_expires_at = now() + interval '15 seconds', last_publish_error = null
    where id = j.id;
  return query select 'claimed'::text, t;
end; $$;

create or replace function public.claim_line_event_publish_batch(p_limit integer)
returns table(job_id uuid, lease_token uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare j public.processing_jobs%rowtype; t uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'invalid batch limit'; end if;
  update public.processing_jobs
    set status = case when status not in ('succeeded', 'failed') then 'failed' else status end,
      last_error = case when status not in ('succeeded', 'failed') then 'expired' else last_error end,
      processing_token = null, processing_lease_expires_at = null,
      publish_status = case when publish_status = 'published' then 'published' else 'skipped' end,
      publish_lease_token = null, publish_lease_expires_at = null,
      next_publish_at = 'infinity'::timestamptz
    where job_type = 'line_event_process' and expires_at <= now();
  for j in
    select * from public.processing_jobs
    where job_type = 'line_event_process' and expires_at > now()
      and ((publish_status in ('pending', 'retry_due') and next_publish_at <= now())
        or (publish_status = 'publishing' and publish_lease_expires_at <= now()))
    order by next_publish_at, id limit p_limit for update skip locked
  loop
    t := extensions.gen_random_uuid();
    update public.processing_jobs set publish_status = 'publishing', publish_attempts = publish_attempts + 1,
      publish_lease_token = t, publish_lease_expires_at = now() + interval '15 seconds', last_publish_error = null
      where id = j.id;
    job_id := j.id; lease_token := t; return next;
  end loop;
end; $$;

create or replace function public.fail_or_requeue_line_event_job(
  p_job_id uuid, p_processing_token uuid, p_error text
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare j public.processing_jobs%rowtype;
begin
  select * into j from public.processing_jobs
    where id = p_job_id and job_type = 'line_event_process'
      and status = 'processing' and processing_token = p_processing_token for update;
  if not found then return query select 'token_mismatch'::text; return; end if;
  if j.expires_at <= now() then
    update public.processing_jobs set status = 'failed', last_error = 'expired',
      processing_token = null, processing_lease_expires_at = null,
      publish_status = case when publish_status = 'published' then 'published' else 'skipped' end,
      publish_lease_token = null, publish_lease_expires_at = null,
      next_publish_at = 'infinity'::timestamptz
      where id = p_job_id;
    return query select 'failed'::text; return;
  end if;
  if j.attempts >= 5 then
    update public.processing_jobs set status = 'failed', last_error = left(p_error, 200),
      processing_token = null, processing_lease_expires_at = null
      where id = p_job_id;
    return query select 'failed'::text; return;
  end if;
  update public.processing_jobs set status = 'queued', available_at = now(),
    last_error = left(p_error, 200), processing_token = null,
    processing_lease_expires_at = null, publish_status = 'retry_due',
    next_publish_at = now(), publish_lease_token = null,
    publish_lease_expires_at = null
    where id = p_job_id;
  return query select 'requeued'::text;
end; $$;

revoke execute on function public.fail_or_requeue_line_event_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_or_requeue_line_event_job(uuid, uuid, text) to service_role;
