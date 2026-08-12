-- Cornerstone — a booked PMPS is a pre-engagement event.
--
-- Under the v1 SLA the Peace of Mind Planning Session *was* the design meeting:
-- it happened after the engagement was signed, to a hired matter sitting in
-- `intake`, and booking one pushed that matter to `design`. The appointment
-- type still carries the slug `design-meeting` from that era.
--
-- v3 (20260824000001) moved it. The PMPS now happens while the record is still
-- a lead — "Hold Peace of Mind Planning Session" is phase `intake_completed`,
-- the recommendations go out at pmps + 1, and the engagement is signed at
-- pmps + 4. So the one thing booking a PMPS must do is record
-- `matters.pmps_at`: it is the anchor eleven v3 tasks compute their dates from,
-- and until it exists every one of them is undated.
--
-- This migration makes the stage follow the anchor rather than the booking:
--
--   * `pipeline_stage_rank()` gives the lead and matter stages one ordered
--     vocabulary, so "forward-only" is expressible in SQL.
--   * `stamp_lead_pmps_stage` moves a lead to `intake_completed` when its
--     `pmps_at` lands, from any earlier stage and never from a hired matter.
--   * `stage_entered_at` is pinned to the session date instead of now(), so the
--     Planning Session clock does not start running the moment a lead books a
--     meeting three weeks out.
--
-- Keying off the column rather than the booking means every writer gets the
-- same behaviour: the native scheduler, the Cal.com/Calendly webhook, and an
-- attorney typing the date into the matter's key-dates panel.

-- ── One ordered stage vocabulary ────────────────────────────────────────────
--
-- The lead stages followed by the matter stages, interleaved with the legacy v1
-- phase names — the same order as `SLA_PHASES` in lib/slaTasks/types.ts, which a
-- test holds the two to. Ranks are spaced so a stage can be slotted in later
-- without renumbering. Unknown stages rank null, which every guard here reads as
-- "no opinion" rather than "at the end".

create or replace function public.pipeline_stage_rank(p_stage text)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case p_stage
    -- Lead stages
    when 'new_lead'          then 10
    when 'intake_sent'       then 20
    when 'intake_completed'  then 30
    when 'engagement_sent'   then 40
    -- Matter stages
    when 'intake'            then 50
    when 'intake_review'     then 60
    when 'onboarding'        then 70  -- legacy v1
    when 'design'            then 80
    when 'drafting'          then 90
    when 'review'            then 100 -- legacy v1
    when 'client_review'     then 110
    when 'drafts_approved'   then 120
    when 'revision'          then 130
    when 'signing_scheduled' then 140
    when 'signing'           then 150 -- legacy v1
    when 'signing_complete'  then 160
    when 'post_execution'    then 170
    when 'post_signing'      then 180 -- legacy v1
    when 'funding'           then 190
    when 'closed'            then 200
  end
$$;

comment on function public.pipeline_stage_rank(text) is
  'Ordinal of a lead or matter stage in the unified pipeline order. Null for an unrecognised stage.';

-- ── stage_entered_at stops overwriting a deliberate value ───────────────────
--
-- The original stamped now() on every stage change, which quietly discarded the
-- date its own caller had just supplied: `ensure_lead_matter` has always set
-- `stage_entered_at` from the lead timestamp that produced the stage, and has
-- always had it replaced by the wall clock. A statement that moves the stage and
-- says nothing about `stage_entered_at` still gets now(); one that sets both is
-- now taken at its word.

create or replace function public.trg_matters_stage_entered_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
  elsif new.stage is distinct from old.stage
    and new.stage_entered_at is not distinct from old.stage_entered_at then
    new.stage_entered_at := now();
  end if;
  return new;
end;
$$;

-- ── A recorded PMPS moves the lead to Planning Session ──────────────────────

