-- Legal plan billing on a lead.
--
-- Plan work (Estate Planning - LP) arrives with the carrier, the member ID and
-- the plan's service window already known — usually on the first call, long
-- before anyone is hired. Until now those four answers had nowhere to live on a
-- lead: `matter_details` held them, but the lead RPCs never wrote them, so the
-- intake got re-keyed into the matter Billing tab after conversion.
--
-- The columns mirror `matter_details` by name so the fan-out below is a
-- straight copy, and so `convert_lead_to_matter` — which upserts every other
-- detail column but leaves these alone — carries them across untouched.

alter table public.client_intake
  add column if not exists billing_type text,
  add column if not exists legal_plan_member_id text,
  add column if not exists legal_plan_service_start date,
  add column if not exists legal_plan_service_end date;

alter table public.client_intake
  drop constraint if exists client_intake_billing_type_check;

alter table public.client_intake
  add constraint client_intake_billing_type_check
    check (billing_type is null or billing_type in (
      'flat_fee', 'metlife', 'legalease', 'arag', 'hyatt', 'legalshield', 'other_legal_plan'
    ));

-- The display name for a billing type, matching `legalPlanDisplayName` in
-- lib/billing/billingType.ts. `legal_plan` is a derived label on both tables,
-- never an independent answer — deriving it here keeps the two in step.
create or replace function public.legal_plan_display_name(p_billing_type text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case p_billing_type
    when 'metlife'          then 'MetLife'
    when 'legalease'        then 'LegalEASE'
    when 'arag'             then 'ARAG'
    when 'hyatt'            then 'Hyatt'
    when 'legalshield'      then 'LegalShield'
    when 'other_legal_plan' then 'Other legal plan'
    else null
  end;
$$;

-- ── update_lead_opportunity_field ────────────────────────────────────────────
-- Replaces 20260812000000. Adds the four plan fields and a second fan-out block
-- that syncs them to the lead's matter_details row.
create or replace function public.update_lead_opportunity_field(
  p_lead_id uuid,
  p_field text,
  p_value jsonb,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lead public.client_intake;
  v_matter public.matters;
  v_activity public.lead_activity;
  v_spouse jsonb;
  v_is_null boolean := p_value is null or p_value = 'null'::jsonb;
  v_text text := nullif(trim(p_value #>> '{}'), '');
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_actor_id is null or not exists (
    select 1 from public.users u
    where u.id = p_actor_id and u.role in ('attorney', 'admin')
  ) then
    raise exception 'Attorney or admin access required' using errcode = '42501';
  end if;
  if p_field is null or p_field not in (
    'firstName', 'middleName', 'lastName', 'preferredName', 'email', 'phone',
    'dateOfBirth', 'address', 'maritalStatus', 'practiceArea', 'source', 'fee',
    'urgency', 'estimatedEstateValue', 'hasMinorChildren', 'qualificationNotes',
    'spouse', 'legalPlan', 'legalPlanMemberId', 'legalPlanServiceStart',
    'legalPlanServiceEnd'
  ) then
    raise exception 'Invalid lead field' using errcode = '22023';
  end if;

  if p_field in ('firstName', 'lastName') and (
    v_is_null or jsonb_typeof(p_value) <> 'string' or v_text is null
  ) then
    raise exception 'Client first and last name are required' using errcode = '22023';
  end if;
  if p_field = 'email' and (
    v_is_null or jsonb_typeof(p_value) <> 'string' or v_text is null
    or v_text !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'Valid client email is required' using errcode = '22023';
  end if;
  if p_field in (
    'middleName', 'preferredName', 'phone', 'dateOfBirth', 'maritalStatus',
    'practiceArea', 'source', 'urgency', 'qualificationNotes', 'legalPlan',
    'legalPlanMemberId', 'legalPlanServiceStart', 'legalPlanServiceEnd'
  ) and not v_is_null and jsonb_typeof(p_value) <> 'string' then
    raise exception 'Lead detail field must be a string or null' using errcode = '22023';
  end if;
  if p_field = 'dateOfBirth' and v_text is not null then
    perform v_text::date;
  end if;
  if p_field = 'practiceArea' and v_text is not null
     and v_text not in ('EP', 'EP-LP', 'Probate') then
    raise exception 'Invalid practice area' using errcode = '22023';
  end if;
  if p_field = 'urgency' and v_text is not null
     and v_text not in ('low', 'normal', 'high') then
    raise exception 'Invalid urgency' using errcode = '22023';
  end if;
  if p_field = 'legalPlan' and v_text is not null and v_text not in (
    'flat_fee', 'metlife', 'legalease', 'arag', 'hyatt', 'legalshield', 'other_legal_plan'
  ) then
    raise exception 'Invalid legal plan' using errcode = '22023';
  end if;
  if p_field in ('legalPlanServiceStart', 'legalPlanServiceEnd') and v_text is not null then
    perform v_text::date;
  end if;
  if p_field in ('fee', 'estimatedEstateValue') and (
    not v_is_null and (
      jsonb_typeof(p_value) <> 'number'
      or (p_value #>> '{}')::numeric < 0
    )
  ) then
    raise exception 'Invalid amount' using errcode = '22023';
  end if;
  if p_field = 'hasMinorChildren' and not v_is_null
     and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'Minor-children value must be boolean or null' using errcode = '22023';
  end if;
  if p_field = 'address' then
    if v_is_null or jsonb_typeof(p_value) <> 'object' then
      raise exception 'Invalid address' using errcode = '22023';
    end if;
    if (p_value - array['addressLine1', 'addressLine2', 'city', 'state', 'zip', 'county']) <> '{}'::jsonb
       or exists (
      select 1 from jsonb_each(p_value) item
      where item.key in ('addressLine1', 'addressLine2', 'city', 'state', 'zip', 'county')
        and jsonb_typeof(item.value) not in ('string', 'null')
    ) then
      raise exception 'Invalid address' using errcode = '22023';
    end if;
  end if;
  if p_field = 'spouse' and not v_is_null then
    if jsonb_typeof(p_value) <> 'object'
       or (p_value - array['firstName', 'middleName', 'lastName', 'preferredName', 'email', 'phone', 'dateOfBirth']) <> '{}'::jsonb
       or jsonb_typeof(p_value->'firstName') <> 'string'
       or jsonb_typeof(p_value->'lastName') <> 'string'
       or nullif(trim(p_value->>'firstName'), '') is null
       or nullif(trim(p_value->>'lastName'), '') is null then
      raise exception 'Spouse first and last name are required' using errcode = '22023';
    end if;
    if nullif(trim(p_value->>'email'), '') is not null
       and p_value->>'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Invalid spouse email' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_each(p_value) item
      where item.key in ('middleName', 'preferredName', 'email', 'phone', 'dateOfBirth')
        and jsonb_typeof(item.value) not in ('string', 'null')
    ) then
      raise exception 'Spouse detail fields must be strings or null' using errcode = '22023';
    end if;
    if nullif(p_value->>'dateOfBirth', '') is not null then
      perform (p_value->>'dateOfBirth')::date;
    end if;
  end if;

  select * into v_lead
  from public.client_intake
  where id = p_lead_id for update;
  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  select * into v_matter
  from public.matters
  where id = v_lead.matter_id for update;
  if not found then
    raise exception 'Lead opportunity not found' using errcode = 'P0002';
  end if;
  if v_matter.relationship_status = 'hired' then
    raise exception 'Lead already converted — edit it from the matter page.' using errcode = '22023';
  end if;

  perform set_config('app.actor_id', p_actor_id::text, true);

  update public.client_intake set
    first_name = case when p_field = 'firstName' then v_text else first_name end,
    middle_name = case when p_field = 'middleName' then v_text else middle_name end,
    last_name = case when p_field = 'lastName' then v_text else last_name end,
    full_name = case when p_field in ('firstName', 'middleName', 'lastName') then
      trim(concat_ws(
        ' ',
        case when p_field = 'firstName' then v_text else first_name end,
        case when p_field = 'middleName' then v_text else middle_name end,
        case when p_field = 'lastName' then v_text else last_name end
      ))
      else full_name end,
    preferred_name = case when p_field = 'preferredName' then v_text else preferred_name end,
    email = case when p_field = 'email' then lower(v_text) else email end,
    phone = case when p_field = 'phone' then v_text else phone end,
    date_of_birth = case when p_field = 'dateOfBirth' then v_text::date else date_of_birth end,
    address_line1 = case when p_field = 'address' then nullif(trim(p_value->>'addressLine1'), '') else address_line1 end,
    address_line2 = case when p_field = 'address' then nullif(trim(p_value->>'addressLine2'), '') else address_line2 end,
    city = case when p_field = 'address' then nullif(trim(p_value->>'city'), '') else city end,
    state = case when p_field = 'address' then nullif(trim(p_value->>'state'), '') else state end,
    zip = case when p_field = 'address' then nullif(trim(p_value->>'zip'), '') else zip end,
    county = case when p_field = 'address' then nullif(trim(p_value->>'county'), '') else county end,
    marital_status = case when p_field = 'maritalStatus' then v_text else marital_status end,
    practice_area = case when p_field = 'practiceArea' then upper(v_text) else practice_area end,
    lead_source = case when p_field = 'source' then v_text else lead_source end,
    engagement_fee_quoted = case when p_field = 'fee' then (p_value #>> '{}')::numeric else engagement_fee_quoted end,
    lead_urgency = case when p_field = 'urgency' then v_text else lead_urgency end,
    taxable_estate = case when p_field = 'estimatedEstateValue' then (p_value #>> '{}')::numeric else taxable_estate end,
    has_minor_children = case when p_field = 'hasMinorChildren' then (p_value #>> '{}')::boolean else has_minor_children end,
    qualification_notes = case when p_field = 'qualificationNotes' then v_text else qualification_notes end,
    billing_type = case when p_field = 'legalPlan' then v_text else billing_type end,
    legal_plan_member_id = case when p_field = 'legalPlanMemberId' then v_text else legal_plan_member_id end,
    legal_plan_service_start = case when p_field = 'legalPlanServiceStart' then v_text::date else legal_plan_service_start end,
    legal_plan_service_end = case when p_field = 'legalPlanServiceEnd' then v_text::date else legal_plan_service_end end,
    updated_at = statement_timestamp()
  where id = p_lead_id
  returning * into v_lead;

  if p_field = 'spouse' then
    if v_is_null then
      delete from public.contacts
      where client_intake_id = p_lead_id and relationship_type = 'spouse';
    else
      insert into public.contacts (
        client_intake_id, relationship_type, first_name, middle_name, last_name,
        preferred_name, email, phone, date_of_birth, source
      ) values (
        p_lead_id, 'spouse', trim(p_value->>'firstName'),
        nullif(trim(p_value->>'middleName'), ''), trim(p_value->>'lastName'),
        nullif(trim(p_value->>'preferredName'), ''),
        lower(nullif(trim(p_value->>'email'), '')),
        nullif(trim(p_value->>'phone'), ''),
        nullif(p_value->>'dateOfBirth', '')::date, 'lead_details'
      ) on conflict (client_intake_id) where relationship_type = 'spouse' do update set
        first_name = excluded.first_name,
        middle_name = excluded.middle_name,
        last_name = excluded.last_name,
        preferred_name = excluded.preferred_name,
        email = excluded.email,
        phone = excluded.phone,
        date_of_birth = excluded.date_of_birth,
        updated_at = statement_timestamp();
    end if;
  end if;

  if p_field in ('firstName', 'middleName', 'lastName', 'email') then
    update public.matters
    set name = coalesce(nullif(v_lead.full_name, ''), v_lead.email, name),
        updated_at = statement_timestamp()
    where id = v_matter.id;
  end if;

  if p_field in (
    'practiceArea', 'address', 'fee', 'estimatedEstateValue', 'source', 'urgency'
  ) then
    update public.matter_details set
      practice_area = v_lead.practice_area,
      jurisdiction_state = coalesce(nullif(v_lead.state, ''), jurisdiction_state, 'MA'),
      jurisdiction_county = nullif(v_lead.county, ''),
      flat_fee_amount = v_lead.engagement_fee_quoted,
      est_estate_value = v_lead.taxable_estate,
      referral_source = nullif(v_lead.lead_source, ''),
      urgency = v_lead.lead_urgency,
      updated_at = statement_timestamp()
    where client_id = v_matter.id;
  end if;

  -- Plan billing syncs to the ghost matter as it is entered, so the Billing tab
  -- is already populated the moment the lead converts.
  if p_field in (
    'legalPlan', 'legalPlanMemberId', 'legalPlanServiceStart', 'legalPlanServiceEnd'
  ) then
    update public.matter_details set
      billing_type = v_lead.billing_type,
      legal_plan = public.legal_plan_display_name(v_lead.billing_type),
      legal_plan_member_id = v_lead.legal_plan_member_id,
      legal_plan_service_start = v_lead.legal_plan_service_start,
      legal_plan_service_end = v_lead.legal_plan_service_end,
      updated_at = statement_timestamp()
    where client_id = v_matter.id;
  end if;

  insert into public.lead_activity (lead_id, event_type, title, detail, actor_id)
  values (
    p_lead_id, 'details_updated', 'Lead details updated',
    'Field updated: ' || p_field, p_actor_id
  ) returning * into v_activity;

  select to_jsonb(contact_row) into v_spouse
  from public.contacts contact_row
  where contact_row.client_intake_id = p_lead_id
    and contact_row.relationship_type = 'spouse';

  return jsonb_build_object(
    'lead', to_jsonb(v_lead),
    'spouse', v_spouse,
    'activity', to_jsonb(v_activity)
  );
end;
$$;

revoke execute on function public.update_lead_opportunity_field(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.update_lead_opportunity_field(uuid, text, jsonb, uuid) to service_role;

-- ── update_lead_opportunity_details ──────────────────────────────────────────
-- Replaces 20260802000000. The legacy full-form save has to round-trip the plan
-- fields too, or saving the whole form would silently drop what the rail wrote.
create or replace function public.update_lead_opportunity_details(
  p_lead_id uuid,
  p_details jsonb,
  p_spouse jsonb,
  p_actor_id uuid
) returns public.client_intake
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lead public.client_intake;
  v_matter public.matters;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_actor_id is null or not exists (
    select 1 from public.users u where u.id = p_actor_id and u.role in ('attorney', 'admin')
  ) then
    raise exception 'Attorney or admin access required' using errcode = '42501';
  end if;
  if p_details->>'status' not in ('lead', 'lost') then
    raise exception 'Lead status must be lead or lost before hiring' using errcode = '22023';
  end if;
  if nullif(p_details->>'legalPlan', '') is not null and p_details->>'legalPlan' not in (
    'flat_fee', 'metlife', 'legalease', 'arag', 'hyatt', 'legalshield', 'other_legal_plan'
  ) then
    raise exception 'Invalid legal plan' using errcode = '22023';
  end if;

  select * into v_lead from public.client_intake where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  select * into v_matter from public.matters where id = v_lead.matter_id for update;
  if not found or v_matter.relationship_status = 'hired' then
    raise exception 'Lead already hired';
  end if;

  perform set_config('app.actor_id', p_actor_id::text, true);

  update public.client_intake set
    first_name = p_details->>'firstName',
    middle_name = nullif(p_details->>'middleName', ''),
    last_name = p_details->>'lastName',
    full_name = trim(concat_ws(' ', p_details->>'firstName', p_details->>'middleName', p_details->>'lastName')),
    preferred_name = nullif(p_details->>'preferredName', ''),
    email = lower(p_details->>'email'),
    phone = nullif(p_details->>'phone', ''),
    date_of_birth = nullif(p_details->>'dateOfBirth', '')::date,
    address_line1 = nullif(p_details->>'addressLine1', ''),
    address_line2 = nullif(p_details->>'addressLine2', ''),
    city = nullif(p_details->>'city', ''),
    state = nullif(p_details->>'state', ''),
    zip = nullif(p_details->>'zip', ''),
    county = nullif(p_details->>'county', ''),
    marital_status = nullif(p_details->>'maritalStatus', ''),
    practice_area = nullif(upper(p_details->>'practiceArea'), ''),
    lead_source = nullif(p_details->>'source', ''),
    lead_status = p_details->>'status',
    engagement_fee_quoted = nullif(p_details->>'fee', '')::numeric,
    lead_urgency = nullif(p_details->>'urgency', ''),
    taxable_estate = nullif(p_details->>'estimatedEstateValue', '')::numeric,
    has_minor_children = nullif(p_details->>'hasMinorChildren', '')::boolean,
    qualification_notes = nullif(p_details->>'qualificationNotes', ''),
    billing_type = nullif(p_details->>'legalPlan', ''),
    legal_plan_member_id = nullif(p_details->>'legalPlanMemberId', ''),
    legal_plan_service_start = nullif(p_details->>'legalPlanServiceStart', '')::date,
    legal_plan_service_end = nullif(p_details->>'legalPlanServiceEnd', '')::date,
    updated_at = now()
  where id = p_lead_id returning * into v_lead;

  if p_spouse is null or p_spouse = 'null'::jsonb then
    delete from public.contacts where client_intake_id = p_lead_id and relationship_type = 'spouse';
  else
    insert into public.contacts (
      client_intake_id, relationship_type, first_name, middle_name, last_name,
      preferred_name, email, phone, date_of_birth, source
    ) values (
      p_lead_id, 'spouse', p_spouse->>'firstName', nullif(p_spouse->>'middleName', ''),
      p_spouse->>'lastName', nullif(p_spouse->>'preferredName', ''),
      lower(nullif(p_spouse->>'email', '')), nullif(p_spouse->>'phone', ''),
      nullif(p_spouse->>'dateOfBirth', '')::date, 'lead_details'
    ) on conflict (client_intake_id) where relationship_type = 'spouse' do update set
      first_name = excluded.first_name,
      middle_name = excluded.middle_name,
      last_name = excluded.last_name,
      preferred_name = excluded.preferred_name,
      email = excluded.email,
      phone = excluded.phone,
      date_of_birth = excluded.date_of_birth,
      updated_at = now();
  end if;

  update public.matters
  set name = coalesce(nullif(v_lead.full_name, ''), v_lead.email, name),
      relationship_status = v_lead.lead_status,
      lost_at = case when v_lead.lead_status = 'lost' then coalesce(lost_at, now()) else null end,
      lost_reason = case when v_lead.lead_status = 'lost' then lost_reason else null end,
      updated_at = now()
  where id = v_matter.id;

  update public.matter_details set
    practice_area = v_lead.practice_area,
    jurisdiction_state = coalesce(nullif(v_lead.state, ''), jurisdiction_state, 'MA'),
    jurisdiction_county = nullif(v_lead.county, ''),
    flat_fee_amount = v_lead.engagement_fee_quoted,
    est_estate_value = v_lead.taxable_estate,
    referral_source = nullif(v_lead.lead_source, ''),
    urgency = v_lead.lead_urgency,
    billing_type = v_lead.billing_type,
    legal_plan = public.legal_plan_display_name(v_lead.billing_type),
    legal_plan_member_id = v_lead.legal_plan_member_id,
    legal_plan_service_start = v_lead.legal_plan_service_start,
    legal_plan_service_end = v_lead.legal_plan_service_end,
    updated_at = now()
  where client_id = v_matter.id;

  insert into public.lead_activity (lead_id, event_type, title, detail, actor_id)
  values (p_lead_id, 'details_updated', 'Lead details updated', 'Client, household, and qualification details updated', p_actor_id);

  return v_lead;
end;
$$;

revoke execute on function public.update_lead_opportunity_details(uuid, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.update_lead_opportunity_details(uuid, jsonb, jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
