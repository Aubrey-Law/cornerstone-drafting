-- Unify the existing lead/contact surfaces behind the Cornerstone CRM tables.
--
-- Compatibility boundary:
--   * client_intake and contacts remain the source of identity/intake facts;
--   * matters remains the workspace/document/drafting container;
--   * CRM people owns CRM/marketing metadata;
--   * CRM opportunities owns sales stage/status;
--   * compatibility triggers keep the legacy lifecycle columns projected.

-- ---------------------------------------------------------------------------
-- Operational CRM stages
-- ---------------------------------------------------------------------------

insert into public.cornerstone_crm_stages
  (name, slug, sort_order, is_active, is_closed, is_won)
values
  ('New', 'new_inquiry', 10, true, false, false),
  ('Intake Sent', 'intake_sent', 20, true, false, false),
  ('Intake Complete', 'intake_complete', 30, true, false, false),
  ('Engagement', 'engagement', 40, true, false, false),
  ('Converted', 'converted', 50, true, true, true),
  ('Closed / Lost', 'closed_lost', 60, true, true, false),
  ('Declined', 'declined', 70, true, true, false),
  ('Needs Review', 'needs_review', 80, true, false, false)
on conflict (slug) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  is_closed = excluded.is_closed,
  is_won = excluded.is_won,
  updated_at = now();

update public.cornerstone_crm_stages
set is_active = false, updated_at = now()
where slug in ('contacted', 'nurture', 'qualified', 'working');

-- The slug UNIQUE constraint already owns an index; the foundation's second
-- explicit slug index is redundant and is flagged by the performance advisor.
drop index if exists public.cornerstone_crm_stages_slug_idx;

-- ---------------------------------------------------------------------------
-- People: a CRM profile over one authoritative intake/contact record
-- ---------------------------------------------------------------------------

alter table public.cornerstone_crm_people
  add column if not exists contact_id uuid references public.contacts(id) on delete cascade,
  add column if not exists person_kind text not null default 'primary',
  add column if not exists record_status text not null default 'active';

alter table public.cornerstone_crm_people
  drop constraint if exists cornerstone_crm_people_source_system_check,
  drop constraint if exists cornerstone_crm_people_person_kind_check,
  drop constraint if exists cornerstone_crm_people_record_status_check,
  drop constraint if exists cornerstone_crm_people_single_source_check,
  drop constraint if exists cornerstone_crm_people_client_intake_id_fkey;

alter table public.cornerstone_crm_people
  add constraint cornerstone_crm_people_source_system_check
    check (source_system in ('lead', 'contact', 'crm_import')),
  add constraint cornerstone_crm_people_person_kind_check
    check (person_kind in ('primary', 'related', 'standalone')),
  add constraint cornerstone_crm_people_record_status_check
    check (record_status in ('active', 'inactive', 'deceased')),
  add constraint cornerstone_crm_people_client_intake_id_fkey
    foreign key (client_intake_id) references public.client_intake(id) on delete cascade,
  add constraint cornerstone_crm_people_single_source_check
    check (num_nonnulls(client_intake_id, contact_id) = 1) not valid;

create unique index if not exists cornerstone_crm_people_contact_id_idx
  on public.cornerstone_crm_people (contact_id)
  where contact_id is not null;
create index if not exists cornerstone_crm_people_person_kind_idx
  on public.cornerstone_crm_people (person_kind, record_status);
create index if not exists cornerstone_crm_people_owner_idx
  on public.cornerstone_crm_people (owner_user_id)
  where owner_user_id is not null;
create index if not exists cornerstone_crm_people_matter_idx
  on public.cornerstone_crm_people (cornerstone_matter_id)
  where cornerstone_matter_id is not null;
create index if not exists cornerstone_crm_people_consent_actor_idx
  on public.cornerstone_crm_people (consent_captured_by)
  where consent_captured_by is not null;

-- ---------------------------------------------------------------------------
-- Opportunities: canonical CRM stage/status over the existing workspace
-- ---------------------------------------------------------------------------

alter table public.cornerstone_crm_opportunities
  add column if not exists client_intake_id uuid references public.client_intake(id) on delete cascade,
  add column if not exists status text not null default 'open',
  add column if not exists owner_user_id uuid references public.users(id) on delete set null,
  add column if not exists assigned_to_user_id uuid references public.users(id) on delete set null,
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists lead_source text,
  add column if not exists practice_area text,
  add column if not exists close_reason text,
  add column if not exists closed_at timestamptz,
  add column if not exists stage_entered_at timestamptz,
  add column if not exists source_system text not null default 'cornerstone',
  add column if not exists updated_by_user_id uuid references public.users(id) on delete set null;

alter table public.cornerstone_crm_opportunities
  drop constraint if exists cornerstone_crm_opportunities_status_check,
  drop constraint if exists cornerstone_crm_opportunities_source_system_check;

alter table public.cornerstone_crm_opportunities
  add constraint cornerstone_crm_opportunities_status_check
    check (status in ('open', 'won', 'lost', 'declined', 'needs_review')),
  add constraint cornerstone_crm_opportunities_source_system_check
    check (source_system in ('cornerstone', 'lawmatics', 'import'));

create unique index if not exists cornerstone_crm_opportunities_intake_idx
  on public.cornerstone_crm_opportunities (client_intake_id)
  where client_intake_id is not null;
create unique index if not exists cornerstone_crm_opportunities_matter_idx
  on public.cornerstone_crm_opportunities (cornerstone_matter_id)
  where cornerstone_matter_id is not null;
create index if not exists cornerstone_crm_opportunities_status_stage_idx
  on public.cornerstone_crm_opportunities (status, stage_id, updated_at desc);
create index if not exists cornerstone_crm_opportunities_follow_up_idx
  on public.cornerstone_crm_opportunities (next_follow_up_at)
  where next_follow_up_at is not null and status = 'open';
create index if not exists cornerstone_crm_opportunities_owner_idx
  on public.cornerstone_crm_opportunities (owner_user_id)
  where owner_user_id is not null;
