-- Lightweight lead qualification data used by the lead detail and pipeline
-- insight surfaces. These columns stay on client_intake so Lite does not grow a
-- second CRM data model.

alter table public.client_intake
  add column if not exists lead_urgency text,
  add column if not exists qualification_notes text;

alter table public.client_intake
  drop constraint if exists client_intake_lead_urgency_check,
  add constraint client_intake_lead_urgency_check
    check (lead_urgency is null or lead_urgency in ('low', 'normal', 'high'));

create or replace function public.update_lead_details(
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
  v_actor_id uuid;
begin
  if auth.role() = 'service_role' then
    if p_actor_id is null or not exists (
      select 1 from public.users u where u.id = p_actor_id and u.role in ('attorney', 'admin')
    ) then
      raise exception 'Attorney or admin access required' using errcode = '42501';
    end if;
    v_actor_id := p_actor_id;
  else
    v_actor_id := auth.uid();
    if v_actor_id is null
       or p_actor_id is distinct from v_actor_id
       or not exists (select 1 from public.users u where u.id = v_actor_id and u.role in ('attorney', 'admin')) then
      raise exception 'Attorney or admin access required' using errcode = '42501';
    end if;
  end if;

  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Lead details must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(p_details->'firstName') <> 'string'
     or jsonb_typeof(p_details->'lastName') <> 'string'
     or nullif(trim(p_details->>'firstName'), '') is null
     or nullif(trim(p_details->>'lastName'), '') is null then
    raise exception 'Client first and last name are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_details->'email') <> 'string'
     or nullif(trim(p_details->>'email'), '') is null
     or p_details->>'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Valid client email is required' using errcode = '22023';
  end if;
  if p_details->>'status' is null or p_details->>'status' not in ('lead', 'hired', 'lost') then
    raise exception 'Invalid lead status' using errcode = '22023';
  end if;
  if not (p_details ? 'fee')
     or jsonb_typeof(p_details->'fee') not in ('number', 'null')
     or (jsonb_typeof(p_details->'fee') = 'number' and (p_details->>'fee')::numeric < 0) then
    raise exception 'Invalid fee' using errcode = '22023';
  end if;
  if not (p_details ? 'estimatedEstateValue')
     or jsonb_typeof(p_details->'estimatedEstateValue') not in ('number', 'null')
     or (jsonb_typeof(p_details->'estimatedEstateValue') = 'number' and (p_details->>'estimatedEstateValue')::numeric < 0) then
    raise exception 'Invalid estimated estate value' using errcode = '22023';
  end if;
  if not (p_details ? 'hasMinorChildren')
     or jsonb_typeof(p_details->'hasMinorChildren') not in ('boolean', 'null') then
    raise exception 'Invalid minor children value' using errcode = '22023';
  end if;
  if nullif(p_details->>'urgency', '') is not null
     and p_details->>'urgency' not in ('low', 'normal', 'high') then
    raise exception 'Invalid lead urgency' using errcode = '22023';
  end if;
  if p_spouse is not null and p_spouse <> 'null'::jsonb then
    if jsonb_typeof(p_spouse) <> 'object'
       or jsonb_typeof(p_spouse->'firstName') <> 'string'
       or jsonb_typeof(p_spouse->'lastName') <> 'string'
       or nullif(trim(p_spouse->>'firstName'), '') is null
       or nullif(trim(p_spouse->>'lastName'), '') is null then
      raise exception 'Spouse first and last name are required' using errcode = '22023';
    end if;
    if nullif(trim(p_spouse->>'email'), '') is not null
       and p_spouse->>'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Invalid spouse email' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from jsonb_each(p_details) item
    where item.key in ('middleName', 'preferredName', 'phone', 'dateOfBirth',
      'addressLine1', 'addressLine2', 'city', 'state', 'zip', 'county',
      'maritalStatus', 'practiceArea', 'source', 'urgency', 'qualificationNotes')
      and jsonb_typeof(item.value) not in ('string', 'null')
  ) then
    raise exception 'Lead detail fields must be strings or null' using errcode = '22023';
  end if;
  if p_spouse is not null and p_spouse <> 'null'::jsonb and exists (
    select 1 from jsonb_each(p_spouse) item
    where item.key in ('middleName', 'preferredName', 'email', 'phone', 'dateOfBirth')
      and jsonb_typeof(item.value) not in ('string', 'null')
  ) then
    raise exception 'Spouse detail fields must be strings or null' using errcode = '22023';
  end if;

  if nullif(p_details->>'dateOfBirth', '') is not null then
    perform (p_details->>'dateOfBirth')::date;
  end if;
  if p_spouse is not null and p_spouse <> 'null'::jsonb
     and nullif(p_spouse->>'dateOfBirth', '') is not null then
    perform (p_spouse->>'dateOfBirth')::date;
  end if;

  select * into v_lead from public.client_intake where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  if v_lead.matter_id is not null then raise exception 'Lead already converted'; end if;

  update public.client_intake set
    first_name = p_details->>'firstName', middle_name = nullif(p_details->>'middleName', ''),
    last_name = p_details->>'lastName', full_name = trim(concat_ws(' ', p_details->>'firstName', p_details->>'middleName', p_details->>'lastName')),
    preferred_name = nullif(p_details->>'preferredName', ''), email = lower(p_details->>'email'),
    phone = nullif(p_details->>'phone', ''), date_of_birth = nullif(p_details->>'dateOfBirth', '')::date,
    address_line1 = nullif(p_details->>'addressLine1', ''), address_line2 = nullif(p_details->>'addressLine2', ''),
    city = nullif(p_details->>'city', ''), state = nullif(p_details->>'state', ''), zip = nullif(p_details->>'zip', ''), county = nullif(p_details->>'county', ''),
    marital_status = nullif(p_details->>'maritalStatus', ''), practice_area = nullif(upper(p_details->>'practiceArea'), ''),
    lead_source = nullif(p_details->>'source', ''), lead_status = p_details->>'status',
    engagement_fee_quoted = nullif(p_details->>'fee', '')::numeric,
    lead_urgency = nullif(p_details->>'urgency', ''),
    taxable_estate = nullif(p_details->>'estimatedEstateValue', '')::numeric,
    has_minor_children = nullif(p_details->>'hasMinorChildren', '')::boolean,
    qualification_notes = nullif(p_details->>'qualificationNotes', ''),
    updated_at = now()
  where id = p_lead_id returning * into v_lead;

  if p_spouse is null or p_spouse = 'null'::jsonb then
    delete from public.contacts where client_intake_id = p_lead_id and relationship_type = 'spouse';
  else
    insert into public.contacts (client_intake_id, relationship_type, first_name, middle_name, last_name, preferred_name, email, phone, date_of_birth, source)
    values (p_lead_id, 'spouse', p_spouse->>'firstName', nullif(p_spouse->>'middleName', ''), p_spouse->>'lastName', nullif(p_spouse->>'preferredName', ''), lower(nullif(p_spouse->>'email', '')), nullif(p_spouse->>'phone', ''), nullif(p_spouse->>'dateOfBirth', '')::date, 'lead_details')
    on conflict (client_intake_id) where relationship_type = 'spouse' do update set
      first_name = excluded.first_name, middle_name = excluded.middle_name, last_name = excluded.last_name,
      preferred_name = excluded.preferred_name, email = excluded.email, phone = excluded.phone,
      date_of_birth = excluded.date_of_birth, updated_at = now();
  end if;

  insert into public.lead_activity (lead_id, event_type, title, detail, actor_id)
  values (p_lead_id, 'details_updated', 'Lead details updated', 'Client, household, and qualification details updated', v_actor_id);
  return v_lead;
end;
$$;

revoke execute on function public.update_lead_details(uuid, jsonb, jsonb, uuid) from public;
revoke execute on function public.update_lead_details(uuid, jsonb, jsonb, uuid) from anon;
grant execute on function public.update_lead_details(uuid, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.update_lead_details(uuid, jsonb, jsonb, uuid) to service_role;
