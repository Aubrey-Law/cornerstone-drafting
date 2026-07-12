-- Transactional lead-detail editing and staff-authored lead notes.

create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.client_intake(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_notes_lead_created_idx on public.lead_notes (lead_id, created_at desc);

create table public.lead_meeting_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.client_intake(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  meeting_date timestamptz not null,
  attendees text[] not null default '{}'::text[],
  body text not null check (length(trim(body)) > 0),
  source text not null default 'manual' check (source in ('manual', 'granola')),
  granola_note_id text,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lead_meeting_notes_lead_meeting_idx on public.lead_meeting_notes (lead_id, meeting_date desc);
create unique index lead_meeting_notes_granola_unique_idx
  on public.lead_meeting_notes (lead_id, granola_note_id)
  where granola_note_id is not null;

alter table public.lead_notes enable row level security;
alter table public.lead_meeting_notes enable row level security;

create policy "Staff read lead notes" on public.lead_notes for select to authenticated
  using (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('attorney', 'admin', 'va', 'staff')));
create policy "Staff add lead notes" on public.lead_notes for insert to authenticated
  with check (actor_id = (select auth.uid()) and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('attorney', 'admin', 'va', 'staff')));
create policy "Staff update lead notes" on public.lead_notes for update to authenticated
  using (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('attorney', 'admin', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('attorney', 'admin', 'va', 'staff')));
create policy "Authors or admins delete lead notes" on public.lead_notes for delete to authenticated
  using (actor_id = (select auth.uid()) or exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role = 'admin'));

create policy "Staff read lead meeting notes" on public.lead_meeting_notes for select to authenticated
  using (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('attorney', 'admin', 'va', 'staff')));
create policy "Staff add lead meeting notes" on public.lead_meeting_notes for insert to authenticated
  with check (actor_id = (select auth.uid()) and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('attorney', 'admin', 'va', 'staff')));
create policy "Staff update lead meeting notes" on public.lead_meeting_notes for update to authenticated
  using (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('attorney', 'admin', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('attorney', 'admin', 'va', 'staff')));
create policy "Authors or admins delete lead meeting notes" on public.lead_meeting_notes for delete to authenticated
  using (actor_id = (select auth.uid()) or exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role = 'admin'));

grant select, insert, update, delete on public.lead_notes to authenticated;
grant select, insert, update, delete on public.lead_meeting_notes to authenticated;

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
begin
  if (current_user <> 'service_role' and p_actor_id is distinct from auth.uid())
     or not exists (select 1 from public.users u where u.id = p_actor_id and u.role in ('attorney', 'admin')) then
    raise exception 'Attorney or admin access required' using errcode = '42501';
  end if;

  if p_details->>'status' not in ('lead', 'hired', 'lost') then
    raise exception 'Invalid lead status' using errcode = '22023';
  end if;
  if nullif(p_details->>'fee', '')::numeric < 0 then
    raise exception 'Invalid fee' using errcode = '22023';
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
    engagement_fee_quoted = nullif(p_details->>'fee', '')::numeric, updated_at = now()
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
  values (p_lead_id, 'details_updated', 'Lead details updated', 'Client and household details updated', p_actor_id);
  return v_lead;
end;
$$;

revoke execute on function public.update_lead_details(uuid, jsonb, jsonb, uuid) from public;
revoke execute on function public.update_lead_details(uuid, jsonb, jsonb, uuid) from anon;
grant execute on function public.update_lead_details(uuid, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.update_lead_details(uuid, jsonb, jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
