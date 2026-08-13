-- Two field defects shared by both pipeline views (field review §7.3–7.4):
--
-- 1. `spouse_address` was built from `ci.*` — the client's address — while
--    every neighbouring spouse column read the spouse contact (`cs.*`). It now
--    reads the spouse contact's own address, falling back to the household
--    (client) address when the spouse contact has none recorded.
--
-- 2. The `design_sheets` join had no version predicate. The table is unique on
--    (matter_id, version), so a matter with a second design-sheet version
--    fanned out into duplicate rows — duplicating matters in every list and
--    making `.single()` reads fall into their fallback path. The join is now a
--    lateral picking the newest version, matching what the non-view code path
--    does (order by version desc limit 1).
--
-- Column lists, names, and order are unchanged, so `create or replace` is safe
-- for the twenty-odd existing callers.

create or replace view public.v_matter_pipeline
with (security_invoker = true)
as
select
  m.id as matter_id,
  m.name as matter_name,
  m.stage,
  m.status,
  m.flags,
  m.created_at as matter_created,
  trim(concat_ws(' ', ci.first_name, ci.last_name)) as client_name,
  ci.email as client_email,
  ci.phone as client_phone,
  ci.date_of_birth as client_dob,
  nullif(concat_ws(', ', nullif(trim(concat_ws(' ', ci.address_line1, ci.address_line2)), ''), nullif(ci.city, ''), nullif(trim(concat_ws(' ', ci.state, ci.zip)), '')), '') as client_address,
  nullif(trim(concat_ws(' ', cs.first_name, cs.last_name)), '') as spouse_name,
  cs.email as spouse_email,
  cs.phone as spouse_phone,
  cs.date_of_birth as spouse_dob,
  coalesce(
    nullif(concat_ws(', ', nullif(trim(concat_ws(' ', cs.address_line1, cs.address_line2)), ''), nullif(cs.city, ''), nullif(trim(concat_ws(' ', cs.state, cs.zip)), '')), ''),
    nullif(concat_ws(', ', nullif(trim(concat_ws(' ', ci.address_line1, ci.address_line2)), ''), nullif(ci.city, ''), nullif(trim(concat_ws(' ', ci.state, ci.zip)), '')), '')
  ) as spouse_address,
  ci.plan_type,
  ci.marital_status,
  ci.has_minor_children,
  ci.taxable_estate,
  ci.status as intake_status,
  ci.intake_sent_at,
  ds.status as design_status,
  m.intake_submitted_at,
  m.drafts_sent_at,
  m.signing_date,
  m.documents_executed_at,
  null::timestamptz as next_appointment,
  null::text as next_appointment_type,
  md.practice_area,
  md.referral_source,
  md.flat_fee_amount as fee_amount,
  md.open_date::timestamptz as opened_at,
  md.client_status
from public.matters m
join public.client_intake ci on ci.id = m.client_intake_id
left join public.contacts cs on cs.client_intake_id = ci.id and cs.relationship_type = 'spouse'
left join lateral (
  select inner_ds.status
  from public.design_sheets inner_ds
  where inner_ds.matter_id = m.id
  order by inner_ds.version desc
  limit 1
) ds on true
left join public.matter_details md on md.client_id = m.id
where m.status <> 'archived'
  and m.relationship_status = 'hired';

create or replace view public.v_matter_pipeline_all
with (security_invoker = true)
as
select
  m.id as matter_id,
  m.relationship_status,
  m.matter_number,
  m.name as matter_name,
  m.stage,
  m.status,
  m.flags,
  m.created_at as matter_created,
  trim(concat_ws(' ', ci.first_name, ci.last_name)) as client_name,
  ci.email as client_email,
  ci.phone as client_phone,
  ci.date_of_birth as client_dob,
  nullif(concat_ws(', ', nullif(trim(concat_ws(' ', ci.address_line1, ci.address_line2)), ''), nullif(ci.city, ''), nullif(trim(concat_ws(' ', ci.state, ci.zip)), '')), '') as client_address,
  nullif(trim(concat_ws(' ', cs.first_name, cs.last_name)), '') as spouse_name,
  cs.email as spouse_email,
  cs.phone as spouse_phone,
  cs.date_of_birth as spouse_dob,
  coalesce(
    nullif(concat_ws(', ', nullif(trim(concat_ws(' ', cs.address_line1, cs.address_line2)), ''), nullif(cs.city, ''), nullif(trim(concat_ws(' ', cs.state, cs.zip)), '')), ''),
    nullif(concat_ws(', ', nullif(trim(concat_ws(' ', ci.address_line1, ci.address_line2)), ''), nullif(ci.city, ''), nullif(trim(concat_ws(' ', ci.state, ci.zip)), '')), '')
  ) as spouse_address,
  ci.plan_type,
  ci.marital_status,
  ci.has_minor_children,
  ci.taxable_estate,
  ci.status as intake_status,
  ci.intake_sent_at,
  ds.status as design_status,
  m.intake_submitted_at,
  m.drafts_sent_at,
  m.signing_date,
  m.documents_executed_at,
  null::timestamptz as next_appointment,
  null::text as next_appointment_type,
  md.practice_area,
  md.referral_source,
  md.flat_fee_amount as fee_amount,
  md.open_date::timestamptz as opened_at,
  md.client_status
from public.matters m
join public.client_intake ci on ci.id = m.client_intake_id
left join public.contacts cs on cs.client_intake_id = ci.id and cs.relationship_type = 'spouse'
left join lateral (
  select inner_ds.status
  from public.design_sheets inner_ds
  where inner_ds.matter_id = m.id
  order by inner_ds.version desc
  limit 1
) ds on true
left join public.matter_details md on md.client_id = m.id
where m.status <> 'archived';

grant select on public.v_matter_pipeline to authenticated, service_role;
grant select on public.v_matter_pipeline_all to authenticated, service_role;

notify pgrst, 'reload schema';
