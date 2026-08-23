-- Retire the CRM opportunity mirror: stop writing it, stop it writing back.
--
-- `cornerstone_crm_opportunities` was built as a CRM-shaped mirror of a lead.
-- Nothing ever came to depend on it: no application code writes it, the
-- Opportunities pages are re-exports of the leads pages and read `client_intake`
-- and `matters`, `v_cornerstone_crm_opportunities` has no reader at all, and the
-- 415 `opportunity.*` outbox rows it has emitted sit `held` with no consumer.
-- Its one application read — the CRM activities page — has been re-pointed at
-- `cornerstone_crm_people`, which carries the same intake id.
--
-- What the mirror did carry was a hazard. `mirror_crm_opportunity_compatibility`
-- wrote `client_intake.lead_status` and `matters.relationship_status` *back* from
-- the mirror, while the two sync triggers wrote the mirror *from* those same two
-- tables. Nothing outside the database ever wrote the mirror, so that write-back
-- could only ever echo a value it had just been handed — a loop with no
-- authoritative writer, which is what made the CRM data model hard to reason
-- about. It is also demonstrably not load-bearing: `update_lead_opportunity_status`
-- and `convert_lead_to_matter` already write both tables directly, the leads list
-- overrides `lead_status` from `matters.relationship_status` at render time, and
-- 27 production rows currently sit with a NULL `lead_status` against a `hired`
-- matter and a `won` opportunity — the echo has been inert on a third of the
-- data while the app ran fine on it.
--
-- This migration stops the mirror. It deliberately does NOT drop the table: the
-- code and the schema deploy in no guaranteed order (see
-- supabase/migrations/README.md), so the previous release must keep finding the
-- table where it left it. The table, its rows, its indexes, its RLS policies and
-- `cornerstone_crm_activities.opportunity_id` all stay exactly as they are, and
-- a later migration drops them once nothing reads the old shape.
--
-- Dropping the table is not a one-liner when that time comes, so the order is
-- recorded here: the FK from `cornerstone_crm_activities.opportunity_id` is ON
-- DELETE CASCADE and would take all 235 activity rows with it; both
-- `v_cornerstone_crm_opportunities` and `v_cornerstone_crm_parity` are hard
-- DROP blockers; and the three functions below must already have stopped naming
-- the table, or every `client_intake`, `matters` and `lead_activity` write in
-- the app starts raising.

-- ── 1. Stop the write-back loop ─────────────────────────────────────────────
-- The echo into client_intake/matters, and the stage-change activity it wrote.
-- The activity is not lost: `sync_crm_activity_from_lead_activity` still mirrors
-- the `lead_activity` timeline, which is where staff-visible history comes from.

drop trigger if exists mirror_crm_opportunity_compatibility on public.cornerstone_crm_opportunities;
drop function if exists public.mirror_crm_opportunity_compatibility();

-- ── 2. Stop emitting outbox events for a table nobody syncs ──────────────────
-- Only the opportunities trigger goes; `emit_crm_outbox_event()` still backs the
-- other CRM tables. Existing held rows are left alone.

drop trigger if exists emit_crm_opportunities_outbox on public.cornerstone_crm_opportunities;

-- ── 3. Stop writing the mirror from matters ─────────────────────────────────
-- This function existed only to push matter state into the mirror, so it goes
-- whole. Its trigger fired on every `matters` write with no column list.

drop trigger if exists sync_crm_opportunity_from_matter on public.matters;
drop function if exists public.sync_crm_opportunity_from_matter();

-- ── 4. Stop writing the mirror from client_intake ───────────────────────────
-- The person upsert is unchanged — `cornerstone_crm_people` is live and heavily
-- read. Only the opportunity upsert is removed. The lead-created activity stays
-- so the CRM timeline still opens with it, now with a null `opportunity_id`,
-- which the table's CHECK allows because `person_id` is always present.

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

  if tg_op = 'INSERT' then
    insert into public.cornerstone_crm_activities (
      person_id, opportunity_id, type, event_type, channel, direction,
      subject, performed_by_user_id, status, source, source_type,
      source_id, metadata, created_at, updated_at
    ) values (
      v_person_id, null, 'system', 'opportunity_created', 'internal', 'internal',
      'Opportunity created', new.user_id, 'done', 'cornerstone', 'client_intake',
      new.id::text, jsonb_build_object('client_intake_id', new.id),
      coalesce(new.created_at, now()), coalesce(new.created_at, now())
    ) on conflict (source_type, source_id) where source_type is not null and source_id is not null do nothing;
  end if;

  return new;
end
$$;

revoke all on function public.sync_crm_person_from_intake() from public, anon, authenticated;

-- ── 5. Keep the activity timeline alive without an opportunity ──────────────
-- This guard is why the mirror could not simply be abandoned: the function
-- returned early when no opportunity row existed, so with the mirror no longer
-- written, every new lead's `lead_activity` rows would silently stop reaching
-- the CRM activities page while old leads kept working. Only `person_id` is
-- genuinely required, and it is what the page reads.

create or replace function public.sync_crm_activity_from_lead_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_person_id uuid;
  v_actor_id uuid;
begin
  select id into v_person_id from public.cornerstone_crm_people where client_intake_id = new.lead_id;
  select id into v_actor_id from public.users where id = new.actor_id;
  if v_person_id is null then return new; end if;

  insert into public.cornerstone_crm_activities (
    id, person_id, opportunity_id, type, event_type, channel, direction,
    subject, body, performed_by_user_id, status, source, source_type,
    source_id, metadata, created_at, updated_at
  ) values (
    new.id, v_person_id, null,
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

revoke all on function public.sync_crm_activity_from_lead_activity() from public, anon, authenticated;

-- ── 6. Mark the table for removal ───────────────────────────────────────────

comment on table public.cornerstone_crm_opportunities is
  'DEPRECATED as of 20261008000000 and no longer written or read. Retained only '
  'so the release deployed before this migration still finds it. A later '
  'migration drops it, in this order: null cornerstone_crm_activities.opportunity_id '
  'and drop its ON DELETE CASCADE FK, drop v_cornerstone_crm_opportunities, amend '
  'v_cornerstone_crm_parity, then drop this table. Lead lifecycle lives on '
  'client_intake and matters; CRM identity lives on cornerstone_crm_people.';

comment on column public.cornerstone_crm_activities.opportunity_id is
  'DEPRECATED and no longer populated. The activities page resolves the '
  'opportunity through person_id instead. Dropped with the mirror table.';

notify pgrst, 'reload schema';
