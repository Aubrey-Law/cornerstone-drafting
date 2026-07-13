-- Keep shared lead/matter data canonical and include open leads in pipeline aging.

alter table public.matter_details
  add column if not exists urgency text;

alter table public.matter_details
  drop constraint if exists matter_details_urgency_check,
  add constraint matter_details_urgency_check
    check (urgency is null or urgency in ('low', 'normal', 'high'));

update public.client_intake
set practice_area = case
  when trim(practice_area) in ('EP-LP', 'Estate Planning (LP)', 'Estate Planning | LP', 'Estate Planning - LP', 'Estate Planning-LP') then 'EP-LP'
  when upper(trim(practice_area)) = 'PROBATE' or trim(practice_area) = 'Probate (LP)' then 'Probate'
  else 'EP'
end
where practice_area is not null;

update public.matter_details
set practice_area = case
  when trim(practice_area) in ('EP-LP', 'Estate Planning (LP)', 'Estate Planning | LP', 'Estate Planning - LP', 'Estate Planning-LP') then 'EP-LP'
  when upper(trim(practice_area)) = 'PROBATE' or trim(practice_area) = 'Probate (LP)' then 'Probate'
  else 'EP'
end
where practice_area is not null;

create or replace function public.normalize_shared_practice_area()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.practice_area is null or trim(new.practice_area) = '' then
    new.practice_area := null;
  elsif trim(new.practice_area) in ('EP-LP', 'Estate Planning (LP)', 'Estate Planning | LP', 'Estate Planning - LP', 'Estate Planning-LP') then
    new.practice_area := 'EP-LP';
  elsif upper(trim(new.practice_area)) = 'PROBATE' or trim(new.practice_area) = 'Probate (LP)' then
    new.practice_area := 'Probate';
  elsif upper(trim(new.practice_area)) = 'EP' or trim(new.practice_area) = 'Estate Planning' then
    new.practice_area := 'EP';
  else
    raise exception 'Invalid practice area: %', new.practice_area using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_client_intake_practice_area on public.client_intake;
create trigger normalize_client_intake_practice_area
  before insert or update of practice_area on public.client_intake
  for each row execute function public.normalize_shared_practice_area();

drop trigger if exists normalize_matter_details_practice_area on public.matter_details;
create trigger normalize_matter_details_practice_area
  before insert or update of practice_area on public.matter_details
  for each row execute function public.normalize_shared_practice_area();

alter table public.stage_sla drop constraint if exists stage_sla_entity_check;
alter table public.stage_sla
  add constraint stage_sla_entity_check check (entity in ('matter', 'lead'));

alter table public.pipeline_aging_snooze
  drop constraint if exists pipeline_aging_snooze_entity_check;
alter table public.pipeline_aging_snooze
  add constraint pipeline_aging_snooze_entity_check check (entity in ('matter', 'lead'));

insert into public.stage_sla
  (stage_key, track, entity, owner, sla_days, escalation_offset, stage_order)
values
  ('new_lead', 'DEFAULT', 'lead', 'attorney', 1, 1, 1),
  ('intake_sent', 'DEFAULT', 'lead', 'client', 5, 4, 2),
  ('intake_completed', 'DEFAULT', 'lead', 'attorney', 2, 1, 3),
  ('engagement_sent', 'DEFAULT', 'lead', 'client', 5, 4, 4)
on conflict (stage_key, track) do update set
  entity = excluded.entity,
  owner = excluded.owner,
  sla_days = excluded.sla_days,
  escalation_offset = excluded.escalation_offset,
  stage_order = excluded.stage_order;

create or replace view public.v_pipeline_aging as
with lead_stage as (
  select
    ci.*,
    case
      when ci.engagement_sent_at is not null then 'engagement_sent'
      when ci.intake_completed_at is not null then 'intake_completed'
      when ci.intake_sent_at is not null then 'intake_sent'
      else 'new_lead'
    end as current_stage,
    case
      when ci.engagement_sent_at is not null then ci.engagement_sent_at
      when ci.intake_completed_at is not null then ci.intake_completed_at
      when ci.intake_sent_at is not null then ci.intake_sent_at
      else coalesce(ci.created_at, ci.updated_at, now())
    end as stage_entered_at
  from public.client_intake ci
  where ci.lead_status = 'lead' and ci.matter_id is null
), lead_base as (
  select
    'lead'::text as entity,
    l.id::text as id,
    coalesce(nullif(trim(l.full_name), ''), nullif(trim(concat_ws(' ', l.first_name, l.last_name)), ''), l.email) as client_name,
    l.email as client_email,
    l.phone as client_phone,
    'DEFAULT'::text as track,
    l.current_stage,
    s.stage_order,
    s.owner,
    l.stage_entered_at,
    public.business_days_elapsed(l.stage_entered_at) as days_in_stage,
    s.sla_days,
    s.escalation_offset,
    (s.sla_days is not null and public.business_days_elapsed(l.stage_entered_at) > s.sla_days) as is_overdue,
    (s.escalation_offset is not null and public.business_days_elapsed(l.stage_entered_at) >= s.escalation_offset) as needs_outreach,
    case
      when s.sla_days is null then 'green'
      when public.business_days_elapsed(l.stage_entered_at) > s.sla_days then 'red'
      when s.escalation_offset is not null and public.business_days_elapsed(l.stage_entered_at) >= s.escalation_offset then 'red'
      when public.business_days_elapsed(l.stage_entered_at) >= (s.sla_days - 1) then 'amber'
      else 'green'
    end as raw_health,
    case when s.sla_days is null then null
      else public.business_days_elapsed(l.stage_entered_at) - s.sla_days
    end as days_over_sla
  from lead_stage l
  join public.stage_sla s
    on s.stage_key = l.current_stage and s.track = 'DEFAULT' and s.entity = 'lead'
), lead_aging as (
  select
    b.entity, b.id, b.client_name, b.client_email, b.client_phone, b.track,
    b.current_stage, b.stage_order, b.owner, b.stage_entered_at, b.days_in_stage,
    b.sla_days, b.escalation_offset,
    case when sn.id is not null then false else b.is_overdue end as is_overdue,
    case when sn.id is not null then false else b.needs_outreach end as needs_outreach,
    case when sn.id is not null then 'green'::text else b.raw_health end as health,
    b.raw_health, b.days_over_sla, sn.id as snooze_id, sn.snoozed_until,
    sn.reason as snooze_reason, (sn.id is not null) as is_snoozed
  from lead_base b
  left join public.pipeline_aging_snooze sn
    on sn.entity = 'lead' and sn.entity_id = b.id and sn.stage_key = b.current_stage
   and sn.snoozed_until > now()
)
select * from public.v_matter_aging
union all
select * from lead_aging;

