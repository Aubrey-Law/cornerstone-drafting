-- Marketing profiles and Mailgun-backed campaign delivery. Existing sidecar
-- rows remain intact; this migration only adds the fields required to make
-- consent, enrollment, delivery and webhook state explicit.

alter table public.cornerstone_crm_people
  add column if not exists client_intake_id uuid references public.client_intake(id) on delete set null,
  add column if not exists marketing_status text not null default 'unknown',
  add column if not exists consent_source text,
  add column if not exists consent_captured_at timestamptz,
  add column if not exists consent_captured_by uuid references public.users(id) on delete set null,
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists marketing_segment text not null default 'prospect_nurture',
  add column if not exists topic_preferences jsonb not null default '[]'::jsonb,
  add column if not exists preferred_frequency text,
  add column if not exists normalized_email text,
  add column if not exists normalized_phone text,
  add column if not exists duplicate_review_status text not null default 'unreviewed';

update public.cornerstone_crm_people
set client_intake_id = lead_id
where client_intake_id is null and lead_id is not null;

alter table public.cornerstone_crm_people
  drop constraint if exists cornerstone_crm_people_marketing_status_check,
  add constraint cornerstone_crm_people_marketing_status_check check (marketing_status in ('unknown', 'opted_in', 'opted_out')),
  drop constraint if exists cornerstone_crm_people_marketing_segment_check,
  add constraint cornerstone_crm_people_marketing_segment_check check (marketing_segment in ('prospect_nurture', 'client_newsletter', 'excluded')),
  drop constraint if exists cornerstone_crm_people_duplicate_review_status_check,
  add constraint cornerstone_crm_people_duplicate_review_status_check check (duplicate_review_status in ('unreviewed', 'reviewed', 'merged'));

create unique index if not exists cornerstone_crm_people_client_intake_id_idx
  on public.cornerstone_crm_people (client_intake_id) where client_intake_id is not null;
create index if not exists cornerstone_crm_people_marketing_status_idx
  on public.cornerstone_crm_people (marketing_status, marketing_segment);

alter table public.cornerstone_crm_campaigns
  drop constraint if exists cornerstone_crm_campaigns_email_provider_check,
  add constraint cornerstone_crm_campaigns_email_provider_check check (email_provider in ('mailgun', 'sendgrid', 'mailersend', 'resend', 'other'));
alter table public.cornerstone_crm_campaigns alter column email_provider set default 'mailgun';

create table if not exists public.cornerstone_crm_campaign_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.cornerstone_crm_campaigns(id) on delete cascade,
  step_order integer not null,
  delay_days integer not null default 0 check (delay_days >= 0),
  subject text not null,
  body_text text not null,
  body_html text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, step_order)
);
create trigger set_updated_at_cornerstone_crm_campaign_steps
  before update on public.cornerstone_crm_campaign_steps
  for each row execute function public.set_updated_at();

insert into public.cornerstone_crm_campaign_steps (campaign_id, step_order, subject, body_text, body_html)
select id, 1, subject, body_text, body_html
from public.cornerstone_crm_campaigns
where subject is not null and body_text is not null and body_html is not null
on conflict (campaign_id, step_order) do nothing;

create table if not exists public.cornerstone_crm_campaign_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.cornerstone_crm_campaigns(id) on delete cascade,
  campaign_recipient_id uuid not null references public.cornerstone_crm_campaign_recipients(id) on delete cascade,
  step_id uuid not null references public.cornerstone_crm_campaign_steps(id) on delete cascade,
  scheduled_at timestamptz not null default now(),
  provider_status text not null default 'queued',
  provider_message_id text,
  delivery_token text not null unique,
  delivery_token_hash text not null unique,
  attempt_count integer not null default 0,
  error_code text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_recipient_id, step_id),
  check (provider_status in ('queued', 'processing', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complaint', 'unsubscribed', 'failed', 'unknown'))
);
create index if not exists cornerstone_crm_campaign_deliveries_due_idx
  on public.cornerstone_crm_campaign_deliveries (provider_status, scheduled_at)
  where provider_status = 'queued';

create table if not exists public.cornerstone_crm_campaign_dispatches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.cornerstone_crm_campaigns(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  provider_message_id text,
  attempted_count integer not null default 0,
  accepted_count integer not null default 0,
  failed_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.cornerstone_crm_campaign_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  delivery_id uuid references public.cornerstone_crm_campaign_deliveries(id) on delete set null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

alter table public.cornerstone_crm_campaign_deliveries enable row level security;
alter table public.cornerstone_crm_campaign_dispatches enable row level security;
alter table public.cornerstone_crm_campaign_events enable row level security;
create policy "Cornerstone CRM staff read campaign deliveries" on public.cornerstone_crm_campaign_deliveries for select to authenticated using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));
create policy "Cornerstone CRM staff read campaign dispatches" on public.cornerstone_crm_campaign_dispatches for select to authenticated using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));
create policy "Cornerstone CRM staff read campaign events" on public.cornerstone_crm_campaign_events for select to authenticated using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')));

create or replace function public.claim_crm_campaign_deliveries(p_campaign_id uuid, p_limit integer)
returns table (id uuid)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with due as (
    select d.id from public.cornerstone_crm_campaign_deliveries d
    join public.cornerstone_crm_campaigns c on c.id = d.campaign_id
    where d.provider_status = 'queued' and d.scheduled_at <= now()
      and (p_campaign_id is null or d.campaign_id = p_campaign_id)
      and c.status in ('running', 'scheduled')
    order by d.scheduled_at, d.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
    for update skip locked
  )
  update public.cornerstone_crm_campaign_deliveries d
  set provider_status = 'processing', attempt_count = d.attempt_count + 1, updated_at = now()
  from due where d.id = due.id
  returning d.id;
end;
$$;
revoke all on function public.claim_crm_campaign_deliveries(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_crm_campaign_deliveries(uuid, integer) to service_role;