create or replace function public.stamp_lead_pmps_stage()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_rank integer;
begin
  if new.pmps_at is null or new.pmps_at is not distinct from old.pmps_at then
    return new;
  end if;

  -- `stage` on a hired matter is the work axis — where the drafting stands.
  -- A pre-engagement date has no business dragging it backwards, and a v1
  -- matter that books a PMPS is handled by the appointment automation instead.
  if new.relationship_status = 'hired' then
    return new;
  end if;

  -- Forward-only: a lead that has already had recommendations sent keeps the
  -- further stage, and rescheduling the session does not replay the move.
  v_rank := public.pipeline_stage_rank(new.stage);
  if v_rank is not null and v_rank >= public.pipeline_stage_rank('intake_completed') then
    return new;
  end if;

  new.stage := 'intake_completed';
  -- The session date, not now(). The stage clock measures how long the firm has
  -- been sitting in Planning Session; a lead booking three weeks out is not
  -- three weeks overdue on the day they book.
  new.stage_entered_at := new.pmps_at;

  insert into public.matter_activity (matter_id, event_type, title, detail, metadata)
  values (
    new.id::text,
    'stage_changed',
    'Stage changed to Planning Session',
    'Peace of Mind Planning Session scheduled',
    jsonb_build_object(
      'to', 'intake_completed',
      'trigger', 'pmps_scheduled',
      'pmps_at', new.pmps_at
    )
  );

  return new;
end;
$$;

revoke execute on function public.stamp_lead_pmps_stage() from public, anon, authenticated;

drop trigger if exists stamp_lead_pmps_stage on public.matters;
create trigger stamp_lead_pmps_stage
before update of pmps_at on public.matters
for each row execute function public.stamp_lead_pmps_stage();

-- ── The lead-timestamp derivation stops undoing it ──────────────────────────
--
-- `ensure_lead_matter` recomputes a lead's stage from its `client_intake`
-- timestamps whenever one of them changes. Re-sending the organizer after the
-- session is booked would otherwise drop the matter from Planning Session back
-- to Organizer Sent, because none of those timestamps know the PMPS happened.
-- Flooring at the recorded `pmps_at` keeps the two derivations agreeing.
--
-- Only the stage derivation changes; the body is otherwise the 20260824000000
-- version.

create or replace function public.ensure_lead_matter()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_matter_id uuid;
  v_pmps_at timestamptz;
  v_relationship_status text;
  v_stage text;
  v_stage_entered_at timestamptz;
begin
  if new.lead_status is null then
    return new;
  end if;

  select m.id, m.pmps_at into v_matter_id, v_pmps_at
  from public.matters m
  where m.client_intake_id = new.id
  order by (m.id = new.matter_id) desc, m.created_at desc
  limit 1;

  v_relationship_status := case
    when new.lead_status = 'lost' then 'lost'
    when new.lead_status = 'declined' then 'declined'
    else 'lead'
  end;
  v_stage := case
    when new.engagement_sent_at is not null then 'engagement_sent'
    when new.intake_completed_at is not null then 'intake_completed'
    when new.intake_sent_at is not null then 'intake_sent'
    else 'new_lead'
  end;
  v_stage_entered_at := coalesce(new.engagement_sent_at, new.intake_completed_at, new.intake_sent_at, new.created_at, now());

  -- A booked planning session is a floor, not a ceiling: `engagement_sent` still
  -- wins, because that is further along.
  if v_pmps_at is not null
     and public.pipeline_stage_rank(v_stage) < public.pipeline_stage_rank('intake_completed') then
    v_stage := 'intake_completed';
    v_stage_entered_at := v_pmps_at;
  end if;

  if v_matter_id is null then
    insert into public.matters (
      client_intake_id, client_id, name, matter_number, stage, status,
      stage_entered_at, track, relationship_status, lost_at, declined_at
    ) values (
      new.id, null,
      coalesce(nullif(trim(new.full_name), ''), nullif(trim(concat_ws(' ', new.first_name, new.last_name)), ''), new.email, 'Prospective client'),
      null, v_stage, 'active', v_stage_entered_at, 'DEFAULT',
      v_relationship_status,
      case when v_relationship_status = 'lost' then now() else null end,
      case when v_relationship_status = 'declined' then now() else null end
    ) returning id into v_matter_id;

    insert into public.matter_details (
      client_id, practice_area, plan_type, jurisdiction_state, jurisdiction_county,
      flat_fee_amount, est_estate_value, referral_source, urgency, matter_status_notes
    ) values (
      v_matter_id, new.practice_area, 'TBD', coalesce(nullif(new.state, ''), 'MA'),
      nullif(new.county, ''), new.engagement_fee_quoted, new.taxable_estate,
      nullif(new.lead_source, ''), new.lead_urgency, nullif(new.qualification_notes, '')
    ) on conflict (client_id) do nothing;

    update public.client_intake set matter_id = v_matter_id where id = new.id;
  elsif new.lead_status in ('lead', 'lost', 'declined') then
    update public.matters
    set relationship_status = v_relationship_status,
        stage = case when relationship_status = 'hired' then stage else v_stage end,
        stage_entered_at = case when relationship_status = 'hired' then stage_entered_at else v_stage_entered_at end,
        updated_at = now()
    where id = v_matter_id and relationship_status <> 'hired';

    if new.matter_id is distinct from v_matter_id then
      update public.client_intake set matter_id = v_matter_id where id = new.id;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.ensure_lead_matter() from public, anon, authenticated;

