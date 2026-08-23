-- Rank and page the leads list in the database.
--
-- `app/admin/leads/page.tsx` loads at most 200 leads and 2,000 activity rows
-- and then filters, searches, sorts and scores them in the browser. At today's
-- volume (56 lead rows) that is correct and invisible; past the bound it ranks
-- a subset while still reading as the whole pipeline, which is the failure
-- mode docs/architecture-review-leads-crm.md §6 names. Ranking has to move to
-- where the whole set is before the list can page.
--
-- The obstacle is the lead score. It is computed in TypeScript
-- (`lib/leads/score.ts`) from values on the row, so ordering by it needs the
-- whole set in memory — exactly what paging removes. This mirrors the total
-- into SQL so the server can order by it, and `tests/lead-score-sql-parity.test.ts`
-- holds the two definitions together the way `tests/stage-engine-keys.test.ts`
-- does for the engine keys.
--
-- Two deliberate differences from the TypeScript, both because a list row
-- carries less than a detail record:
--
--   * Readiness contributes 0. `leadScoreInputFromRow()` passes no readiness
--     percent for a list row, and `readinessComponent()` scores a missing
--     percent at 0 — so the list's TypeScript score already omits it. The SQL
--     omits the same 5 points, and the detail page keeps computing the richer
--     score for its own breakdown.
--   * Only the total is computed, not the per-component reasons. The list
--     orders by the number; the reasons are rendered from the TypeScript score
--     on whichever rows came back.
--
-- Days are calendar days in the firm's timezone, the same unit
-- `calendarDayDifference(…, FIRM_TIMEZONE)` uses, so a touch "3 days ago"
-- crosses the boundary at the same moment on both sides.

-- ── The meeting a score should reflect ──────────────────────────────────────
--
-- Mirrors `scoringAppointmentAt()`: the soonest meeting still ahead, else the
-- most recent one already held. Scoring credits a booked call more than a past
-- one, so which anchor wins changes the number.
create or replace function public.lead_scoring_appointment_at(
  p_discovery_call_at timestamptz,
  p_pmps_at timestamptz
)
returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select min(anchor)
      from unnest(array[p_discovery_call_at, p_pmps_at]) as anchor
      where anchor is not null and anchor >= now()
    ),
    (
      select max(anchor)
      from unnest(array[p_discovery_call_at, p_pmps_at]) as anchor
      where anchor is not null
    )
  )
$$;

comment on function public.lead_scoring_appointment_at(timestamptz, timestamptz) is
  'Mirrors scoringAppointmentAt() in lib/leads/score.ts: soonest upcoming anchor, else latest past one.';

