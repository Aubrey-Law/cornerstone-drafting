-- Drop the marketing consent columns from `cornerstone_crm_people`.
--
-- The campaign machinery went first (Mailgun, the cron dispatch, the settings
-- page, the unsubscribe route). The consent record was kept behind it as a
-- compliance record, and then the last thing reading it — the Marketing card on
-- the People flyout, the lead record, the matter Communications tab and the
-- matter facts rail — went too, along with `lib/crm/consent.ts` and the CRM
-- profiles route that wrote these columns. Nothing in the application has read
-- or written any of them since.
--
-- THIS DESTROYS RECORDED CONSENT. Every opt-in, its source, who captured it and
-- when, every opt-out and its timestamp: gone, not recoverable from the
-- application. Asked for explicitly, with that said first. If marketing is ever
-- rebuilt, consent starts from nothing and has to be collected again — which is
-- the correct outcome anyway for permission this old.
--
-- `cornerstone_crm_campaign_recipients.snapshot_marketing_status` is deliberately
-- untouched. It is an enrollment-time snapshot on the campaign tables, which are
-- themselves dead but are a separate decision from this one, and
-- `enforce_crm_recipient_snapshot_immutable` names it — rewriting that trigger
-- to drop a column nobody asked about is not this migration's business.

-- ── 1. The read model ───────────────────────────────────────────────────────
-- `v_cornerstone_crm_people` selects four of them. It has no reader —
-- `lib/queries/cornerstoneCrm.ts` reads the base table — but the view must stop
-- selecting them before they can be dropped.
--
-- Dropped and recreated rather than `create or replace`d: replacing a view can
-- only append columns, never remove them. Same reasoning, and the same
-- definition minus the four, as 20261013000000.

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

-- ── 2. The indexes ──────────────────────────────────────────────────────────
-- Both would be dropped with their columns. Named here so the schema history
-- says they went on purpose rather than as collateral.

drop index if exists public.cornerstone_crm_people_marketing_status_idx;
drop index if exists public.cornerstone_crm_people_consent_actor_idx;

-- ── 3. The columns ──────────────────────────────────────────────────────────
-- The `marketing_status` and `marketing_segment` CHECK constraints and the
-- `consent_captured_by` foreign key go with them, being constraints involving a
-- dropped column.
--
-- No trigger function names any of these: `sync_crm_person_from_intake` and
-- `sync_crm_person_from_contact` list only identity, contact and stage columns
-- (20261013000000), and `enforce_crm_recipient_snapshot_immutable` reads the
-- recipients table. Checked deliberately — plpgsql resolves columns at
-- execution, so a function naming one would not fail this migration; it would
-- fail every write from the moment it applied.

alter table public.cornerstone_crm_people
  drop column if exists marketing_status,
  drop column if exists marketing_segment,
  drop column if exists topic_preferences,
  drop column if exists preferred_frequency,
  drop column if exists consent_source,
  drop column if exists consent_captured_at,
  drop column if exists consent_captured_by,
  drop column if exists unsubscribed_at,
  drop column if exists campaign_opt_out;

notify pgrst, 'reload schema';
