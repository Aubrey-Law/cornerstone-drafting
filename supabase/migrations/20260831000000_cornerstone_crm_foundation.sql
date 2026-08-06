-- Foundation CRM tables for the lightweight Cornerstone CRM sidecar.
-- These tables are intentionally narrow: a lightweight contact/opportunity model,
-- campaign tracking, and provider-agnostic sync state for external systems.

create table if not exists public.cornerstone_crm_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_closed boolean not null default false,
  is_won boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug)
);

create unique index if not exists cornerstone_crm_stages_slug_idx on public.cornerstone_crm_stages (slug);
create index if not exists cornerstone_crm_stages_sort_order_idx on public.cornerstone_crm_stages (is_active, sort_order);

create trigger set_updated_at_cornerstone_crm_stages
  before update on public.cornerstone_crm_stages
  for each row execute function public.set_updated_at();

insert into public.cornerstone_crm_stages (name, slug, sort_order)
values
  ('New Inquiry', 'new_inquiry', 10),
  ('Contacted', 'contacted', 20),
  ('Nurture', 'nurture', 30),
  ('Qualified', 'qualified', 40),
  ('Working', 'working', 50),
  ('Converted', 'converted', 60),
  ('Closed / Lost', 'closed_lost', 70)
on conflict (slug) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_closed = excluded.is_closed,
  is_won = excluded.is_won,
  updated_at = now();

create table if not exists public.cornerstone_crm_people (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'lead',
  lead_id uuid references public.client_intake(id) on delete set null,
  cornerstone_matter_id uuid references public.matters(id) on delete set null,
  first_name text,
  last_name text,
  email text,
  phone text,
  mobile_phone text,
  company_name text,
  job_title text,
  city text,
  state text,
  country text,
  lead_source text,
  referral_source text,
  lifecycle_status text not null default 'new',
  owner_user_id uuid references public.users(id) on delete set null,
  assigned_to_user_id uuid references public.users(id) on delete set null,
  next_follow_up_at timestamptz,
  last_engagement_at timestamptz,
  campaign_opt_out boolean not null default false,  twenty_contact_id text,
  twenty_company_id text,
  sync_state text not null default 'pending',
  last_synced_at timestamptz,
  stage_id uuid not null references public.cornerstone_crm_stages(id),
  stage_entered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id),
  unique (twenty_contact_id),
  check (source_system in ('lead', 'crm_import')),
  check (lifecycle_status in ('new', 'contacted', 'nurture', 'qualified', 'working', 'converted', 'closed_lost')),
  check (sync_state in ('synced', 'pending', 'failed'))
);

create unique index if not exists cornerstone_crm_people_lead_id_idx on public.cornerstone_crm_people (lead_id) where lead_id is not null;
create unique index if not exists cornerstone_crm_people_twenty_contact_id_idx on public.cornerstone_crm_people (twenty_contact_id) where twenty_contact_id is not null;
create index if not exists cornerstone_crm_people_stage_idx on public.cornerstone_crm_people (stage_id);
create index if not exists cornerstone_crm_people_assignee_idx on public.cornerstone_crm_people (assigned_to_user_id);
create index if not exists cornerstone_crm_people_follow_up_idx on public.cornerstone_crm_people (next_follow_up_at) where next_follow_up_at is not null;
create index if not exists cornerstone_crm_people_search_idx on public.cornerstone_crm_people (lower(email));

create trigger set_updated_at_cornerstone_crm_people
  before update on public.cornerstone_crm_people
  for each row execute function public.set_updated_at();

create table if not exists public.cornerstone_crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.cornerstone_crm_people(id) on delete cascade,
  title text not null,
  stage_id uuid not null references public.cornerstone_crm_stages(id),
  confidence_score smallint,
  expected_value numeric,
  expected_close_date date,
  service_type text,
  notes text,
  cornerstone_matter_id uuid references public.matters(id) on delete set null,
  twenty_opportunity_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, title),
  check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 100))
);

create index if not exists cornerstone_crm_opportunities_person_idx on public.cornerstone_crm_opportunities (person_id);
create index if not exists cornerstone_crm_opportunities_stage_idx on public.cornerstone_crm_opportunities (stage_id);
create index if not exists cornerstone_crm_opportunities_twenty_idx on public.cornerstone_crm_opportunities (twenty_opportunity_id) where twenty_opportunity_id is not null;

create trigger set_updated_at_cornerstone_crm_opportunities
  before update on public.cornerstone_crm_opportunities
  for each row execute function public.set_updated_at();

create table if not exists public.cornerstone_crm_activities (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.cornerstone_crm_people(id) on delete cascade,
  opportunity_id uuid references public.cornerstone_crm_opportunities(id) on delete cascade,
  type text not null,
  direction text not null,
  subject text,
  body text,
  performed_by_user_id uuid references public.users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  status text not null default 'todo',
  source text not null default 'cornerstone',
  external_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type in ('note', 'call', 'email', 'task', 'meeting', 'campaign_touch')),
  check (direction in ('inbound', 'outbound')),
  check (status in ('todo', 'done', 'cancelled')),
  check (source in ('cornerstone', 'twenty', 'sendgrid', 'other')),
  check (person_id is not null or opportunity_id is not null)
);

