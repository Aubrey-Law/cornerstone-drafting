-- Merge one lead or matter into another.
--
-- Leads and matters are the same row since 20260802000000 (a lead is a matter
-- whose relationship_status is still 'lead'), so one function covers lead into
-- lead, lead into matter, and matter into matter. The usual case is a returning
-- client whose new intake opened a second lead beside the matter the firm
-- already has for them, or the same prospect booked twice.
--
-- Same shape as merge_contacts (20260929000000):
--   • the merged-away matter is tombstoned (archived, merged_into_id), never
--     deleted, so nothing is destroyed and every list already hides it;
--   • every merge is logged with what moved and what could not;
--   • references are discovered from the catalog, so a table that gains a
--     matter_id later is moved without anyone remembering this function.
--
-- What deliberately does NOT move:
--   • The drafting record — design sheets, fiduciary appointments
--     (contact_roles) and clause overrides — unless the kept matter has no
--     design sheet of its own. Two plans for the same people cannot be combined
--     row by row; mixing them would put the other file's agents into this one.
--   • Stage and relationship-status history: it describes the other file's
--     timeline, and splicing it in would rewrite this one's.
--   • The intake itself and its asset answers, and asset funding tied to them.
--   • Any row whose unique key the kept matter already holds — a second
--     "self" person, a second fee schedule, the same folder name. Those stay
--     on the archived matter, where they remain readable, and are counted in
--     the log as left behind.

-- ── Tombstone ───────────────────────────────────────────────────────────────

alter table public.matters
  add column if not exists merged_into_id uuid references public.matters(id) on delete set null,
  add column if not exists merged_at timestamptz;

create index if not exists matters_merged_into_idx
  on public.matters (merged_into_id) where merged_into_id is not null;

comment on column public.matters.merged_into_id is
  'Set when this lead or matter was merged into another. The row is archived '
  'rather than deleted, so whatever could not move stays readable and old links '
  'can follow it to the matter it became.';

-- ── The log ─────────────────────────────────────────────────────────────────

create table if not exists public.matter_merges (
  id uuid primary key default gen_random_uuid(),
  -- No foreign keys, like contact_merges and matter_deletions.
  winner_matter_id uuid not null,
  loser_matter_id uuid not null,
  winner_intake_id uuid,
  loser_intake_id uuid,
  loser_matter_number text,
  loser_name text,
  loser_relationship_status text,
  -- {"table.column": rows} — what moved, and what stayed on the archived row.
  rows_moved jsonb not null default '{}'::jsonb,
  rows_left jsonb not null default '{}'::jsonb,
  drafting_moved boolean not null default false,
  reason text,
  merged_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists matter_merges_winner_idx on public.matter_merges (winner_matter_id);
create index if not exists matter_merges_loser_idx on public.matter_merges (loser_matter_id);

alter table public.matter_merges enable row level security;

drop policy if exists matter_merges_staff_select on public.matter_merges;
create policy matter_merges_staff_select
  on public.matter_merges for select to authenticated
  using (exists (
    select 1 from public.users u
    where u.id = (select auth.uid()) and u.role in ('attorney', 'admin')
  ));

grant select on public.matter_merges to authenticated;
revoke insert, update, delete on public.matter_merges from authenticated;

-- ── The kept matter's activity says what was merged into it ─────────────────
--
-- Widened rather than reusing matter_corrected: a merge is its own kind of
-- event. Additive — every existing row satisfies the new list.

alter table public.matter_activity
  drop constraint if exists matter_activity_event_type_check;

alter table public.matter_activity
  add constraint matter_activity_event_type_check check (
    event_type = any (array[
      'stage_changed', 'note_added', 'document_uploaded', 'document_viewed',
      'document_downloaded', 'task_created', 'task_completed', 'flag_added',
      'flag_removed', 'alert_created', 'alert_resolved', 'intake_sent',
      'intake_completed', 'email_sent', 'sms_sent', 'sms_received',
      'draft_generated', 'draft_promoted_to_review', 'matter_created',
      'matter_archived', 'status_changed', 'sla_anchor_set', 'invoice_issued',
      'invoice_paid', 'matter_corrected',
      'matter_merged'
    ])
  );

-- ── Moving one column's rows ────────────────────────────────────────────────
--
-- Tries the whole set in one statement. If any row collides with a unique key
-- (or a guard trigger refuses it), falls back to row by row so everything that
-- can move does, and reports the rest rather than failing the merge.

create or replace function public.merge_move_column(
  p_table regclass,
  p_column text,
  p_from text,
  p_to text,
  out moved integer,
  out left_behind integer
)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_type text;
  v_ctid tid;
begin
  moved := 0;
  left_behind := 0;

  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid = p_table and a.attname = p_column and not a.attisdropped;
  if v_type is null then
    return;
  end if;

  begin
    execute format('update %s set %I = $1::%s where %I = $2::%s', p_table, p_column, v_type, p_column, v_type)
      using p_to, p_from;
    get diagnostics moved = row_count;
    return;
  exception when others then
    moved := 0;
  end;

  for v_ctid in
    execute format('select ctid from %s where %I = $1::%s', p_table, p_column, v_type) using p_from
  loop
    begin
      execute format('update %s set %I = $1::%s where ctid = $2', p_table, p_column, v_type)
        using p_to, v_ctid;
      moved := moved + 1;
    exception when others then
      left_behind := left_behind + 1;
    end;
  end loop;
end
$$;

revoke all on function public.merge_move_column(regclass, text, text, text) from public, anon, authenticated;

-- ── The merge ───────────────────────────────────────────────────────────────

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
