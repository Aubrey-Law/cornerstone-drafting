-- Drop the abandoned Twenty CRM sync columns.
--
-- `cornerstone_crm_people` carries four columns from a provider sync that was
-- never built: `twenty_contact_id`, `twenty_company_id`, `last_synced_at` and
-- `sync_state`. Verified against production before writing this: of 221 people,
-- zero have a Twenty contact id, zero have a company id, zero have ever been
-- synced — and `sync_state` reads `'pending'` on every single row, because the
-- triggers write that literal on insert and nothing has ever advanced it. A
-- column with one value across the whole table carries no information; a reader
-- seeing "pending" would reasonably think a sync was queued.
--
-- They are plumbed all the way into `CrmPeopleRow` but nothing renders them.
--
-- The same trap as 20261012000000 applies, and it is the reason the trigger
-- functions come first: `sync_crm_person_from_intake` and
-- `sync_crm_person_from_contact` both name `sync_state` in their INSERT column
-- lists. plpgsql resolves columns at execution, so dropping the column without
-- rewriting them would not fail this migration — it would fail every
-- `client_intake` and every `contacts` write from that moment on.
--
-- `cornerstone_crm_sync_events` is deliberately untouched. It is the outbox
-- itself rather than a Twenty artefact, it still records people and activity
-- events, and the CRM sync page reads it.

-- ── 1. Stop the triggers naming the column ──────────────────────────────────

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
    v_matter.relationship_status,
    v_matter.discovery_call_at,
    v_matter.pmps_at
  );

  insert into public.cornerstone_crm_people (
    source_system, lead_id, client_intake_id, person_kind, first_name, last_name,
    email, phone, city, state, lead_source, referral_source,
    owner_user_id, assigned_to_user_id, stage_id, stage_entered_at
  ) values (
    'lead', new.id, new.id, 'primary', new.first_name, new.last_name,
    nullif(trim(new.email), ''), nullif(trim(new.phone), ''), new.city, new.state,
    new.lead_source, new.referral_source, new.user_id, new.user_id,
    v_stage_id, coalesce(new.updated_at, now())
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

  if tg_op = 'INSERT' then
    insert into public.cornerstone_crm_activities (
      person_id, type, event_type, channel, direction,
      subject, performed_by_user_id, status, source, source_type,
      source_id, metadata, created_at, updated_at
    ) values (
      v_person_id, 'system', 'opportunity_created', 'internal', 'internal',
      'Opportunity created', new.user_id, 'done', 'cornerstone', 'client_intake',
      new.id::text, jsonb_build_object('client_intake_id', new.id),
      coalesce(new.created_at, now()), coalesce(new.created_at, now())
    ) on conflict (source_type, source_id) where source_type is not null and source_id is not null do nothing;
  end if;

  return new;
end
$$;

revoke all on function public.sync_crm_person_from_intake() from public, anon, authenticated;

create or replace function public.sync_crm_person_from_contact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_stage_id uuid;
begin
  -- A self contact IS the client, who already has a CRM person from their
  -- intake (sync_crm_person_from_intake). Mirroring it here would show the
  -- same human twice in the CRM hub.
  if new.relationship_type = 'self' then
    return new;
  end if;

  if trim(concat_ws(' ', new.first_name, new.last_name)) = ''
     or lower(trim(concat_ws(' ', new.first_name, new.last_name))) in ('tbd', 'to be determined') then
    delete from public.cornerstone_crm_people where contact_id = new.id;
    return new;
  end if;

  select id into v_stage_id from public.cornerstone_crm_stages where slug = 'new_inquiry';
  insert into public.cornerstone_crm_people (
    source_system, contact_id, person_kind, record_status, first_name, last_name,
    email, phone, city, state, lifecycle_status, stage_id
  ) values (
    'contact', new.id,
    case when new.client_intake_id is null then 'standalone' else 'related' end,
    case when coalesce(new.deceased, false) then 'deceased' else 'active' end,
    new.first_name, new.last_name, nullif(trim(new.email), ''), nullif(trim(new.phone), ''),
    new.city, new.state, 'new', v_stage_id
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

revoke all on function public.sync_crm_person_from_contact() from public, anon, authenticated;

-- ── 2. The read model ───────────────────────────────────────────────────────
-- `v_cornerstone_crm_people` exposes two of the four. Neither has a reader —
-- `lib/queries/cornerstoneCrm.ts` reads the base table, not the view — but the
-- view must stop selecting them before they can be dropped.
--
-- Dropped and recreated rather than `create or replace`d: replacing a view can
-- only append columns, never remove them. Verified that nothing else selects
-- from this view, so the drop takes nothing with it.

drop view if exists public.v_cornerstone_crm_people;

create view public.v_cornerstone_crm_people
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
  p.created_at,
  p.updated_at,
  p.lead_id,
  p.company_name,
  ci.matter_id as cornerstone_matter_id
from public.cornerstone_crm_people p
left join public.client_intake ci on ci.id = p.client_intake_id
left join public.contacts c on c.id = p.contact_id
left join public.cornerstone_crm_stages s on s.id = p.stage_id;

grant select on public.v_cornerstone_crm_people to authenticated, service_role;

-- ── 3. The columns ──────────────────────────────────────────────────────────
-- Their unique constraint on `twenty_contact_id`, the partial unique index and
-- the `sync_state` CHECK are all dropped with them, being constraints involving
-- a dropped column.

alter table public.cornerstone_crm_people
  drop column if exists twenty_contact_id,
  drop column if exists twenty_company_id,
  drop column if exists last_synced_at,
  drop column if exists sync_state;

notify pgrst, 'reload schema';