create index if not exists cornerstone_crm_opportunities_assignee_idx
  on public.cornerstone_crm_opportunities (assigned_to_user_id)
  where assigned_to_user_id is not null;

create or replace function public.crm_stage_slug_for_intake(
  p_lead_status text,
  p_intake_status text,
  p_intake_sent_at timestamptz,
  p_intake_completed_at timestamptz,
  p_engagement_status text,
  p_engagement_sent_at timestamptz,
  p_relationship_status text
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when coalesce(p_relationship_status, p_lead_status) = 'hired' then 'converted'
    when coalesce(p_relationship_status, p_lead_status) = 'lost' then 'closed_lost'
    when coalesce(p_relationship_status, p_lead_status) = 'declined' then 'declined'
    when p_relationship_status is null and p_lead_status is null then 'needs_review'
    when p_engagement_sent_at is not null or p_engagement_status in ('sent', 'viewed', 'signed', 'declined') then 'engagement'
    when p_intake_completed_at is not null or p_intake_status = 'completed' then 'intake_complete'
    when p_intake_sent_at is not null then 'intake_sent'
    else 'new_inquiry'
  end
$$;

-- ---------------------------------------------------------------------------
-- Activities: canonical timeline index with provenance
-- ---------------------------------------------------------------------------

alter table public.cornerstone_crm_activities
  add column if not exists event_type text,
  add column if not exists channel text,
  add column if not exists source_type text,
  add column if not exists source_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.cornerstone_crm_activities
  alter column direction set default 'internal',
  drop constraint if exists cornerstone_crm_activities_type_check,
  drop constraint if exists cornerstone_crm_activities_direction_check,
  drop constraint if exists cornerstone_crm_activities_status_check,
  drop constraint if exists cornerstone_crm_activities_source_check;

alter table public.cornerstone_crm_activities
  add constraint cornerstone_crm_activities_type_check
    check (type in ('note', 'call', 'email', 'sms', 'task', 'meeting', 'campaign_touch', 'status_change', 'system')),
  add constraint cornerstone_crm_activities_direction_check
    check (direction in ('internal', 'inbound', 'outbound')),
  add constraint cornerstone_crm_activities_status_check
    check (status in ('todo', 'done', 'cancelled')),
  add constraint cornerstone_crm_activities_source_check
    check (source in ('cornerstone', 'lawmatics', 'mailgun', 'system', 'other'));

create unique index if not exists cornerstone_crm_activities_source_key_idx
  on public.cornerstone_crm_activities (source_type, source_id)
  where source_type is not null and source_id is not null;
create index if not exists cornerstone_crm_activities_person_created_idx
  on public.cornerstone_crm_activities (person_id, created_at desc);
create index if not exists cornerstone_crm_activities_opportunity_created_idx
  on public.cornerstone_crm_activities (opportunity_id, created_at desc);
create index if not exists cornerstone_crm_activities_event_created_idx
  on public.cornerstone_crm_activities (event_type, created_at desc);
create index if not exists cornerstone_crm_activities_actor_idx
  on public.cornerstone_crm_activities (performed_by_user_id)
  where performed_by_user_id is not null;

-- ---------------------------------------------------------------------------
-- Provider-neutral transactional outbox
-- ---------------------------------------------------------------------------

alter table public.cornerstone_crm_sync_events
  add column if not exists provider text,
  add column if not exists event_name text,
  add column if not exists idempotency_key text,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists completed_at timestamptz;

alter table public.cornerstone_crm_sync_events
  alter column direction set default 'outbound',
  alter column status set default 'held',
  drop constraint if exists cornerstone_crm_sync_events_direction_check,
  drop constraint if exists cornerstone_crm_sync_events_entity_type_check,
  drop constraint if exists cornerstone_crm_sync_events_status_check;

alter table public.cornerstone_crm_sync_events
  add constraint cornerstone_crm_sync_events_direction_check
    check (direction in ('outbound', 'inbound')),
  add constraint cornerstone_crm_sync_events_entity_type_check
    check (entity_type in ('person', 'opportunity', 'activity', 'campaign', 'campaign_recipient', 'campaign_event')),
  add constraint cornerstone_crm_sync_events_status_check
    check (status in ('held', 'ready', 'processing', 'completed', 'failed'));

create unique index if not exists cornerstone_crm_sync_events_idempotency_idx
  on public.cornerstone_crm_sync_events (idempotency_key)
  where idempotency_key is not null;
create index if not exists cornerstone_crm_sync_events_queue_idx
  on public.cornerstone_crm_sync_events (status, available_at, created_at)
  where status in ('ready', 'failed');

-- Campaign recipients are immutable enrollment-time snapshots. Delivery still
-- re-checks the live marketing status so a later opt-out suppresses the send.
drop trigger if exists enforce_crm_recipient_snapshot_immutable on public.cornerstone_crm_campaign_recipients;
alter table public.cornerstone_crm_campaign_recipients
  add column if not exists snapshot_email text,
  add column if not exists snapshot_first_name text,
  add column if not exists snapshot_last_name text,
  add column if not exists snapshot_marketing_status text not null default 'unknown',
  add column if not exists snapshot_person jsonb not null default '{}'::jsonb;

alter table public.cornerstone_crm_campaign_recipients
  drop constraint if exists cornerstone_crm_recipient_snapshot_marketing_check,
  add constraint cornerstone_crm_recipient_snapshot_marketing_check
    check (snapshot_marketing_status in ('unknown', 'opted_in', 'opted_out'));

update public.cornerstone_crm_campaign_recipients r
set snapshot_email = coalesce(r.snapshot_email, p.email),
    snapshot_first_name = coalesce(r.snapshot_first_name, p.first_name),
    snapshot_last_name = coalesce(r.snapshot_last_name, p.last_name),
    snapshot_marketing_status = case when r.snapshot_person = '{}'::jsonb then p.marketing_status else r.snapshot_marketing_status end,
    snapshot_person = case when r.snapshot_person = '{}'::jsonb then jsonb_build_object(
      'person_id', p.id,
      'email', p.email,
      'first_name', p.first_name,
      'last_name', p.last_name
    ) else r.snapshot_person end
from public.cornerstone_crm_people p
where p.id = r.person_id;

create index if not exists cornerstone_crm_campaigns_creator_idx
  on public.cornerstone_crm_campaigns (created_by_user_id);
create index if not exists cornerstone_crm_campaign_deliveries_campaign_idx
  on public.cornerstone_crm_campaign_deliveries (campaign_id);
create index if not exists cornerstone_crm_campaign_deliveries_step_idx
  on public.cornerstone_crm_campaign_deliveries (step_id);
create index if not exists cornerstone_crm_campaign_dispatches_campaign_idx
  on public.cornerstone_crm_campaign_dispatches (campaign_id)
  where campaign_id is not null;
create index if not exists cornerstone_crm_campaign_events_delivery_idx
  on public.cornerstone_crm_campaign_events (delivery_id)
  where delivery_id is not null;
create index if not exists cornerstone_crm_settings_updated_by_idx
  on public.cornerstone_crm_settings (updated_by_user_id)
  where updated_by_user_id is not null;

-- ---------------------------------------------------------------------------
-- Idempotent data backfill
-- ---------------------------------------------------------------------------

insert into public.cornerstone_crm_people (
  source_system,
  lead_id,
  client_intake_id,
  person_kind,
  record_status,
  first_name,
  last_name,
  email,
  phone,
  city,
  state,
  lead_source,
  referral_source,
  lifecycle_status,
  owner_user_id,
  assigned_to_user_id,
  stage_id,
  stage_entered_at,
  sync_state,
  created_at,
  updated_at
)
select
  'lead',
  ci.id,
  ci.id,
  'primary',
  'active',
  ci.first_name,
  ci.last_name,
  nullif(trim(ci.email), ''),
  nullif(trim(ci.phone), ''),
  ci.city,
  ci.state,
  ci.lead_source,
  ci.referral_source,
  case
    when coalesce(m.relationship_status, ci.lead_status) = 'hired' then 'converted'
    when coalesce(m.relationship_status, ci.lead_status) in ('lost', 'declined') then 'closed_lost'
    else 'new'
  end,
  ci.user_id,
  ci.user_id,
  s.id,
  coalesce(m.stage_entered_at, ci.updated_at, ci.created_at, now()),
  'pending',
  coalesce(ci.created_at, now()),
  coalesce(ci.updated_at, ci.created_at, now())
from public.client_intake ci
left join public.matters m on m.id = ci.matter_id
join public.cornerstone_crm_stages s
  on s.slug = public.crm_stage_slug_for_intake(
    ci.lead_status,
    ci.status,
    ci.intake_sent_at,
    ci.intake_completed_at,
    ci.engagement_status,
    ci.engagement_sent_at,
    m.relationship_status
  )
on conflict (client_intake_id) where client_intake_id is not null do update set
  lead_id = excluded.lead_id,
  person_kind = excluded.person_kind,
  record_status = excluded.record_status,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email,
  phone = excluded.phone,
  city = excluded.city,
  state = excluded.state,
  lead_source = excluded.lead_source,
  referral_source = excluded.referral_source,
  owner_user_id = coalesce(public.cornerstone_crm_people.owner_user_id, excluded.owner_user_id),
  assigned_to_user_id = coalesce(public.cornerstone_crm_people.assigned_to_user_id, excluded.assigned_to_user_id),
  updated_at = greatest(public.cornerstone_crm_people.updated_at, excluded.updated_at);

insert into public.cornerstone_crm_people (
  source_system,
  contact_id,
  person_kind,
  record_status,
  first_name,
  last_name,
  email,
  phone,
  city,
  state,
  lifecycle_status,
  stage_id,
  sync_state,
  created_at,
  updated_at
)
select
  'contact',
  c.id,
  case when c.client_intake_id is null then 'standalone' else 'related' end,
  case when coalesce(c.deceased, false) then 'deceased' else 'active' end,
  c.first_name,
  c.last_name,
  nullif(trim(c.email), ''),
  nullif(trim(c.phone), ''),
  c.city,
  c.state,
  'new',
  s.id,
  'pending',
  coalesce(c.created_at, now()),
  coalesce(c.updated_at, c.created_at, now())
from public.contacts c
join public.cornerstone_crm_stages s on s.slug = 'new_inquiry'
where trim(concat_ws(' ', c.first_name, c.last_name)) <> ''
  and lower(trim(concat_ws(' ', c.first_name, c.last_name))) not in ('tbd', 'to be determined')
on conflict (contact_id) where contact_id is not null do update set
  person_kind = excluded.person_kind,
  record_status = excluded.record_status,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email,
  phone = excluded.phone,
  city = excluded.city,
  state = excluded.state,
  updated_at = greatest(public.cornerstone_crm_people.updated_at, excluded.updated_at);

insert into public.cornerstone_crm_opportunities (
  person_id,
  client_intake_id,
  title,
  stage_id,
  status,
  expected_value,
  service_type,
  cornerstone_matter_id,
  owner_user_id,
  assigned_to_user_id,
  next_follow_up_at,
  lead_source,
  practice_area,
  closed_at,
  stage_entered_at,
  source_system,
  created_at,
  updated_at
)
select
  p.id,
  ci.id,
  coalesce(nullif(trim(ci.full_name), ''), nullif(trim(concat_ws(' ', ci.first_name, ci.last_name)), ''), ci.email, 'Opportunity'),
  s.id,
  case
    when coalesce(m.relationship_status, ci.lead_status) = 'hired' then 'won'
    when coalesce(m.relationship_status, ci.lead_status) = 'lost' then 'lost'
    when coalesce(m.relationship_status, ci.lead_status) = 'declined' then 'declined'
    when m.relationship_status is null and ci.lead_status is null then 'needs_review'
    else 'open'
  end,
  ci.engagement_fee_quoted,
  ci.practice_area,
  m.id,
  ci.user_id,
  ci.user_id,
  ci.lead_next_action_snoozed_until,
  ci.lead_source,
  ci.practice_area,
  coalesce(m.hired_at, m.lost_at),
  coalesce(m.stage_entered_at, ci.updated_at, ci.created_at, now()),
  'cornerstone',
  coalesce(ci.created_at, now()),
  greatest(coalesce(ci.updated_at, ci.created_at, now()), coalesce(m.updated_at, m.created_at, ci.created_at, now()))
from public.client_intake ci
join public.cornerstone_crm_people p on p.client_intake_id = ci.id
left join public.matters m on m.id = ci.matter_id
join public.cornerstone_crm_stages s
  on s.slug = public.crm_stage_slug_for_intake(
    ci.lead_status,
    ci.status,
    ci.intake_sent_at,
    ci.intake_completed_at,
    ci.engagement_status,
    ci.engagement_sent_at,
    m.relationship_status
  )
on conflict (client_intake_id) where client_intake_id is not null do update set
  person_id = excluded.person_id,
  title = excluded.title,
  stage_id = excluded.stage_id,
  status = excluded.status,
  expected_value = excluded.expected_value,
  service_type = excluded.service_type,
  cornerstone_matter_id = excluded.cornerstone_matter_id,
  lead_source = excluded.lead_source,
  practice_area = excluded.practice_area,
  closed_at = excluded.closed_at,
  stage_entered_at = excluded.stage_entered_at,
  updated_at = greatest(public.cornerstone_crm_opportunities.updated_at, excluded.updated_at);

insert into public.cornerstone_crm_activities (
  id,
  person_id,
  opportunity_id,
  type,
  event_type,
  channel,
  direction,
  subject,
  body,
  performed_by_user_id,
  status,
  source,
  source_type,
  source_id,
  metadata,
  created_at,
  updated_at
)
select
  la.id,
  p.id,
  o.id,
  case
    when la.event_type like 'email%' then 'email'
    when la.event_type like 'sms%' then 'sms'
    when la.event_type like '%meeting%' or la.event_type like '%consult%' then 'meeting'
    when la.event_type like '%note%' then 'note'
    when la.event_type in ('status_changed', 'converted') then 'status_change'
    else 'system'
  end,
  la.event_type,
  case
    when la.event_type like 'email%' then 'email'
    when la.event_type like 'sms%' then 'sms'
    when la.event_type like '%meeting%' or la.event_type like '%consult%' then 'meeting'
    else 'internal'
  end,
  case
    when la.event_type in ('email_sent', 'sms_sent') then 'outbound'
    when la.event_type = 'sms_received' then 'inbound'
    else 'internal'
  end,
  la.title,
  la.detail,
  u.id,
  'done',
  'cornerstone',
  'lead_activity',
  la.id::text,
  jsonb_build_object('legacy_lead_id', la.lead_id),
  la.created_at,
  la.created_at
from public.lead_activity la
join public.cornerstone_crm_people p on p.client_intake_id = la.lead_id
join public.cornerstone_crm_opportunities o on o.client_intake_id = la.lead_id
left join public.users u on u.id = la.actor_id
on conflict (id) do nothing;

-- Validate the source invariant only after the backfill has normalized old rows.
alter table public.cornerstone_crm_people
  validate constraint cornerstone_crm_people_single_source_check;

-- ---------------------------------------------------------------------------
-- Read models. security_invoker keeps underlying RLS in force.
-- ---------------------------------------------------------------------------

create or replace view public.v_cornerstone_crm_people
with (security_invoker = true)
as
select
  p.id,
  p.client_intake_id,
  p.contact_id,
  p.person_kind,
  p.record_status,
  coalesce(ci.first_name, c.first_name) as first_name,
  coalesce(ci.last_name, c.last_name) as last_name,
  coalesce(
    nullif(trim(ci.full_name), ''),
    nullif(trim(concat_ws(' ', ci.preferred_name, ci.last_name)), ''),
    nullif(trim(concat_ws(' ', ci.first_name, ci.last_name)), ''),
    nullif(trim(concat_ws(' ', c.preferred_name, c.last_name)), ''),
    nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
    p.company_name,
    'Unnamed person'
  ) as name,
  coalesce(nullif(trim(ci.email), ''), nullif(trim(c.email), '')) as email,
  coalesce(nullif(trim(ci.phone), ''), nullif(trim(c.phone), '')) as phone,
  coalesce(ci.city, c.city) as city,
  coalesce(ci.state, c.state) as state,
  p.country,
  ci.practice_area,
  ci.lead_source,
  ci.referral_source,
  ci.matter_id,
  c.client_intake_id as related_intake_id,
  c.relationship_type,
  c.relationship_label,
  p.lifecycle_status,
  p.owner_user_id,
  p.assigned_to_user_id,
  p.next_follow_up_at,
  p.last_engagement_at,
  p.marketing_status,
  p.marketing_segment,
  p.topic_preferences,
  p.preferred_frequency,
  p.duplicate_review_status,
  p.stage_id,
  s.name as stage_name,
  s.slug as stage_slug,
  p.sync_state,
  p.twenty_contact_id,
  p.created_at,
  p.updated_at,
  p.lead_id,
  p.company_name,
  ci.matter_id as cornerstone_matter_id
from public.cornerstone_crm_people p
left join public.client_intake ci on ci.id = p.client_intake_id
left join public.contacts c on c.id = p.contact_id
left join public.cornerstone_crm_stages s on s.id = p.stage_id;

create or replace view public.v_cornerstone_crm_opportunities
with (security_invoker = true)
as
select
  o.*,
  p.person_kind,
  vp.name as person_name,
  vp.email as person_email,
  vp.phone as person_phone,
  s.name as stage_name,
  s.slug as stage_slug,
  m.matter_number,
  m.relationship_status as workspace_relationship_status,
  m.status as workspace_status
from public.cornerstone_crm_opportunities o
join public.cornerstone_crm_people p on p.id = o.person_id
join public.v_cornerstone_crm_people vp on vp.id = p.id
join public.cornerstone_crm_stages s on s.id = o.stage_id
left join public.matters m on m.id = o.cornerstone_matter_id;

create or replace view public.v_cornerstone_crm_parity
with (security_invoker = true)
as
select 'intake_people'::text as entity,
  (select count(*) from public.client_intake)::bigint as source_count,
  (select count(*) from public.cornerstone_crm_people where client_intake_id is not null)::bigint as crm_count
union all
select 'contact_people',
  (select count(*) from public.contacts
    where trim(concat_ws(' ', first_name, last_name)) <> ''
      and lower(trim(concat_ws(' ', first_name, last_name))) not in ('tbd', 'to be determined')),
  (select count(*) from public.cornerstone_crm_people where contact_id is not null)
union all
select 'opportunities',
  (select count(*) from public.client_intake),
  (select count(*) from public.cornerstone_crm_opportunities where client_intake_id is not null)
union all
select 'activities',
  (select count(*) from public.lead_activity),
  (select count(*) from public.cornerstone_crm_activities where source_type = 'lead_activity');

grant select on public.v_cornerstone_crm_people to authenticated, service_role;
grant select on public.v_cornerstone_crm_opportunities to authenticated, service_role;
grant select on public.v_cornerstone_crm_parity to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Compatibility synchronization
-- ---------------------------------------------------------------------------

create or replace function public.sync_crm_person_from_intake()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_matter public.matters;
  v_stage_id uuid;
  v_person_id uuid;
  v_opportunity_id uuid;
begin
  if new.matter_id is not null then
    select * into v_matter from public.matters where id = new.matter_id;
  end if;

  select id into v_stage_id
  from public.cornerstone_crm_stages
  where slug = public.crm_stage_slug_for_intake(
    new.lead_status,
    new.status,
    new.intake_sent_at,
    new.intake_completed_at,
    new.engagement_status,
    new.engagement_sent_at,
    v_matter.relationship_status
  );

  insert into public.cornerstone_crm_people (
    source_system, lead_id, client_intake_id, person_kind, first_name, last_name,
    email, phone, city, state, lead_source, referral_source,
    owner_user_id, assigned_to_user_id, stage_id, stage_entered_at, sync_state
  ) values (
    'lead', new.id, new.id, 'primary', new.first_name, new.last_name,
    nullif(trim(new.email), ''), nullif(trim(new.phone), ''), new.city, new.state,
    new.lead_source, new.referral_source, new.user_id, new.user_id,
    v_stage_id, coalesce(new.updated_at, now()), 'pending'
  )
  on conflict (client_intake_id) where client_intake_id is not null do update set
    lead_id = excluded.lead_id,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    email = excluded.email,
    phone = excluded.phone,
    city = excluded.city,
    state = excluded.state,
    lead_source = excluded.lead_source,
    referral_source = excluded.referral_source,
    stage_id = excluded.stage_id,
    updated_at = now()
  returning id into v_person_id;

  insert into public.cornerstone_crm_opportunities (
    person_id, client_intake_id, title, stage_id, status, expected_value,
    service_type, cornerstone_matter_id, owner_user_id, assigned_to_user_id,
    next_follow_up_at, lead_source, practice_area, closed_at, stage_entered_at
  ) values (
    v_person_id,
    new.id,
    coalesce(nullif(trim(new.full_name), ''), nullif(trim(concat_ws(' ', new.first_name, new.last_name)), ''), new.email, 'Opportunity'),
    v_stage_id,
    case
      when coalesce(v_matter.relationship_status, new.lead_status) = 'hired' then 'won'
      when coalesce(v_matter.relationship_status, new.lead_status) = 'lost' then 'lost'
      when coalesce(v_matter.relationship_status, new.lead_status) = 'declined' then 'declined'
      when v_matter.relationship_status is null and new.lead_status is null then 'needs_review'
      else 'open'
    end,
    new.engagement_fee_quoted,
    new.practice_area,
    new.matter_id,
    new.user_id,
    new.user_id,
    new.lead_next_action_snoozed_until,
    new.lead_source,
    new.practice_area,
    coalesce(v_matter.hired_at, v_matter.lost_at),
    coalesce(v_matter.stage_entered_at, new.updated_at, now())
  )
  on conflict (client_intake_id) where client_intake_id is not null do update set
    person_id = excluded.person_id,
    title = excluded.title,
    stage_id = excluded.stage_id,
    status = excluded.status,
    expected_value = excluded.expected_value,
    service_type = excluded.service_type,
    cornerstone_matter_id = excluded.cornerstone_matter_id,
    next_follow_up_at = excluded.next_follow_up_at,
    lead_source = excluded.lead_source,
    practice_area = excluded.practice_area,
    closed_at = excluded.closed_at,
    updated_at = now()
  returning id into v_opportunity_id;

  if tg_op = 'INSERT' then
    insert into public.cornerstone_crm_activities (
      person_id, opportunity_id, type, event_type, channel, direction,
      subject, performed_by_user_id, status, source, source_type,
      source_id, metadata, created_at, updated_at
    ) values (
      v_person_id, v_opportunity_id, 'system', 'opportunity_created', 'internal', 'internal',
      'Opportunity created', new.user_id, 'done', 'cornerstone', 'client_intake',
      new.id::text, jsonb_build_object('client_intake_id', new.id),
      coalesce(new.created_at, now()), coalesce(new.created_at, now())
    ) on conflict (source_type, source_id) where source_type is not null and source_id is not null do nothing;
  end if;

  return new;
end
$$;

create or replace function public.sync_crm_person_from_contact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_stage_id uuid;
begin
  if trim(concat_ws(' ', new.first_name, new.last_name)) = ''
     or lower(trim(concat_ws(' ', new.first_name, new.last_name))) in ('tbd', 'to be determined') then
    delete from public.cornerstone_crm_people where contact_id = new.id;
    return new;
  end if;

  select id into v_stage_id from public.cornerstone_crm_stages where slug = 'new_inquiry';
  insert into public.cornerstone_crm_people (
    source_system, contact_id, person_kind, record_status, first_name, last_name,
    email, phone, city, state, lifecycle_status, stage_id, sync_state
  ) values (
    'contact', new.id,
    case when new.client_intake_id is null then 'standalone' else 'related' end,
    case when coalesce(new.deceased, false) then 'deceased' else 'active' end,
    new.first_name, new.last_name, nullif(trim(new.email), ''), nullif(trim(new.phone), ''),
    new.city, new.state, 'new', v_stage_id, 'pending'
  )
  on conflict (contact_id) where contact_id is not null do update set
    person_kind = excluded.person_kind,
    record_status = excluded.record_status,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    email = excluded.email,
    phone = excluded.phone,
    city = excluded.city,
    state = excluded.state,
    updated_at = now();
  return new;
end
$$;

create or replace function public.sync_crm_opportunity_from_matter()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_intake public.client_intake;
  v_stage_id uuid;
begin
  if new.client_intake_id is null then return new; end if;
  select * into v_intake from public.client_intake where id = new.client_intake_id;
  if not found then return new; end if;

  select id into v_stage_id
  from public.cornerstone_crm_stages
  where slug = public.crm_stage_slug_for_intake(
    v_intake.lead_status,
    v_intake.status,
    v_intake.intake_sent_at,
    v_intake.intake_completed_at,
    v_intake.engagement_status,
    v_intake.engagement_sent_at,
    new.relationship_status
  );

  update public.cornerstone_crm_opportunities
  set cornerstone_matter_id = new.id,
      stage_id = v_stage_id,
      status = case
        when new.relationship_status = 'hired' then 'won'
        when new.relationship_status = 'lost' then 'lost'
        when new.relationship_status = 'declined' then 'declined'
        else 'open'
      end,
      closed_at = case when new.relationship_status = 'hired' then new.hired_at when new.relationship_status in ('lost', 'declined') then new.lost_at else null end,
      stage_entered_at = coalesce(new.stage_entered_at, stage_entered_at, now()),
      updated_at = now()
  where client_intake_id = new.client_intake_id
    and (
      cornerstone_matter_id is distinct from new.id
      or stage_id is distinct from v_stage_id
      or status is distinct from case
        when new.relationship_status = 'hired' then 'won'
        when new.relationship_status = 'lost' then 'lost'
        when new.relationship_status = 'declined' then 'declined'
        else 'open'
      end
    );
  return new;
end
$$;

create or replace function public.mirror_crm_opportunity_compatibility()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_relationship text;
  v_stage_slug text;
begin
  v_relationship := case
    when new.status = 'won' then 'hired'
    when new.status = 'lost' then 'lost'
    when new.status = 'declined' then 'declined'
    else 'lead'
  end;
  select slug into v_stage_slug from public.cornerstone_crm_stages where id = new.stage_id;

  update public.client_intake
  set lead_status = v_relationship, updated_at = now()
  where id = new.client_intake_id and lead_status is distinct from v_relationship;

  if new.cornerstone_matter_id is not null then
    update public.matters
    set relationship_status = v_relationship,
        hired_at = case when v_relationship = 'hired' then coalesce(hired_at, now()) else hired_at end,
        lost_at = case when v_relationship in ('lost', 'declined') then coalesce(lost_at, now()) else lost_at end,
        updated_at = now()
    where id = new.cornerstone_matter_id
      and relationship_status is distinct from v_relationship;
  end if;

  if tg_op = 'UPDATE' and (old.stage_id is distinct from new.stage_id or old.status is distinct from new.status) then
    insert into public.cornerstone_crm_activities (
      person_id, opportunity_id, type, event_type, channel, direction,
      subject, body, performed_by_user_id, status, source, source_type,
      source_id, metadata
    ) values (
      new.person_id, new.id, 'status_change', 'opportunity_stage_changed', 'internal', 'internal',
      'Opportunity moved to ' || coalesce(v_stage_slug, 'a new stage'),
      case when old.status is distinct from new.status then old.status || ' → ' || new.status else null end,
      new.updated_by_user_id, 'done', 'cornerstone', 'opportunity_transition',
      new.id::text || ':' || extract(epoch from new.updated_at)::text,
      jsonb_build_object('previous_stage_id', old.stage_id, 'stage_id', new.stage_id, 'previous_status', old.status, 'status', new.status)
    ) on conflict (source_type, source_id) where source_type is not null and source_id is not null do nothing;
  end if;
  return new;
end
$$;

create or replace function public.sync_crm_activity_from_lead_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_person_id uuid;
  v_opportunity_id uuid;
  v_actor_id uuid;
begin
  select id into v_person_id from public.cornerstone_crm_people where client_intake_id = new.lead_id;
  select id into v_opportunity_id from public.cornerstone_crm_opportunities where client_intake_id = new.lead_id;
  select id into v_actor_id from public.users where id = new.actor_id;
  if v_person_id is null or v_opportunity_id is null then return new; end if;

  insert into public.cornerstone_crm_activities (
    id, person_id, opportunity_id, type, event_type, channel, direction,
    subject, body, performed_by_user_id, status, source, source_type,
    source_id, metadata, created_at, updated_at
  ) values (
    new.id, v_person_id, v_opportunity_id,
    case
      when new.event_type like 'email%' then 'email'
      when new.event_type like 'sms%' then 'sms'
      when new.event_type like '%meeting%' or new.event_type like '%consult%' then 'meeting'
      when new.event_type like '%note%' then 'note'
      when new.event_type in ('status_changed', 'converted') then 'status_change'
      else 'system'
    end,
    new.event_type,
    case when new.event_type like 'email%' then 'email' when new.event_type like 'sms%' then 'sms' when new.event_type like '%meeting%' or new.event_type like '%consult%' then 'meeting' else 'internal' end,
    case when new.event_type in ('email_sent', 'sms_sent') then 'outbound' when new.event_type = 'sms_received' then 'inbound' else 'internal' end,
    new.title, new.detail, v_actor_id, 'done', 'cornerstone', 'lead_activity',
    new.id::text, jsonb_build_object('legacy_lead_id', new.lead_id), new.created_at, new.created_at
  ) on conflict (id) do nothing;
  return new;
end
$$;

create or replace function public.emit_crm_outbox_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_entity_type text;
  v_event_name text;
  v_idempotency_key text;
begin
  -- A stage mutation already emits the Opportunity outbox event. Its indexed
  -- transition Activity is part of the same transaction and must not create a
  -- second external event for the same business change.
  if tg_table_name = 'cornerstone_crm_activities'
     and to_jsonb(new)->>'source_type' = 'opportunity_transition' then
    return new;
  end if;

  v_entity_type := case tg_table_name
    when 'cornerstone_crm_people' then 'person'
    when 'cornerstone_crm_opportunities' then 'opportunity'
    when 'cornerstone_crm_activities' then 'activity'
    when 'cornerstone_crm_campaigns' then 'campaign'
    when 'cornerstone_crm_campaign_recipients' then 'campaign_recipient'
    else null
  end;
  if v_entity_type is null then return new; end if;
  v_event_name := v_entity_type || '.' || lower(tg_op);
  v_idempotency_key := tg_table_name || ':' || new.id::text || ':' || lower(tg_op) || ':' || coalesce(new.updated_at::text, new.created_at::text);

  insert into public.cornerstone_crm_sync_events (
    direction, entity_type, entity_id, event_name, idempotency_key,
    payload, status, available_at
  ) values (
    'outbound', v_entity_type, new.id, v_event_name, v_idempotency_key,
    to_jsonb(new), 'held', now()
  ) on conflict (idempotency_key) where idempotency_key is not null do nothing;
  return new;
end
$$;

create or replace function public.enforce_crm_recipient_snapshot_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if row(
    new.snapshot_email,
    new.snapshot_first_name,
    new.snapshot_last_name,
    new.snapshot_marketing_status,
    new.snapshot_person
  ) is distinct from row(
    old.snapshot_email,
    old.snapshot_first_name,
    old.snapshot_last_name,
    old.snapshot_marketing_status,
    old.snapshot_person
  ) then
    raise exception 'Campaign recipient snapshots are immutable' using errcode = '22023';
  end if;
  return new;
end
$$;

drop trigger if exists sync_crm_person_from_intake on public.client_intake;
create trigger sync_crm_person_from_intake
  after insert or update of first_name, last_name, full_name, email, phone, city, state,
    lead_source, referral_source, user_id, lead_status, status, intake_sent_at,
    intake_completed_at, engagement_status, engagement_sent_at,
    engagement_fee_quoted, lead_next_action_snoozed_until, practice_area, matter_id
  on public.client_intake
  for each row execute function public.sync_crm_person_from_intake();

drop trigger if exists sync_crm_person_from_contact on public.contacts;
create trigger sync_crm_person_from_contact
  after insert or update of client_intake_id, first_name, last_name, email, phone,
    city, state, deceased
  on public.contacts
  for each row execute function public.sync_crm_person_from_contact();

drop trigger if exists sync_crm_opportunity_from_matter on public.matters;
create trigger sync_crm_opportunity_from_matter
  after insert or update of client_intake_id, relationship_status, hired_at, lost_at, stage_entered_at
  on public.matters
  for each row execute function public.sync_crm_opportunity_from_matter();

drop trigger if exists mirror_crm_opportunity_compatibility on public.cornerstone_crm_opportunities;
create trigger mirror_crm_opportunity_compatibility
  after insert or update of stage_id, status, cornerstone_matter_id
  on public.cornerstone_crm_opportunities
  for each row execute function public.mirror_crm_opportunity_compatibility();

drop trigger if exists sync_crm_activity_from_lead_activity on public.lead_activity;
create trigger sync_crm_activity_from_lead_activity
  after insert on public.lead_activity
  for each row execute function public.sync_crm_activity_from_lead_activity();

drop trigger if exists emit_crm_people_outbox on public.cornerstone_crm_people;
create trigger emit_crm_people_outbox
  after insert or update on public.cornerstone_crm_people
  for each row execute function public.emit_crm_outbox_event();

drop trigger if exists emit_crm_opportunities_outbox on public.cornerstone_crm_opportunities;
create trigger emit_crm_opportunities_outbox
  after insert or update on public.cornerstone_crm_opportunities
  for each row execute function public.emit_crm_outbox_event();

drop trigger if exists emit_crm_activities_outbox on public.cornerstone_crm_activities;
create trigger emit_crm_activities_outbox
  after insert or update on public.cornerstone_crm_activities
  for each row execute function public.emit_crm_outbox_event();

drop trigger if exists emit_crm_campaigns_outbox on public.cornerstone_crm_campaigns;
create trigger emit_crm_campaigns_outbox
  after insert or update on public.cornerstone_crm_campaigns
  for each row execute function public.emit_crm_outbox_event();

drop trigger if exists emit_crm_recipients_outbox on public.cornerstone_crm_campaign_recipients;
create trigger emit_crm_recipients_outbox
  after insert or update on public.cornerstone_crm_campaign_recipients
  for each row execute function public.emit_crm_outbox_event();

create trigger enforce_crm_recipient_snapshot_immutable
  before update on public.cornerstone_crm_campaign_recipients
  for each row execute function public.enforce_crm_recipient_snapshot_immutable();

-- Bootstrap held events are replayable when a provider is eventually enabled.
insert into public.cornerstone_crm_sync_events (
  direction, entity_type, entity_id, event_name, idempotency_key, payload, status
)
select 'outbound', 'person', id, 'person.bootstrap', 'person:' || id::text || ':bootstrap',
  jsonb_build_object('person_id', id), 'held'
from public.cornerstone_crm_people
on conflict (idempotency_key) where idempotency_key is not null do nothing;

insert into public.cornerstone_crm_sync_events (
  direction, entity_type, entity_id, event_name, idempotency_key, payload, status
)
select 'outbound', 'opportunity', id, 'opportunity.bootstrap', 'opportunity:' || id::text || ':bootstrap',
  jsonb_build_object('opportunity_id', id), 'held'
from public.cornerstone_crm_opportunities
on conflict (idempotency_key) where idempotency_key is not null do nothing;

insert into public.cornerstone_crm_sync_events (
  direction, entity_type, entity_id, event_name, idempotency_key, payload, status
)
select 'outbound', 'activity', id, 'activity.bootstrap', 'activity:' || id::text || ':bootstrap',
  jsonb_build_object('activity_id', id), 'held'
from public.cornerstone_crm_activities
on conflict (idempotency_key) where idempotency_key is not null do nothing;

-- Replace the foundation's FOR ALL policies with action-specific policies.
-- This avoids duplicate permissive SELECT policies and evaluates auth.uid once
-- per statement rather than once per row.
create or replace function public.crm_current_user_is_staff(p_admin_only boolean default false)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = (select auth.uid())
      and case
        when p_admin_only then u.role in ('admin', 'attorney')
        else u.role in ('admin', 'attorney', 'va', 'staff')
      end
  )
