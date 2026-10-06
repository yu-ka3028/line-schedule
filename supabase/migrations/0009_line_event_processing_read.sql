-- Read the encrypted LINE event only while its processing job lease is valid.
create or replace function public.read_line_event_for_processing_job(
  p_job_id uuid,
  p_processing_token uuid
) returns table(user_id uuid, payload_ciphertext text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select e.user_id, e.payload_ciphertext
  from public.processing_jobs j
  join public.inbound_events e on e.id = j.inbound_event_id
  where j.id = p_job_id
    and j.job_type = 'line_event_process'
    and j.status = 'processing'
    and j.processing_token = p_processing_token
    and j.processing_lease_expires_at > now()
    and (j.expires_at is null or j.expires_at > now())
$$;

revoke all on function public.read_line_event_for_processing_job(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_line_event_for_processing_job(uuid, uuid)
  to service_role;