create index if not exists cornerstone_crm_activities_person_idx on public.cornerstone_crm_activities (person_id);
create index if not exists cornerstone_crm_activities_opportunity_idx on public.cornerstone_crm_activities (opportunity_id);
create index if not exists cornerstone_crm_activities_status_idx on public.cornerstone_crm_activities (status, due_at);
create index if not exists cornerstone_crm_activities_external_idx on public.cornerstone_crm_activities (external_event_id) where external_event_id is not null;

create trigger set_updated_at_cornerstone_crm_activities
  before update on public.cornerstone_crm_activities
  for each row execute function public.set_updated_at();

create table if not exists public.cornerstone_crm_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  status text not null default 'draft',
  audience_rules jsonb not null default '{}'::jsonb,
  email_provider text not null default 'sendgrid',
  provider_template_id text,
  send_schedule_cron_or_date text,
  twenty_view_filter jsonb,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type in ('newsletter', 'nurture')),
  check (status in ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled')),
  check (email_provider in ('sendgrid', 'mailersend', 'resend', 'other'))
);

create index if not exists cornerstone_crm_campaigns_status_idx on public.cornerstone_crm_campaigns (status);
create index if not exists cornerstone_crm_campaigns_type_idx on public.cornerstone_crm_campaigns (type);

create trigger set_updated_at_cornerstone_crm_campaigns
  before update on public.cornerstone_crm_campaigns
  for each row execute function public.set_updated_at();

create table if not exists public.cornerstone_crm_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.cornerstone_crm_campaigns(id) on delete cascade,
  person_id uuid not null references public.cornerstone_crm_people(id) on delete cascade,
  provider_message_id text,
  provider_status text not null default 'queued',
  error_code text,
  external_url text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, person_id),
  check (provider_status in ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complaint', 'unsubscribed', 'failed'))
);

create index if not exists cornerstone_crm_campaign_recipients_campaign_idx on public.cornerstone_crm_campaign_recipients (campaign_id, provider_status);
create index if not exists cornerstone_crm_campaign_recipients_person_idx on public.cornerstone_crm_campaign_recipients (person_id);

create trigger set_updated_at_cornerstone_crm_campaign_recipients
  before update on public.cornerstone_crm_campaign_recipients
  for each row execute function public.set_updated_at();

create table if not exists public.cornerstone_crm_sync_events (
  id uuid primary key default gen_random_uuid(),
  direction text not null,
  entity_type text not null,
  entity_id uuid not null,
  provider_event_id text,
  payload jsonb,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (direction in ('to_twenty', 'from_twenty')),
  check (entity_type in ('person', 'opportunity', 'activity', 'campaign_event')),
  check (status in ('pending', 'retried', 'success', 'failed'))
);

create index if not exists cornerstone_crm_sync_events_direction_idx on public.cornerstone_crm_sync_events (direction, status);
create index if not exists cornerstone_crm_sync_events_entity_idx on public.cornerstone_crm_sync_events (entity_type, entity_id);
create index if not exists cornerstone_crm_sync_events_provider_event_idx on public.cornerstone_crm_sync_events (provider_event_id) where provider_event_id is not null;

create trigger set_updated_at_cornerstone_crm_sync_events
  before update on public.cornerstone_crm_sync_events
  for each row execute function public.set_updated_at();

create table if not exists public.cornerstone_crm_settings (
  key text primary key,
  value_json jsonb not null default '{}'::jsonb,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at_cornerstone_crm_settings
  before update on public.cornerstone_crm_settings
  for each row execute function public.set_updated_at();

-- Optional defaults used by the admin side: keep an empty row for config.
insert into public.cornerstone_crm_settings (key, value_json)
values ('mail', '{}')
on conflict (key) do nothing;

alter table public.cornerstone_crm_stages enable row level security;
alter table public.cornerstone_crm_people enable row level security;
alter table public.cornerstone_crm_opportunities enable row level security;
alter table public.cornerstone_crm_activities enable row level security;
alter table public.cornerstone_crm_campaigns enable row level security;
alter table public.cornerstone_crm_campaign_recipients enable row level security;
alter table public.cornerstone_crm_sync_events enable row level security;
alter table public.cornerstone_crm_settings enable row level security;

create policy "Cornerstone CRM staff read stages" on public.cornerstone_crm_stages
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff write stages" on public.cornerstone_crm_stages
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney')));

create policy "Cornerstone CRM staff read people" on public.cornerstone_crm_people
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff write people" on public.cornerstone_crm_people
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff read opportunities" on public.cornerstone_crm_opportunities
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff write opportunities" on public.cornerstone_crm_opportunities
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff read activities" on public.cornerstone_crm_activities
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff write activities" on public.cornerstone_crm_activities
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff read campaigns" on public.cornerstone_crm_campaigns
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff write campaigns" on public.cornerstone_crm_campaigns
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff read campaign recipients" on public.cornerstone_crm_campaign_recipients
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff write campaign recipients" on public.cornerstone_crm_campaign_recipients
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff read sync events" on public.cornerstone_crm_sync_events
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff write sync events" on public.cornerstone_crm_sync_events
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff read settings" on public.cornerstone_crm_settings
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create policy "Cornerstone CRM staff write settings" on public.cornerstone_crm_settings
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney')));

-- Keep this lightweight surface simple by defaulting people to a lead stage.
update public.cornerstone_crm_people
set stage_id = (select id from public.cornerstone_crm_stages where slug = 'new_inquiry' limit 1)
where stage_id is null;