alter view public.v_pipeline_aging set (security_invoker = true);
grant select on public.v_pipeline_aging to service_role;
grant select on public.v_pipeline_aging to authenticated;

create or replace function public.convert_lead_to_matter(
  p_lead_id uuid,
  p_matter_number text,
  p_matter_name text,
  p_practice_area text,
  p_client_id uuid,
  p_fee numeric,
  p_engagement_provider text,
  p_engagement_envelope_id text,
  p_engagement_status text,
  p_engagement_sent_at timestamptz,
  p_engagement_signed_at timestamptz,
  p_engagement_signed boolean
) returns table (matter_id uuid, matter_number text, created boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lead public.client_intake;
  v_matter public.matters;
  v_created boolean := false;
  v_practice_area text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select * into v_lead from public.client_intake where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;

  v_practice_area := case
    when trim(p_practice_area) in ('EP-LP', 'Estate Planning (LP)', 'Estate Planning | LP', 'Estate Planning - LP', 'Estate Planning-LP') then 'EP-LP'
    when upper(trim(p_practice_area)) = 'PROBATE' or trim(p_practice_area) = 'Probate (LP)' then 'Probate'
    else 'EP'
  end;

  select * into v_matter
  from public.matters
  where client_intake_id = p_lead_id or id = v_lead.matter_id
  order by (id = v_lead.matter_id) desc
  limit 1;

  if not found then
    insert into public.matters (
      client_intake_id, client_id, name, matter_number, stage, status,
      stage_entered_at, track
    ) values (
      p_lead_id, p_client_id, p_matter_name, p_matter_number, 'intake', 'active',
      now(), 'DEFAULT'
    ) returning * into v_matter;
    v_created := true;
  end if;

  insert into public.matter_details (
    client_id, practice_area, plan_type, matter_status, client_status,
    jurisdiction_state, jurisdiction_county, matter_number, flat_fee_amount,
    est_estate_value, referral_source, urgency, matter_status_notes,
    engagement_provider, engagement_envelope_id, engagement_status,
    engagement_sent_at, engagement_signed_at, engagement_signed
  ) values (
    v_matter.id, v_practice_area, 'TBD', 'Active', 'active',
    coalesce(nullif(v_lead.state, ''), 'MA'), nullif(v_lead.county, ''),
    v_matter.matter_number, p_fee, v_lead.taxable_estate,
    nullif(v_lead.lead_source, ''), v_lead.lead_urgency,
    nullif(v_lead.qualification_notes, ''), p_engagement_provider,
    p_engagement_envelope_id, p_engagement_status, p_engagement_sent_at,
    p_engagement_signed_at, p_engagement_signed
  ) on conflict (client_id) do update set
    practice_area = excluded.practice_area,
    jurisdiction_state = excluded.jurisdiction_state,
    jurisdiction_county = excluded.jurisdiction_county,
    matter_number = excluded.matter_number,
    flat_fee_amount = excluded.flat_fee_amount,
    est_estate_value = excluded.est_estate_value,
    referral_source = excluded.referral_source,
    urgency = excluded.urgency,
    matter_status_notes = excluded.matter_status_notes,
    engagement_provider = excluded.engagement_provider,
    engagement_envelope_id = excluded.engagement_envelope_id,
    engagement_status = excluded.engagement_status,
    engagement_sent_at = excluded.engagement_sent_at,
    engagement_signed_at = excluded.engagement_signed_at,
    engagement_signed = excluded.engagement_signed,
    updated_at = now();

  update public.client_intake
  set practice_area = v_practice_area, matter_id = v_matter.id,
      lead_status = 'hired', updated_at = now()
  where id = p_lead_id;

  return query select v_matter.id, v_matter.matter_number, v_created;
end;
$$;

revoke execute on function public.convert_lead_to_matter(uuid, text, text, text, uuid, numeric, text, text, text, timestamptz, timestamptz, boolean) from public;
revoke execute on function public.convert_lead_to_matter(uuid, text, text, text, uuid, numeric, text, text, text, timestamptz, timestamptz, boolean) from anon;
revoke execute on function public.convert_lead_to_matter(uuid, text, text, text, uuid, numeric, text, text, text, timestamptz, timestamptz, boolean) from authenticated;
grant execute on function public.convert_lead_to_matter(uuid, text, text, text, uuid, numeric, text, text, text, timestamptz, timestamptz, boolean) to service_role;

notify pgrst, 'reload schema';