-- ── matter_activity accepts the key-dates event ─────────────────────────────
--
-- The key-dates panel has logged `sla_anchor_set` since 20260824; the check
-- constraint has rejected it since 20260712, and the route never checked the
-- insert's error, so the whole audit trail for anchor edits has been silently
-- discarded. Adding the value is what the route always assumed.

alter table public.matter_activity
  drop constraint if exists matter_activity_event_type_check;

alter table public.matter_activity
  add constraint matter_activity_event_type_check check (
    event_type in (
      'stage_changed', 'note_added', 'document_uploaded', 'document_viewed',
      'document_downloaded', 'task_created', 'task_completed', 'flag_added', 'flag_removed',
      'alert_created', 'alert_resolved', 'intake_sent', 'intake_completed',
      'email_sent', 'sms_sent', 'sms_received', 'draft_generated', 'draft_promoted_to_review',
      'matter_created', 'matter_archived', 'status_changed', 'sla_anchor_set'
    )
  );

-- ── Backfill: sessions already on the calendar ──────────────────────────────
--
-- Every PMPS booked before this change wrote `matter_details.design_meeting_date`
-- and nothing else, so its matter has no anchor and its eleven pmps-relative
-- tasks are undated. Take the date from the appointment itself. The trigger
-- above fires on this update, so the stages follow.

with booked as (
  select distinct on (m.id) m.id as matter_id, a.start_time
  from public.appointments a
  join public.appointment_types t
    on t.id = a.appointment_type_id and t.key = 'pmps'
  join public.matters m
    on m.id = a.linked_matter_id
    or m.client_intake_id = a.linked_lead_id
  where a.status = 'scheduled'
  order by m.id, a.start_time desc
)
update public.matters m
set pmps_at = booked.start_time
from booked
where m.id = booked.matter_id
  and m.pmps_at is null;

-- Date the tasks that were waiting on the anchor. Mirrors `rescheduleForAnchor`
-- in lib/slaTasks/schedule.ts: recomputed from the stored offsets against the
-- session's calendar day in the firm's timezone, open tasks only, so a completed
-- task keeps the date it was actually done against.

update public.matter_tasks t
set due_date = case
      when t.due_offset_days is null then null
      else (m.pmps_at at time zone 'America/New_York')::date + t.due_offset_days
    end,
    nudge_date = case
      when t.nudge_offset_days is null then null
      else (m.pmps_at at time zone 'America/New_York')::date + t.nudge_offset_days
    end,
    escalation_date = case
      when t.escalation_offset_days is null then null
      else (m.pmps_at at time zone 'America/New_York')::date + t.escalation_offset_days
    end
from public.matters m
where m.id = t.matter_id
  and t.relative_to = 'pmps'
  and m.pmps_at is not null
  and t.status in ('pending', 'active', 'blocked');

notify pgrst, 'reload schema';
