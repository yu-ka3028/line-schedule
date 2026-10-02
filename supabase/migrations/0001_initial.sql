-- Initial persistence schema for the service.
--
-- The application treats Google Calendar as the source of truth. Supabase stores
-- application metadata, transient inbound data, jobs, and usage records.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_status_check
    check (status in ('active', 'stopped', 'deleted'))
);

comment on column public.users.line_user_id is
  'LINE user identifier; inaccessible to clients because this table has no client RLS policy.';

create table public.google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  google_account_id text not null,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_connections_user_account_unique unique (user_id, google_account_id)
);

comment on column public.google_connections.access_token_ciphertext is
  'Encrypted ciphertext only; never store an OAuth access token in plaintext.';
comment on column public.google_connections.refresh_token_ciphertext is
  'Encrypted ciphertext only; never store an OAuth refresh token in plaintext.';

create index google_connections_google_account_id_idx
  on public.google_connections (google_account_id);

create table public.user_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  timezone text not null default 'Asia/Tokyo',
  notifications_enabled boolean not null default true,
  default_reminder_minutes integer not null default 1440,
  automation_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_default_reminder_minutes_check
    check (default_reminder_minutes >= 0)
);

create table public.schedule_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  google_calendar_id text not null,
  google_event_id text not null,
  bot_event_id text not null,
  source text not null default 'bot',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_links_google_event_unique
    unique (user_id, google_calendar_id, google_event_id),
  constraint schedule_links_source_check
    check (source in ('bot')),
  constraint schedule_links_status_check
    check (status in ('active', 'deleted'))
);

create index schedule_links_user_id_idx on public.schedule_links (user_id);
create index schedule_links_user_calendar_idx
  on public.schedule_links (user_id, google_calendar_id);

create table public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  line_event_id text not null unique,
  message_type text not null,
  payload_ciphertext text not null,
  status text not null default 'received',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbound_events_status_check
    check (status in ('received', 'processing', 'processed', 'failed'))
);

comment on column public.inbound_events.payload_ciphertext is
  'Application-encrypted ciphertext for the event body, images, and event content; this schema does not perform encryption.';

create index inbound_events_status_idx on public.inbound_events (status);
create index inbound_events_expires_at_idx on public.inbound_events (expires_at)
  where expires_at is not null;

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  inbound_event_id uuid references public.inbound_events(id) on delete set null,
  idempotency_key text not null unique,
  qstash_message_id text unique,
  job_type text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  last_error text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processing_jobs_attempts_check check (attempts >= 0),
  constraint processing_jobs_job_type_check
    check (job_type in ('calendar_create', 'calendar_update', 'calendar_delete')),
  constraint processing_jobs_status_check
    check (status in ('queued', 'processing', 'succeeded', 'failed'))
);

create index processing_jobs_status_available_at_idx
  on public.processing_jobs (status, available_at);
create index processing_jobs_inbound_event_id_idx
  on public.processing_jobs (inbound_event_id);
create index processing_jobs_expires_at_idx on public.processing_jobs (expires_at)
  where expires_at is not null;

create table public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  operation text not null,
  quantity integer not null default 1,
  estimated_cost_yen numeric not null default 0,
  -- Do not store secrets or message/event body content in metadata.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usage_logs_quantity_check check (quantity > 0),
  constraint usage_logs_estimated_cost_yen_check check (estimated_cost_yen >= 0)
);

create index usage_logs_created_at_idx on public.usage_logs (created_at);
create index usage_logs_user_created_at_idx
  on public.usage_logs (user_id, created_at);
create index usage_logs_operation_created_at_idx
  on public.usage_logs (operation, created_at);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();
create trigger google_connections_set_updated_at
  before update on public.google_connections
  for each row execute function public.set_updated_at();
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();
create trigger schedule_links_set_updated_at
  before update on public.schedule_links
  for each row execute function public.set_updated_at();
create trigger inbound_events_set_updated_at
  before update on public.inbound_events
  for each row execute function public.set_updated_at();
create trigger processing_jobs_set_updated_at
  before update on public.processing_jobs
  for each row execute function public.set_updated_at();
create trigger usage_logs_set_updated_at
  before update on public.usage_logs
  for each row execute function public.set_updated_at();

-- MVP authorization boundary: every table is backend-only. No client policies
-- are intentionally defined, so anon/authenticated clients cannot read or write
-- these tables. The backend must use a server-side service role connection.
alter table public.users enable row level security;
alter table public.google_connections enable row level security;
alter table public.user_settings enable row level security;
alter table public.schedule_links enable row level security;
alter table public.inbound_events enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.usage_logs enable row level security;