-- ── The score ───────────────────────────────────────────────────────────────
--
-- Component ceilings: progress 20, fee 15, estate 15, urgency 10, recency 15,
-- appointment 10, source 10, readiness 5 — 100 in total, of which this
-- computes 95 (see the readiness note above).
create or replace function public.lead_score(
  p_intake_sent_at timestamptz,
  p_intake_completed_at timestamptz,
  p_intake_status text,
  p_engagement_status text,
  p_engagement_sent_at timestamptz,
  p_engagement_signed_at timestamptz,
  p_fee_quoted numeric,
  p_billing_type text,
  p_taxable_estate numeric,
  p_has_minor_children boolean,
  p_urgency text,
  p_lead_source text,
  p_last_touch_at timestamptz,
  p_next_appointment_at timestamptz
)
returns int
language sql
stable
set search_path = pg_catalog, public
as $$
  with tz as (
    select 'America/New_York'::text as zone
  ), day_math as (
    select
      case
        when p_last_touch_at is null then null
        else (timezone(tz.zone, now()))::date - (timezone(tz.zone, p_last_touch_at))::date
      end as touch_days,
      case
        when p_next_appointment_at is null then null
        else (timezone(tz.zone, p_next_appointment_at))::date - (timezone(tz.zone, now()))::date
      end as meeting_days
    from tz
  ), parts as (
    select
      -- Pipeline progress (20)
      case
        when p_engagement_signed_at is not null or lower(trim(coalesce(p_engagement_status, ''))) = 'signed' then 20
        when p_engagement_sent_at is not null or lower(trim(coalesce(p_engagement_status, ''))) = 'sent' then 16
        when p_intake_completed_at is not null or lower(trim(coalesce(p_intake_status, ''))) = 'completed' then 12
        when p_intake_sent_at is not null then 6
        else 0
      end as progress,
      -- Revenue signal (15)
      case
        when p_fee_quoted is not null and p_fee_quoted > 0 then
          case
            when p_fee_quoted >= 5000 then 15
            when p_fee_quoted >= 3000 then 12
            when p_fee_quoted >= 1500 then 8
            else 5
          end
        when lower(trim(coalesce(p_billing_type, ''))) in
          ('metlife', 'legalease', 'arag', 'hyatt', 'legalshield', 'other_legal_plan') then 7
        else 0
      end as fee,
      -- Estate complexity (15), with a 2-point bump for minor children
      least(15, case
        when p_taxable_estate is not null and p_taxable_estate > 0 then
          (case
            when p_taxable_estate >= 2000000 then 15
            when p_taxable_estate >= 1000000 then 10
            else 5
          end) + (case when p_has_minor_children is true then 2 else 0 end)
        when p_has_minor_children is true then 2
        else 0
      end) as estate,
      -- Urgency (10). Unset scores 4: absent is not the same as low.
      case lower(trim(coalesce(p_urgency, '')))
        when 'high' then 10
        when 'normal' then 5
        when 'low' then 0
        else 4
      end as urgency,
      -- Recent contact (15)
      case
        when d.touch_days is null then 0
        when d.touch_days <= 3 then 15
        when d.touch_days <= 7 then 11
        when d.touch_days <= 14 then 6
        when d.touch_days <= 30 then 2
        else 0
      end as recency,
      -- Meeting (10): booked outranks held.
      case
        when d.meeting_days is null then 0
        when d.meeting_days >= 0 then 10
        else 5
      end as appointment,
      -- Lead source (10). Unrecorded scores 2, an unrecognised source 4.
      case
        when coalesce(trim(p_lead_source), '') = '' then 2
        when lower(p_lead_source) like '%referral%' then 10
        when lower(p_lead_source) like any (array[
          '%metlife%', '%legalease%', '%arag%', '%hyatt%', '%legalshield%', '%other_legal_plan%'
        ]) then 8
        when lower(p_lead_source) like any (array['%website%', '%web%', '%google%']) then 5
        else 4
      end as source
    from day_math d
  )
  select least(100, greatest(0,
    parts.progress + parts.fee + parts.estate + parts.urgency
      + parts.recency + parts.appointment + parts.source
  ))::int
  from parts
$$;

comment on function public.lead_score(
  timestamptz, timestamptz, text, text, timestamptz, timestamptz, numeric, text,
  numeric, boolean, text, text, timestamptz, timestamptz
) is
  'Mirrors computeLeadScore() in lib/leads/score.ts for a list row, where readiness is '
  'always absent and therefore scores 0. tests/lead-score-sql-parity.test.ts holds the two together.';

