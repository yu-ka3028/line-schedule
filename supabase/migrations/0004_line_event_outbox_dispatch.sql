-- Outbox dispatcher recovery. Apply after 0003; existing migrations are immutable.
-- Only line_event_process jobs may be sent to the LINE receiver.
-- Extend the trusted claim result so the receiver can route by job_type.
drop function if exists public.claim_processing_job(uuid);
create function public.claim_processing_job(p_job_id uuid)
returns table(outcome text, processing_token uuid, job_type text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare j public.processing_jobs%rowtype; t uuid := extensions.gen_random_uuid();
begin
  select * into j from public.processing_jobs where id = p_job_id for update;
  if not found then return query select 'not_found'::text, null::uuid, null::text; return; end if;
  if j.expires_at is not null and j.expires_at <= now() then
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
revoke execute on function public.claim_processing_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_processing_job(uuid) to service_role;

drop function if exists public.claim_line_event_publish(uuid);
create function public.claim_line_event_publish(p_job_id uuid)
returns table(outcome text, lease_token uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare j public.processing_jobs%rowtype; t uuid := extensions.gen_random_uuid();
begin
  select * into j from public.processing_jobs where id = p_job_id for update;
  if not found or j.job_type <> 'line_event_process' then return query select 'not_found'::text, null::uuid; return; end if;
  if j.publish_status = 'published' then return query select 'published'::text, null::uuid; return; end if;
  if j.publish_status = 'publishing' and j.publish_lease_expires_at > now()
    then return query select 'busy'::text, null::uuid; return; end if;
  if j.next_publish_at > now() then return query select 'not_due'::text, null::uuid; return; end if;
  update public.processing_jobs set publish_status = 'publishing', publish_attempts = publish_attempts + 1,
    publish_lease_token = t, publish_lease_expires_at = now() + interval '15 seconds', last_publish_error = null
    where id = j.id;
  return query select 'claimed'::text, t;
end; $$;

create function public.claim_line_event_publish_batch(p_limit integer)
returns table(job_id uuid, lease_token uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare j public.processing_jobs%rowtype; t uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'invalid batch limit'; end if;
  for j in
    select * from public.processing_jobs
    where job_type = 'line_event_process'
      and ((publish_status in ('pending', 'retry_due') and next_publish_at <= now())
        or (publish_status = 'publishing' and publish_lease_expires_at <= now()))
    order by next_publish_at, id
    limit p_limit
    for update skip locked
  loop
    t := extensions.gen_random_uuid();
    update public.processing_jobs set publish_status = 'publishing', publish_attempts = publish_attempts + 1,
      publish_lease_token = t, publish_lease_expires_at = now() + interval '15 seconds', last_publish_error = null
      where id = j.id;
    job_id := j.id; lease_token := t; return next;
  end loop;
end; $$;

revoke execute on function public.claim_line_event_publish(uuid) from public, anon, authenticated;
revoke execute on function public.claim_line_event_publish_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_line_event_publish(uuid) to service_role;
grant execute on function public.claim_line_event_publish_batch(integer) to service_role;