$$;

alter table public.cornerstone_crm_campaign_steps enable row level security;

do $$
declare
  policy_row record;
  relation_name text;
  predicate text;
begin
  for policy_row in
    select * from (values
      ('public.cornerstone_crm_stages'::regclass, 'stages', true),
      ('public.cornerstone_crm_people'::regclass, 'people', false),
      ('public.cornerstone_crm_opportunities'::regclass, 'opportunities', false),
      ('public.cornerstone_crm_activities'::regclass, 'activities', false),
      ('public.cornerstone_crm_campaigns'::regclass, 'campaigns', false),
      ('public.cornerstone_crm_campaign_recipients'::regclass, 'campaign recipients', false),
      ('public.cornerstone_crm_sync_events'::regclass, 'sync events', false),
      ('public.cornerstone_crm_settings'::regclass, 'settings', true),
      ('public.cornerstone_crm_campaign_steps'::regclass, 'campaign steps', false)
    ) as policies(relation, label, admin_only)
  loop
    relation_name := policy_row.relation::text;
    predicate := format('(select public.crm_current_user_is_staff(%L))', policy_row.admin_only);
    execute format('drop policy if exists %I on %s', 'Cornerstone CRM staff read ' || policy_row.label, relation_name);
    execute format('drop policy if exists %I on %s', 'Cornerstone CRM staff write ' || policy_row.label, relation_name);
    execute format('drop policy if exists %I on %s', 'Cornerstone CRM staff insert ' || policy_row.label, relation_name);
    execute format('drop policy if exists %I on %s', 'Cornerstone CRM staff update ' || policy_row.label, relation_name);
    execute format('drop policy if exists %I on %s', 'Cornerstone CRM staff delete ' || policy_row.label, relation_name);
    execute format('create policy %I on %s for select to authenticated using (%s)', 'Cornerstone CRM staff read ' || policy_row.label, relation_name, predicate);
    execute format('create policy %I on %s for insert to authenticated with check (%s)', 'Cornerstone CRM staff insert ' || policy_row.label, relation_name, predicate);
    execute format('create policy %I on %s for update to authenticated using (%s) with check (%s)', 'Cornerstone CRM staff update ' || policy_row.label, relation_name, predicate, predicate);
    execute format('create policy %I on %s for delete to authenticated using (%s)', 'Cornerstone CRM staff delete ' || policy_row.label, relation_name, predicate);
  end loop;

  for policy_row in
    select * from (values
      ('public.cornerstone_crm_campaign_deliveries'::regclass, 'campaign deliveries'),
      ('public.cornerstone_crm_campaign_dispatches'::regclass, 'campaign dispatches'),
      ('public.cornerstone_crm_campaign_events'::regclass, 'campaign events')
    ) as policies(relation, label)
  loop
    relation_name := policy_row.relation::text;
    execute format('drop policy if exists %I on %s', 'Cornerstone CRM staff read ' || policy_row.label, relation_name);
    execute format(
      'create policy %I on %s for select to authenticated using ((select public.crm_current_user_is_staff(false)))',
      'Cornerstone CRM staff read ' || policy_row.label,
      relation_name
    );
  end loop;
