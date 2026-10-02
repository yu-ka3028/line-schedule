alter table public.processing_jobs
  add column processing_token uuid,
  add column processing_lease_expires_at timestamptz;

create or replace function public.claim_processing_job(p_job_id uuid)
returns table(outcome text, processing_token uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare j public.processing_jobs%rowtype; t uuid := extensions.gen_random_uuid();
begin
  select * into j from public.processing_jobs where id = p_job_id for update;
  if not found then return query select 'not_found'::text, null::uuid; return; end if;
  if j.expires_at is not null and j.expires_at <= now() then
    return query select 'expired'::text, null::uuid; return;
  end if;
  if not exists (select 1 from public.users u where u.id = j.user_id and u.status = 'active') then
    return query select 'inactive'::text, null::uuid; return;
  end if;
  if j.status in ('succeeded','failed') then return query select 'terminal'::text, null::uuid; return; end if;
  if j.status = 'processing' and (j.processing_lease_expires_at is null or j.processing_lease_expires_at > now()) then
    return query select 'busy'::text, null::uuid; return;
  end if;
  if j.status = 'queued' and j.available_at > now() then return query select 'not_due'::text, null::uuid; return; end if;
  if j.attempts >= 5 then
    update public.processing_jobs set status = 'failed', last_error = 'attempt_limit' where id = j.id;
    return query select 'terminal'::text, null::uuid; return;
  end if;
  update public.processing_jobs set status = 'processing', attempts = attempts + 1,
    processing_token = t, processing_lease_expires_at = now() + interval '5 minutes', last_error = null
    where id = j.id;
  return query select 'claimed'::text, t;
end; $$;

create or replace function public.succeed_processing_job(p_job_id uuid, p_processing_token uuid)
returns table(outcome text) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.processing_jobs set status = 'succeeded', processing_token = null, processing_lease_expires_at = null
    where id = p_job_id and status = 'processing' and processing_token = p_processing_token;
  if found then return query select 'succeeded'::text; else return query select 'token_mismatch'::text; end if;
end; $$;

create or replace function public.fail_or_requeue_processing_job(p_job_id uuid, p_processing_token uuid, p_error text)
returns table(outcome text) language plpgsql security definer set search_path = public, pg_temp as $$
declare a integer;
begin
  select attempts into a from public.processing_jobs where id = p_job_id and status = 'processing' and processing_token = p_processing_token for update;
  if not found then return query select 'token_mismatch'::text; return; end if;
  if a >= 5 then
    update public.processing_jobs set status = 'failed', last_error = left(p_error, 200), processing_token = null, processing_lease_expires_at = null where id = p_job_id;
    return query select 'failed'::text;
  end if;
  -- The HTTP 500 lets QStash apply its own retry backoff; do not add a DB delay.
  update public.processing_jobs set status = 'queued', available_at = now(), last_error = left(p_error, 200), processing_token = null, processing_lease_expires_at = null where id = p_job_id;
  return query select 'requeued'::text;
end; $$;

revoke execute on function public.claim_processing_job(uuid) from public, anon, authenticated;
revoke execute on function public.succeed_processing_job(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.fail_or_requeue_processing_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_processing_job(uuid) to service_role;
grant execute on function public.succeed_processing_job(uuid, uuid) to service_role;
grant execute on function public.fail_or_requeue_processing_job(uuid, uuid, text) to service_role;
