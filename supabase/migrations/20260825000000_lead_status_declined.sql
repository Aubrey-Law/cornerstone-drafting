-- Let the narrow status RPC set `declined`.
--
-- 20260824000000 added `declined` to matters.relationship_status, but the only
-- transactional path that writes lead status still rejected it, so the value was
-- reachable only by hand. This is the same function as 20260812000000 with the
-- guard widened; the transition validator and date stamper installed in
-- 20260824000000 do the rest, which is why the terminal-date bookkeeping below
-- stays exactly as it was — the BEFORE UPDATE trigger recomputes lost_at,
-- declined_at and both reasons from the new status regardless of what this
-- statement sets.

create or replace function public.update_lead_opportunity_status(
  p_lead_id uuid,
  p_status text,
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
  -- `hired` is still excluded: hiring runs through convert_lead_to_matter, which
  -- assigns the matter number and seeds the checklist.
  if p_status is null or p_status not in ('lead', 'lost', 'declined') then
    raise exception 'Lead status must be lead, lost, or declined before hiring' using errcode = '22023';
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
  if v_lead.lead_status = 'hired' or v_matter.relationship_status = 'hired' then
    raise exception 'Lead already converted — edit it from the matter page.' using errcode = '22023';
  end if;

  perform set_config('app.actor_id', p_actor_id::text, true);

  update public.matters
  set relationship_status = p_status,
      lost_at = case when p_status = 'lost' then coalesce(lost_at, statement_timestamp()) else null end,
      lost_reason = case when p_status = 'lost' then lost_reason else null end,
      updated_at = statement_timestamp()
  where id = v_matter.id
  returning * into v_matter;

  update public.client_intake
  set lead_status = p_status,
      updated_at = statement_timestamp()
  where id = p_lead_id
  returning * into v_lead;

  insert into public.lead_activity (lead_id, event_type, title, detail, actor_id)
  values (
    p_lead_id, 'status_changed', 'Status changed',
    'Lead status changed to ' || p_status, p_actor_id
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

revoke execute on function public.update_lead_opportunity_status(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.update_lead_opportunity_status(uuid, text, uuid)
  to service_role;

notify pgrst, 'reload schema';
