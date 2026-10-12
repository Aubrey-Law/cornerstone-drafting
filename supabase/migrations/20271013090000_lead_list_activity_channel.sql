-- The list row names the channel of the latest touch when one was recorded.
-- event_type stays on lead_activity; this only surfaces it beside last_activity_at.

create or replace view public.v_lead_list
with (security_invoker = true)
as
with latest_activity as (
  select distinct on (lead_id)
    lead_id,
    created_at as last_activity_at,
    event_type as last_activity_type
  from public.lead_activity
  order by lead_id, created_at desc
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
  la.last_activity_type,
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
