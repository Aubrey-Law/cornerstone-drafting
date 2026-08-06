-- One list for leads and matters.
--
-- `v_matter_pipeline` stays exactly as it was. Twenty-odd callers read it —
-- document security, the phone and email directories, scheduling, the nudge
-- cron — and every one of them means "a hired matter" by it. Widening it in
-- place would quietly change all of them at once, so the consolidated list gets
-- its own view instead, and the two can diverge deliberately.
--
-- Adds `relationship_status`, so the matters list can badge and filter by
-- lifecycle, and `matter_number`, which the list previously fetched in a second
-- round trip.

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
  nullif(concat_ws(', ', nullif(trim(concat_ws(' ', ci.address_line1, ci.address_line2)), ''), nullif(ci.city, ''), nullif(trim(concat_ws(' ', ci.state, ci.zip)), '')), '') as spouse_address,
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
left join public.design_sheets ds on ds.matter_id = m.id
left join public.matter_details md on md.client_id = m.id
where m.status <> 'archived';

grant select on public.v_matter_pipeline_all to authenticated, service_role;

notify pgrst, 'reload schema';
