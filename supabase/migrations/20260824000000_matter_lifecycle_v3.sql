-- Cornerstone — matter lifecycle v3.
--
-- Two orthogonal axes on a matter, previously conflated:
--
--   relationship_status  Did this person become a client?
--                        lead → hired | lost | declined
--   status               Where is the work?
--                        active | on_hold | closed | archived
--
-- `lost` and `declined` are deliberately distinct. A declined opportunity is one
-- the firm turned away at discovery (not a fit); a lost one was a fit that never
-- engaged. Conversion rate counts lost in the denominator and declined out of it,
-- so collapsing the two would quietly misstate the number.
--
-- Also adds the date anchors the v3 SLA computes from. The pre-engagement clock
-- is anchored to the discovery call and the PMPS date; the firm 28-day clock is
-- anchored to Day 0 = engagement signature.

-- ── relationship_status gains `declined` ────────────────────────────────────

alter table public.matters
  add column if not exists declined_at timestamptz,
  add column if not exists declined_reason text;

alter table public.matters
  drop constraint if exists matters_relationship_status_check,
  add constraint matters_relationship_status_check
    check (relationship_status in ('lead', 'hired', 'lost', 'declined'));

alter table public.matter_relationship_status_history
  drop constraint if exists matter_relationship_status_history_from_status_check,
  add constraint matter_relationship_status_history_from_status_check
    check (from_status is null or from_status in ('lead', 'hired', 'lost', 'declined'));

alter table public.matter_relationship_status_history
  drop constraint if exists matter_relationship_status_history_to_status_check,
  add constraint matter_relationship_status_history_to_status_check
    check (to_status in ('lead', 'hired', 'lost', 'declined'));

-- `hired` stays terminal: a signed engagement is a fact, not a pipeline state.
-- Everything else can be corrected, because misfiling a lead as lost when it was
-- really declined (or vice versa) is a data-entry mistake, not a lifecycle event.
create or replace function public.validate_matter_relationship_status_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.relationship_status is not distinct from old.relationship_status then
    return new;
  end if;

  if not (
    (old.relationship_status = 'lead' and new.relationship_status in ('hired', 'lost', 'declined'))
    or (old.relationship_status = 'lost' and new.relationship_status in ('lead', 'declined'))
    or (old.relationship_status = 'declined' and new.relationship_status in ('lead', 'lost'))
  ) then
    raise exception 'Invalid matter relationship transition: % -> %', old.relationship_status, new.relationship_status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_matter_relationship_status_change() from public, anon, authenticated;

create or replace function public.record_matter_relationship_status_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid;
begin
  if new.relationship_status is not distinct from old.relationship_status then
    return new;
  end if;

  begin
    v_actor_id := nullif(current_setting('app.actor_id', true), '')::uuid;
  exception when invalid_text_representation then
    v_actor_id := null;
  end;
  v_actor_id := coalesce(v_actor_id, auth.uid());

  insert into public.matter_relationship_status_history (
    matter_id, from_status, to_status, reason, actor_id
  ) values (
    new.id, old.relationship_status, new.relationship_status,
    case
      when new.relationship_status = 'lost' then new.lost_reason
      when new.relationship_status = 'declined' then new.declined_reason
      else null
    end,
    v_actor_id
  );
  return new;
end;
$$;

-- Stamp the exit timestamp for whichever terminal state the matter landed in,
-- and clear the others so a reactivated opportunity does not carry a stale date.
create or replace function public.stamp_matter_relationship_dates()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.relationship_status is not distinct from old.relationship_status then
    return new;
  end if;

  new.hired_at    := case when new.relationship_status = 'hired'    then coalesce(new.hired_at, now())    else new.hired_at end;
  new.lost_at     := case when new.relationship_status = 'lost'     then coalesce(new.lost_at, now())     else null end;
  new.declined_at := case when new.relationship_status = 'declined' then coalesce(new.declined_at, now()) else null end;

  if new.relationship_status <> 'lost' then
    new.lost_reason := null;
  end if;
  if new.relationship_status <> 'declined' then
    new.declined_reason := null;
  end if;

  return new;
end;
$$;

revoke execute on function public.stamp_matter_relationship_dates() from public, anon, authenticated;

drop trigger if exists stamp_matter_relationship_dates on public.matters;
create trigger stamp_matter_relationship_dates
before update of relationship_status on public.matters
for each row execute function public.stamp_matter_relationship_dates();

