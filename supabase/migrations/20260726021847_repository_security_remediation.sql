-- Close privileged RPC grants, hide internal meeting-note metadata from
-- clients, and apply the lead snooze feature under a unique migration version.

create or replace function public.delete_intake_contact(
  p_contact_id uuid,
  p_client_intake_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  deleted_count integer;
begin
  delete from public.contacts
  where id = p_contact_id
    and client_intake_id = p_client_intake_id;

  get diagnostics deleted_count = row_count;

  if deleted_count > 0 then
    -- contact_roles normally disappear through ON DELETE CASCADE. Keep this
    -- cleanup scoped behind the ownership-qualified delete for older schemas.
    delete from public.contact_roles where contact_id = p_contact_id;
  end if;

  return deleted_count;
end;
$function$;

revoke execute on function public.delete_intake_contact(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_intake_contact(uuid, uuid)
  to service_role;

revoke execute on function public.drafting_hub_draft_rollups(text[])
  from public, anon, authenticated;
grant execute on function public.drafting_hub_draft_rollups(text[])
  to service_role;

create or replace function public.mark_messages_read(
  p_matter_id text,
  p_reader_role text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' then
    if auth.uid() is null
       or p_reader_role <> 'client'
       or not (
         exists (
           select 1
           from public.matters m
           where m.id::text = p_matter_id
             and m.client_id = auth.uid()
         )
         or exists (
           select 1
           from public.v_matter_pipeline v
           where v.matter_id::text = p_matter_id
             and v.client_email = (
               select u.email::text
               from auth.users u
               where u.id = auth.uid()
             )
         )
       ) then
      raise exception 'Matter access required' using errcode = '42501';
    end if;
  end if;

  if p_reader_role = 'client' then
    update public.messages
    set read_at = coalesce(read_at, statement_timestamp())
    where matter_id = p_matter_id
      and sender_role <> 'client'
      and read_at is null;

    update public.matters
    set unread_client_messages = 0
    where id::text = p_matter_id;
  else
    update public.messages
    set read_at = coalesce(read_at, statement_timestamp())
    where matter_id = p_matter_id
      and sender_role = 'client'
      and read_at is null;

    update public.matters
    set unread_attorney_messages = 0
    where id::text = p_matter_id;
  end if;
end;
$function$;

revoke execute on function public.mark_messages_read(text, text)
  from public, anon;
grant execute on function public.mark_messages_read(text, text)
  to authenticated, service_role;

drop policy if exists "client_read_visible_matter_documents"
  on public.matter_documents;

create policy "client_read_visible_matter_documents"
  on public.matter_documents
  for select to authenticated
  using (
    lower(coalesce(folder, '')) not in (
      'draft',
      'drafts',
      'meeting-notes',
      'meeting_notes',
      'meeting notes'
    )
    and (
      folder_id is null
      or not exists (
        select 1
        from public.folders f
        where f.id = matter_documents.folder_id
          and lower(f.name) in (
            'draft',
            'drafts',
            'meeting-notes',
            'meeting_notes',
            'meeting notes'
          )
      )
    )
    and (
      exists (
        select 1
        from public.matters m
        where m.id::text = matter_documents.matter_id
          and m.client_id = auth.uid()
      )
      or exists (
        select 1
        from public.v_matter_pipeline v
        where v.matter_id::text = matter_documents.matter_id
          and v.client_email = (
            select u.email
            from auth.users u
            where u.id = auth.uid()
          )
      )
    )
  );

alter table public.client_intake
  add column if not exists lead_next_action_snoozed_until timestamptz;

create or replace function public.snooze_lead_next_action(
  p_lead_id uuid,
  p_until timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
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
    select 1
    from public.users u
    where u.id = p_actor_id
      and u.role in ('attorney', 'admin')
  ) then
    raise exception 'Attorney or admin access required' using errcode = '42501';
  end if;

  if p_until is not null and p_until <= statement_timestamp() then
    raise exception 'Snooze time must be in the future' using errcode = '22023';
  end if;

  select *
  into v_lead
  from public.client_intake
  where id = p_lead_id
  for update;

  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  if v_lead.lead_status in ('hired', 'lost') then
    raise exception 'Next action is unavailable for this lead' using errcode = '22023';
  end if;

  update public.client_intake
  set lead_next_action_snoozed_until = p_until,
      updated_at = statement_timestamp()
  where id = p_lead_id
  returning * into v_lead;

  insert into public.lead_activity (
    lead_id,
    event_type,
    title,
    detail,
    actor_id
  )
  values (
    p_lead_id,
    case
      when p_until is null then 'next_action_snooze_cleared'
      else 'next_action_snoozed'
    end,
    case
      when p_until is null then 'Next action snooze cleared'
      else 'Next action snoozed'
    end,
    case
      when p_until is null then null
      else 'Snoozed until ' || to_char(
        p_until at time zone 'America/New_York',
        'Mon FMDD, YYYY FMHH12:MI AM'
      )
    end,
    p_actor_id
  )
  returning * into v_activity;

  return jsonb_build_object(
    'lead',
    to_jsonb(v_lead),
    'activity',
    to_jsonb(v_activity)
  );
end;
$function$;

revoke execute on function public.snooze_lead_next_action(uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.snooze_lead_next_action(uuid, timestamptz, uuid)
  to service_role;

notify pgrst, 'reload schema';
