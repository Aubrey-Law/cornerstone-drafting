alter table public.client_intake
  add column if not exists lead_next_action_snoozed_until timestamptz;

create or replace function public.snooze_lead_next_action(
  p_lead_id uuid,
  p_until timestamptz,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lead public.client_intake;
  v_activity public.lead_activity;
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
  if p_until is not null and p_until <= statement_timestamp() then
    raise exception 'Snooze time must be in the future' using errcode = '22023';
  end if;

  select * into v_lead from public.client_intake
  where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = 'P0002'; end if;
  if v_lead.lead_status in ('hired', 'lost') then
    raise exception 'Next action is unavailable for this lead' using errcode = '22023';
  end if;

  update public.client_intake
  set lead_next_action_snoozed_until = p_until,
      updated_at = statement_timestamp()
  where id = p_lead_id returning * into v_lead;

  insert into public.lead_activity (lead_id, event_type, title, detail, actor_id)
  values (
    p_lead_id,
    case when p_until is null then 'next_action_snooze_cleared' else 'next_action_snoozed' end,
    case when p_until is null then 'Next action snooze cleared' else 'Next action snoozed' end,
    case when p_until is null then null else
      'Snoozed until ' || to_char(
        p_until at time zone 'America/New_York',
        'Mon FMDD, YYYY FMHH12:MI AM'
      )
    end,
    p_actor_id
  ) returning * into v_activity;

  return jsonb_build_object('lead', to_jsonb(v_lead), 'activity', to_jsonb(v_activity));
end;
$$;

revoke execute on function public.snooze_lead_next_action(uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.snooze_lead_next_action(uuid, timestamptz, uuid)
  to service_role;

notify pgrst, 'reload schema';