-- ── status becomes the work axis ────────────────────────────────────────────
--
-- `on_hold` is the SLA's 21-days-of-client-silence state: the matter is live but
-- its clock is tolled. `closed` is work complete (funding confirmed); `archived`
-- stays what it was, a visibility flag.

alter table public.matters
  add column if not exists closed_at timestamptz,
  add column if not exists on_hold_at timestamptz,
  add column if not exists hold_reason text;

update public.matters
set status = 'active'
where status is null or status not in ('active', 'on_hold', 'closed', 'archived');

alter table public.matters
  drop constraint if exists matters_status_check,
  add constraint matters_status_check
    check (status in ('active', 'on_hold', 'closed', 'archived'));

create or replace function public.stamp_matter_status_dates()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  new.closed_at  := case when new.status = 'closed'  then coalesce(new.closed_at, now())  else null end;
  new.on_hold_at := case when new.status = 'on_hold' then coalesce(new.on_hold_at, now()) else null end;

  if new.status <> 'on_hold' then
    new.hold_reason := null;
  end if;

  return new;
end;
$$;

revoke execute on function public.stamp_matter_status_dates() from public, anon, authenticated;

drop trigger if exists stamp_matter_status_dates on public.matters;
create trigger stamp_matter_status_dates
before update of status on public.matters
for each row execute function public.stamp_matter_status_dates();

-- `v_matter_aging` already filters to status = 'active', so an on-hold or closed
-- matter drops out of the aging boards without touching the view.

-- ── SLA date anchors ────────────────────────────────────────────────────────
--
-- `fit_decision` is the gate the post-discovery automation keys off: the
-- organizer + PMPS scheduling email only fires once the attorney marks the lead
-- a fit, and a `not_a_fit` decision is what moves the matter to `declined`.

alter table public.matters
  add column if not exists discovery_call_at       timestamptz,
  add column if not exists fit_decision            text,
  add column if not exists fit_decided_at          timestamptz,
  add column if not exists pmps_at                 timestamptz,
  add column if not exists recommendations_sent_at timestamptz,
  add column if not exists engagement_signed_at    timestamptz;

alter table public.matters
  drop constraint if exists matters_fit_decision_check,
  add constraint matters_fit_decision_check
    check (fit_decision is null or fit_decision in ('fit', 'not_a_fit'));

-- Day 0 for every hired matter's firm clock. The engagement columns already live
-- on matter_details; this promotes the one date the SLA computes from onto the
-- matter itself so task generation never has to join to find it.
update public.matters m
set engagement_signed_at = coalesce(md.engagement_signed_at, m.hired_at)
from public.matter_details md
where md.client_id = m.id
  and m.engagement_signed_at is null
  and m.relationship_status = 'hired';

update public.matters
set engagement_signed_at = hired_at
where engagement_signed_at is null
  and relationship_status = 'hired'
  and hired_at is not null;

update public.matters m
set recommendations_sent_at = ci.engagement_sent_at
from public.client_intake ci
where ci.id = m.client_intake_id
  and m.recommendations_sent_at is null
  and ci.engagement_sent_at is not null;

create index if not exists matters_discovery_call_idx
  on public.matters (discovery_call_at desc)
  where relationship_status = 'lead';

-- ── Lead-side compatibility ─────────────────────────────────────────────────
--
-- `client_intake.lead_status` is now a mirror of `matters.relationship_status`
-- and should be treated as deprecated for writes; these two functions keep it
-- accepting the new value until the lead routes are folded into matters.

create or replace function public.ensure_lead_matter()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_matter_id uuid;
  v_relationship_status text;
  v_stage text;
  v_stage_entered_at timestamptz;
begin
  if new.lead_status is null then
    return new;
  end if;

  select m.id into v_matter_id
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

-- Only the status guard changes; the body is otherwise the 20260802 version.
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
  if p_details->>'status' not in ('lead', 'lost', 'declined') then
    raise exception 'Lead status must be lead, lost, or declined before hiring' using errcode = '22023';
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

  -- lost_at / declined_at and their reasons are stamped by the trigger.
  update public.matters
  set name = coalesce(nullif(v_lead.full_name, ''), v_lead.email, name),
      relationship_status = v_lead.lead_status,
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