end
$$;

-- Explicit grants: RLS remains the row-level gate for authenticated staff.
revoke all on function public.crm_current_user_is_staff(boolean) from public, anon;
grant execute on function public.crm_current_user_is_staff(boolean) to authenticated, service_role;

grant select, insert, update, delete on public.cornerstone_crm_people to authenticated;
grant select, insert, update, delete on public.cornerstone_crm_opportunities to authenticated;
grant select, insert, update, delete on public.cornerstone_crm_activities to authenticated;
grant select on public.cornerstone_crm_sync_events to authenticated;
grant select, insert, update, delete on public.cornerstone_crm_campaign_steps to authenticated;

revoke all on function public.sync_crm_person_from_intake() from public, anon, authenticated;
revoke all on function public.sync_crm_person_from_contact() from public, anon, authenticated;
revoke all on function public.sync_crm_opportunity_from_matter() from public, anon, authenticated;
revoke all on function public.mirror_crm_opportunity_compatibility() from public, anon, authenticated;
revoke all on function public.sync_crm_activity_from_lead_activity() from public, anon, authenticated;
revoke all on function public.emit_crm_outbox_event() from public, anon, authenticated;
revoke all on function public.enforce_crm_recipient_snapshot_immutable() from public, anon, authenticated;

notify pgrst, 'reload schema';
