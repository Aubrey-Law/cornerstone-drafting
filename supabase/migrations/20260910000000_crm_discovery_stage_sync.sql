-- Cornerstone — the CRM mirror learns the discovery stage, and stops missing
-- the trigger that moves a lead into it.
--
-- Two defects, one visible symptom.
--
-- 1. `sync_crm_opportunity_from_matter` was declared AFTER UPDATE OF
--    client_intake_id, relationship_status, hired_at, lost_at, stage_entered_at.
--    A column-specific trigger fires off the columns named in the statement's
--    SET list, not off the values that actually changed. The production path
--    that records a discovery call — PATCH /api/admin/matters/[id]/sla-anchors —
--    issues a bare `update matters set discovery_call_at = ...`. The BEFORE
--    trigger `stamp_lead_discovery_stage` then rewrites `stage` and
--    `stage_entered_at` on that row, but neither column is in the SET list, so
--    the mirror never fired. `matters` now carries three BEFORE stampers that
--    move the stage off a column the mirror does not watch
--    (`stage`, `pmps_at`, `discovery_call_at`), so this is a class of bug, not
--    a single miss. The column list is dropped and replaced with a value-based
--    short-circuit: an AFTER row trigger sees the final NEW, including whatever
--    a BEFORE trigger wrote, so comparing values is correct exactly where the
--    column list is wrong — and it cannot rot when the next stamper lands.
--    The guard is six `is distinct from` comparisons and no I/O, so the two
--    lookups and the UPDATE stay gated as before.
--
-- 2. Even when the mirror did fire, its UPDATE ... WHERE clause tested only
--    cornerstone_matter_id, stage_id and status for change. A move that
--    shifted `stage_entered_at` alone matched no rows and was dropped on the
--    floor. `stage_entered_at` joins the guard.
--
-- And the modelling gap behind both: `crm_stage_slug_for_intake` had no
-- discovery stage, so a lead that had held its call still mirrored as
-- 'new_inquiry'. Propagating stage_entered_at without modelling the stage
-- would have been worse than the lag it fixes — the board would show the lead
-- in "New" with its clock reset to the call date. The slug function gains the
-- stage, which also gives the guard in (2) a stage_id change to detect.

-- ── The CRM stage ───────────────────────────────────────────────────────────
--
-- sort_order 15 slots between New (10) and Intake Sent (20); the seed spaced
-- the stages by ten for exactly this. `is_active` so it shows on the board.
insert into public.cornerstone_crm_stages
  (name, slug, sort_order, is_active, is_closed, is_won)
values
  ('Discovery Call', 'discovery_call', 15, true, false, false)
on conflict (slug) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  is_closed = excluded.is_closed,
  is_won = excluded.is_won,
  updated_at = now();

-- ── The slug function learns discovery ──────────────────────────────────────
--
-- discovery_call_at lives on `matters`, not on `client_intake`, so the stage
-- cannot be derived from the intake columns alone and the signature has to
-- grow. Adding a parameter creates an overload rather than replacing the
-- function, and a 7-argument call would keep binding to the old body — so the
-- old signature is dropped first. Nothing persistent depends on it: the two
-- remaining call sites are plpgsql bodies, which resolve at run time and are
-- both recreated below, and the migration is one transaction.
--
-- The new parameter still defaults to null so any 7-argument caller that
-- outlives this migration reads as "no discovery call" — its previous answer —
-- rather than failing to resolve.
drop function if exists public.crm_stage_slug_for_intake(
  text, text, timestamptz, timestamptz, text, timestamptz, text
);