-- ── The list ────────────────────────────────────────────────────────────────
--
-- One row per lead the list shows, carrying everything the server now filters,
-- searches, sorts and pages by. The shape is what `app/admin/leads/page.tsx`
-- assembled by hand: the intake row, the lifecycle its matter owns, the latest
-- activity timestamp, the meeting anchors, and the score.
--
-- `security_invoker` so the view carries no privileges of its own; the admin
-- client already runs as the service role.
create or replace view public.v_lead_list
with (security_invoker = true)
as
with latest_activity as (
  select lead_id, max(created_at) as last_activity_at
  from public.lead_activity
  group by lead_id
)
select
  ci.id,
  ci.full_name,
  ci.first_name,
  ci.middle_name,
  ci.last_name,
  ci.preferred_name,
  ci.email,
  ci.phone,
  ci.date_of_birth,
  ci.address_line1,
  ci.address_line2,
  ci.city,
  ci.state,
  ci.zip,
  ci.county,
  ci.marital_status,
  ci.qualification_notes,
  ci.has_minor_children,
  ci.lead_source,
  ci.practice_area,
  ci.status,
  -- The matter owns lifecycle once one exists; the intake's own column is the
  -- fallback for a lead that has not reached one.
  coalesce(m.relationship_status, ci.lead_status) as lead_status,
  ci.matter_id,
  ci.intake_sent_at,
  ci.intake_completed_at,
  ci.engagement_status,
  ci.engagement_sent_at,
  ci.engagement_signed_at,
  ci.engagement_fee_quoted,
  ci.billing_type,
  ci.lead_urgency,
  ci.taxable_estate,
  ci.lead_next_action_snoozed_until,
  ci.user_id,
  ci.client_user_id,
  ci.created_at,
  ci.updated_at,
  la.last_activity_at,
  public.lead_scoring_appointment_at(m.discovery_call_at, m.pmps_at) as next_appointment_at,
  -- Ordering by name has to agree with leadDisplayName(): full name, else the
  -- first and last together, else the email.
  nullif(trim(coalesce(
    nullif(trim(coalesce(ci.full_name, '')), ''),
    nullif(trim(concat_ws(' ', ci.first_name, ci.last_name)), ''),
    ci.email,
    ''
  )), '') as display_name,
  public.lead_score(
    ci.intake_sent_at,
    ci.intake_completed_at,
    ci.status,
    ci.engagement_status,
    ci.engagement_sent_at,
    ci.engagement_signed_at,
    ci.engagement_fee_quoted,
    ci.billing_type,
    ci.taxable_estate,
    ci.has_minor_children,
    ci.lead_urgency,
    ci.lead_source,
    -- leadScoreInputFromRow() falls back to updated_at when a lead has no
    -- recorded activity, so a lead touched only through its own record still
    -- reads as touched.
    coalesce(la.last_activity_at, ci.updated_at),
    public.lead_scoring_appointment_at(m.discovery_call_at, m.pmps_at)
  ) as score,
  -- The insight cards count these across the whole pipeline. Computing them
  -- here means the cards report a total rather than whatever the page held.
  (coalesce(m.relationship_status, ci.lead_status) = 'lead') as is_open,
  -- Coalesced because these are filtered on, and a three-valued `null` is
  -- neither true nor false to PostgREST: `eq.false` would silently drop every
  -- lead whose urgency or status happens to be unset, which is most of them.
  coalesce(
    ci.lead_urgency = 'high'
    or coalesce(la.last_activity_at, ci.updated_at, ci.created_at) is null
    or coalesce(la.last_activity_at, ci.updated_at, ci.created_at) < now() - interval '7 days',
    false
  ) as needs_attention,
  (ci.engagement_sent_at is not null and ci.engagement_signed_at is null) as has_pending_agreement,
  (ci.intake_completed_at is null) as awaiting_intake,
  -- The progress filter's two compound states, resolved here rather than
  -- assembled out of `or` terms by the caller. Both read a status column that
  -- is often null, and in PostgREST a `neq` drops nulls — so expressed as
  -- filters they would quietly exclude the leads they are meant to return.
  coalesce(ci.intake_completed_at is not null or ci.status = 'completed', false) as intake_complete,
  (ci.engagement_sent_at is not null
    and coalesce(ci.engagement_status, '') <> 'signed') as engagement_pending
from public.client_intake ci
left join public.matters m on m.id = ci.matter_id
left join latest_activity la on la.lead_id = ci.id
where ci.lead_status is not null
  -- An archived matter takes its lead off the list, as the page did.
  and coalesce(m.status, '') <> 'archived'
  -- A hired opportunity leaves for its matter; lost and declined stay, because
  -- a lead nobody can see is also one nobody can review or reopen.
  and coalesce(m.relationship_status, ci.lead_status) in ('lead', 'lost', 'declined');

comment on view public.v_lead_list is
  'The leads list, ranked and filterable in the database so the page can page. '
  'Mirrors what app/admin/leads/page.tsx assembled in memory before 20261014000000.';

notify pgrst, 'reload schema';
