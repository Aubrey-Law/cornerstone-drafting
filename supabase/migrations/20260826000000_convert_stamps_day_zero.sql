-- Stamp Day 0 on the matter during conversion.
--
-- 20260824000000 added matters.engagement_signed_at and backfilled it, but
-- nothing maintained it, so every newly hired matter left it null and the firm
-- 28-day clock had no anchor to date its tasks from.
--
-- It is set here rather than by the caller because conversion is deliberately a
-- single RPC — tests assert that hiring performs no separate write to `matters`
-- — and because Day 0 and the hire are the same event, so they belong in the
-- same transaction. Existing hired matters keep whatever the backfill gave them.

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
  p_engagement_signed boolean,
  p_actor_id uuid default null
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
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select * into v_lead from public.client_intake where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  if p_actor_id is not null then
    perform set_config('app.actor_id', p_actor_id::text, true);
  end if;

  v_practice_area := case
    when trim(p_practice_area) in ('EP-LP', 'Estate Planning (LP)', 'Estate Planning | LP', 'Estate Planning - LP', 'Estate Planning-LP') then 'EP-LP'
    when upper(trim(p_practice_area)) = 'PROBATE' or trim(p_practice_area) = 'Probate (LP)' then 'Probate'
    else 'EP'
  end;

  select * into v_matter
  from public.matters
  where id = v_lead.matter_id or client_intake_id = p_lead_id
  order by (id = v_lead.matter_id) desc, created_at desc
  limit 1
  for update;

  if not found then
    insert into public.matters (
      client_intake_id, client_id, name, matter_number, stage, status,
      stage_entered_at, track, relationship_status, hired_at, engagement_signed_at
    ) values (
      p_lead_id, p_client_id, p_matter_name, p_matter_number, 'intake', 'active',
      now(), 'DEFAULT', 'hired', now(), coalesce(p_engagement_signed_at, now())
    ) returning * into v_matter;
    v_created := true;
  elsif v_matter.relationship_status = 'hired' then
    return query select v_matter.id, v_matter.matter_number, false;
    return;
  elsif v_matter.relationship_status = 'lost' then
    raise exception 'Reactivate the lost opportunity before hiring it' using errcode = '23514';
  else
    update public.matters set
      client_id = p_client_id,
      name = p_matter_name,
      matter_number = p_matter_number,
      stage = 'intake',
      status = 'active',
      stage_entered_at = now(),
      relationship_status = 'hired',
      hired_at = coalesce(hired_at, now()),
      engagement_signed_at = coalesce(engagement_signed_at, p_engagement_signed_at, now()),
      lost_at = null,
      lost_reason = null,
      updated_at = now()
    where id = v_matter.id
    returning * into v_matter;
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
    matter_status = excluded.matter_status,
    client_status = excluded.client_status,
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

  update public.client_intake set
    practice_area = v_practice_area,
    matter_id = v_matter.id,
    lead_status = 'hired',
    updated_at = now()
  where id = p_lead_id;

  return query select v_matter.id, v_matter.matter_number, v_created;
end;
$$;

revoke execute on function public.convert_lead_to_matter(uuid, text, text, text, uuid, numeric, text, text, text, timestamptz, timestamptz, boolean, uuid) from public, anon, authenticated;
grant execute on function public.convert_lead_to_matter(uuid, text, text, text, uuid, numeric, text, text, text, timestamptz, timestamptz, boolean, uuid) to service_role;


notify pgrst, 'reload schema';