create or replace function public.crm_stage_slug_for_intake(
  p_lead_status text,
  p_intake_status text,
  p_intake_sent_at timestamptz,
  p_intake_completed_at timestamptz,
  p_engagement_status text,
  p_engagement_sent_at timestamptz,
  p_relationship_status text,
  p_discovery_call_at timestamptz default null
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
    -- Below intake and above new: the same ladder ensure_lead_matter() walks,
    -- so the two never disagree about where a lead stands.
    when p_discovery_call_at is not null then 'discovery_call'
    else 'new_inquiry'
  end
$$;

-- ── The intake-side writer ──────────────────────────────────────────────────
--
-- This function writes opportunities.stage_id too. Left on the old ladder it
-- would shove a lead that had held its discovery call back to 'new_inquiry' on
-- the next client_intake touch, fighting the matter-side mirror. It already
-- loads the matter row, so the anchor is in hand.
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
    v_matter.relationship_status,
    v_matter.discovery_call_at
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

revoke all on function public.sync_crm_person_from_intake() from public, anon, authenticated;

-- ── The matter-side mirror ──────────────────────────────────────────────────
create or replace function public.sync_crm_opportunity_from_matter()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_intake public.client_intake;
  v_stage_id uuid;
  v_status text;
begin
  -- Replaces the trigger's old column list. An AFTER row trigger sees the
  -- final NEW, so a stage the BEFORE stampers rewrote is visible here even
  -- though the statement never named it. Pure in-memory comparisons: every
  -- unrelated matter UPDATE leaves without touching a table.
  if tg_op = 'UPDATE'
     and new.client_intake_id is not distinct from old.client_intake_id
     and new.relationship_status is not distinct from old.relationship_status
     and new.hired_at is not distinct from old.hired_at
     and new.lost_at is not distinct from old.lost_at
     and new.stage is not distinct from old.stage
     and new.stage_entered_at is not distinct from old.stage_entered_at then
    return new;
  end if;

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
    new.relationship_status,
    new.discovery_call_at
  );

  v_status := case
    when new.relationship_status = 'hired' then 'won'
    when new.relationship_status = 'lost' then 'lost'
    when new.relationship_status = 'declined' then 'declined'
    else 'open'
  end;

  update public.cornerstone_crm_opportunities
  set cornerstone_matter_id = new.id,
      stage_id = v_stage_id,
      status = v_status,
      closed_at = case when new.relationship_status = 'hired' then new.hired_at when new.relationship_status in ('lost', 'declined') then new.lost_at else null end,
      stage_entered_at = coalesce(new.stage_entered_at, stage_entered_at, now()),
      updated_at = now()
  where client_intake_id = new.client_intake_id
    and (
      cornerstone_matter_id is distinct from new.id
      or stage_id is distinct from v_stage_id
      or status is distinct from v_status
      -- Without this the whole point of the fix is lost: pinning the clock to
      -- the call date moves stage_entered_at and nothing else, and the row
      -- would not qualify.
      or (new.stage_entered_at is not null and stage_entered_at is distinct from new.stage_entered_at)
    );
  return new;
end
$$;

revoke all on function public.sync_crm_opportunity_from_matter() from public, anon, authenticated;

-- No column list: see the header. The value guard above is the filter now.
drop trigger if exists sync_crm_opportunity_from_matter on public.matters;
create trigger sync_crm_opportunity_from_matter
  after insert or update on public.matters
  for each row execute function public.sync_crm_opportunity_from_matter();

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Leads whose discovery call was already recorded mirror as 'new_inquiry'
-- against a stale clock. Scoped to matters carrying the anchor: this change
-- has no opinion about any other row, and a blanket recompute would overwrite
-- CRM stages an attorney had moved by hand.
update public.cornerstone_crm_opportunities o
set stage_id = s.id,
    stage_entered_at = coalesce(m.stage_entered_at, o.stage_entered_at),
    updated_at = now()
from public.matters m
join public.client_intake ci on ci.id = m.client_intake_id
join public.cornerstone_crm_stages s
  on s.slug = public.crm_stage_slug_for_intake(
    ci.lead_status,
    ci.status,
    ci.intake_sent_at,
    ci.intake_completed_at,
    ci.engagement_status,
    ci.engagement_sent_at,
    m.relationship_status,
    m.discovery_call_at
  )
where o.client_intake_id = m.client_intake_id
  and m.discovery_call_at is not null
  and (
    o.stage_id is distinct from s.id
    or (m.stage_entered_at is not null and o.stage_entered_at is distinct from m.stage_entered_at)
  );

notify pgrst, 'reload schema';
