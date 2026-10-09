-- CLI-created migration ordered after the future-dated merge and form foundations.
-- Preserve the existing merge behavior after an atomic questionnaire preflight.
create or replace function public.merge_matters(
  p_winner_id uuid,
  p_loser_id uuid,
  p_reason text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_winner public.matters;
  v_loser  public.matters;
  v_winner_intake public.client_intake;
  v_loser_intake public.client_intake;
  v_ref    record;
  v_res    record;
  v_moved  jsonb := '{}'::jsonb;
  v_left   jsonb := '{}'::jsonb;
  v_drafting boolean;
  v_key    text;
  v_drafting_tables regclass[] := array[
    'public.design_sheets',
    'public.contact_roles',
    'public.matter_estate_clause_overrides'
  ]::regclass[];
  -- Matter references that stay with the archived matter (see the header).
  v_matter_skip regclass[] := array[
    'public.matters',
    'public.client_intake',
    'public.matter_relationship_status_history',
    'public.matter_stage_history',
    'public.asset_funding',
    'public.estate_clause_preview_evidence',
    'public.document_template_versions'
  ]::regclass[];
  -- Intake references that stay with the archived lead's intake.
  v_intake_skip regclass[] := array[
    'public.matters',
    'public.client_intake',
    'public.contacts',
    'public.asset_intake',
    'public.cornerstone_crm_people'
  ]::regclass[];
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if p_winner_id = p_loser_id then
    raise exception 'Cannot merge a matter into itself' using errcode = '22023';
  end if;

  -- Locked in id order so two merges racing over the same pair cannot deadlock.
  perform 1 from public.matters where id in (p_winner_id, p_loser_id) order by id for update;

  select * into v_winner from public.matters where id = p_winner_id;
  if not found then raise exception 'Matter % not found', p_winner_id using errcode = '22023'; end if;
  select * into v_loser from public.matters where id = p_loser_id;
  if not found then raise exception 'Matter % not found', p_loser_id using errcode = '22023'; end if;

  if v_winner.merged_into_id is not null then
    raise exception 'Matter % has itself been merged away', p_winner_id using errcode = '22023';
  end if;
  if v_loser.merged_into_id is not null then
    raise exception 'Matter % has already been merged', p_loser_id using errcode = '22023';
  end if;

  -- Lock questionnaire identity and answers before moving any references.
  -- Matter rows are already locked, so their intake links cannot change.
  perform 1 from public.client_intake
    where id in (v_winner.client_intake_id, v_loser.client_intake_id)
    order by id for share;
  select * into v_winner_intake from public.client_intake where id = v_winner.client_intake_id;
  if v_winner.client_intake_id is not null and not found then
    raise exception 'The kept matter questionnaire is unavailable. Refresh before merging.' using errcode = '22023';
  end if;
  select * into v_loser_intake from public.client_intake where id = v_loser.client_intake_id;
  if v_loser.client_intake_id is not null and not found then
    raise exception 'The other matter questionnaire is unavailable. Refresh before merging.' using errcode = '22023';
  end if;

  if v_winner.client_intake_id is distinct from v_loser.client_intake_id then
    -- Matching versions do not imply matching answers or appointments. Until
    -- there is an explicit reconciliation workflow, preserve distinct pinned
    -- questionnaires as separate matters, including pinned vs missing intake.
    if v_winner_intake.form_version_id is not null or v_loser_intake.form_version_id is not null then
      raise exception 'These matters have separate saved questionnaires. Keep them separate; questionnaire reconciliation is required before merging.' using errcode = '22023';
    end if;
    if v_winner.client_intake_id is not null and v_loser.client_intake_id is not null
      and v_winner_intake.intake_track is distinct from v_loser_intake.intake_track then
      raise exception 'These matters use different questionnaire tracks and cannot be merged.' using errcode = '22023';
    end if;
  end if;

  v_drafting := not exists (select 1 from public.design_sheets where matter_id = p_winner_id)
            and exists (select 1 from public.design_sheets where matter_id = p_loser_id);

  -- Documents filed in a folder the kept matter already has by name go into
  -- that folder; the archived matter's now-empty folder stays behind.
  update public.matter_documents d
  set folder_id = wf.id
  from public.matter_document_folders lf
  join public.matter_document_folders wf
    on wf.matter_id = p_winner_id
   and lower(btrim(wf.name)) = lower(btrim(lf.name))
  where lf.matter_id = p_loser_id
    and d.folder_id = lf.id;

  -- ── References to the matter ─────────────────────────────────────────────
  for v_ref in
    select c.conrelid::regclass as tbl, a.attname::text as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.matters'::regclass
      and array_length(c.conkey, 1) = 1
      and c.conrelid <> all (v_matter_skip)
    union
    -- Older tables key the matter as text with no foreign key.
    select to_regclass('public.' || t.name), 'matter_id'
    from unnest(array[
      'matter_documents', 'matter_activity', 'messages', 'matter_assistant_messages',
      'sms_messages', 'email_log', 'work_runs', 'tabular_reviews', 'document_access_audit'
    ]) as t(name)
    where to_regclass('public.' || t.name) is not null
    order by 1, 2
  loop
    if v_ref.tbl = any (v_drafting_tables) and not v_drafting then
      continue;
    end if;
    select * into v_res from public.merge_move_column(v_ref.tbl, v_ref.col, p_loser_id::text, p_winner_id::text);
    v_key := v_ref.tbl::text || '.' || v_ref.col;
    if v_res.moved > 0 then v_moved := v_moved || jsonb_build_object(v_key, v_res.moved); end if;
    if v_res.left_behind > 0 then v_left := v_left || jsonb_build_object(v_key, v_res.left_behind); end if;
  end loop;

  -- ── References to the lead (its intake) ──────────────────────────────────
  -- Notes, activity, meeting notes, messages, appointments, agreements and
  -- uploads hang off the intake id rather than the matter id.
  if v_loser.client_intake_id is not null
     and v_winner.client_intake_id is not null
     and v_loser.client_intake_id <> v_winner.client_intake_id then
    for v_ref in
      select c.conrelid::regclass as tbl, a.attname::text as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f'
        and c.confrelid = 'public.client_intake'::regclass
        and array_length(c.conkey, 1) = 1
        and c.conrelid <> all (v_intake_skip)
      order by 1, 2
    loop
      if v_ref.tbl = any (v_drafting_tables) and not v_drafting then
        continue;
      end if;
      select * into v_res from public.merge_move_column(
        v_ref.tbl, v_ref.col, v_loser.client_intake_id::text, v_winner.client_intake_id::text
      );
      v_key := v_ref.tbl::text || '.' || v_ref.col;
      if v_res.moved > 0 then
        v_moved := v_moved || jsonb_build_object(v_key, coalesce((v_moved->>v_key)::int, 0) + v_res.moved);
      end if;
      if v_res.left_behind > 0 then
        v_left := v_left || jsonb_build_object(v_key, coalesce((v_left->>v_key)::int, 0) + v_res.left_behind);
      end if;
    end loop;
  end if;

  -- A client who could sign in to the archived matter's portal keeps access.
  if v_winner.client_id is null and v_loser.client_id is not null then
    update public.matters set client_id = v_loser.client_id where id = p_winner_id;
  end if;

  -- ── Tombstone ────────────────────────────────────────────────────────────
  update public.matters
  set merged_into_id = p_winner_id,
      merged_at = now(),
      status = 'archived'
  where id = p_loser_id;

  insert into public.matter_activity (matter_id, event_type, actor_id, title, detail, metadata)
  values (
    p_winner_id::text,
    'matter_merged',
    p_actor_id,
    'Merged ' || coalesce(nullif(v_loser.matter_number, ''), nullif(v_loser.name, ''), 'another record') || ' into this matter',
    p_reason,
    jsonb_build_object('loser_matter_id', p_loser_id, 'rows_moved', v_moved, 'rows_left', v_left)
  );

  insert into public.matter_merges (
    winner_matter_id, loser_matter_id, winner_intake_id, loser_intake_id,
    loser_matter_number, loser_name, loser_relationship_status,
    rows_moved, rows_left, drafting_moved, reason, merged_by
  ) values (
    p_winner_id, p_loser_id, v_winner.client_intake_id, v_loser.client_intake_id,
    v_loser.matter_number, v_loser.name, v_loser.relationship_status,
    v_moved, v_left, v_drafting, p_reason, p_actor_id
  );

  return jsonb_build_object(
    'rows_moved', v_moved,
    'rows_left', v_left,
    'drafting_moved', v_drafting
  );
end;
$$;

revoke all on function public.merge_matters(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.merge_matters(uuid, uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
