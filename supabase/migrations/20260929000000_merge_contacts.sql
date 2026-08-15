-- Step 6 of docs/matter-contacts-migration.md: collapse two rows that are the
-- same human.
--
-- The join stops *new* duplicates. It does nothing about the ones already in
-- the data — the second copy every returning client got before step 5, and any
-- self contact step 1 minted beside a household that already stored its client
-- as a contact (§3's last audit query).
--
-- Merging is destructive in a way the rest of this migration is not, so:
--   • the loser is tombstoned, never deleted, and the merge is reversible;
--   • every merge is written to a log that outlives the rows;
--   • candidates are proposed automatically on exact email match but merged
--     only when a human says so (decision §12.4).

-- ── Tombstone ───────────────────────────────────────────────────────────────

alter table public.contacts
  add column if not exists merged_into_id uuid references public.contacts(id) on delete set null,
  add column if not exists merged_at timestamptz;

create index if not exists contacts_merged_into_idx
  on public.contacts (merged_into_id) where merged_into_id is not null;

comment on column public.contacts.merged_into_id is
  'Set when this row was merged into another person. The row is kept rather than '
  'deleted so a bad merge is reversible and any link that still points here resolves.';

-- ── The log ─────────────────────────────────────────────────────────────────
--
-- Same idea as matter_deletions (20260923000000): no foreign keys, so it stays
-- readable whatever later happens to the rows, and it records who did it.

create table if not exists public.contact_merges (
  id uuid primary key default gen_random_uuid(),
  winner_contact_id uuid not null,
  loser_contact_id uuid not null,
  -- Enough of the loser to recognise them after the fact.
  loser_first_name text,
  loser_last_name text,
  loser_email text,
  -- What the merge actually moved, so an unexpected result can be understood
  -- without replaying it.
  matter_links_moved integer not null default 0,
  roles_moved integer not null default 0,
  messages_moved integer not null default 0,
  design_sheets_rewritten integer not null default 0,
  reason text,
  merged_by uuid,
  created_at timestamptz not null default now()
);

alter table public.contact_merges enable row level security;

drop policy if exists "attorneys_read_contact_merges" on public.contact_merges;
create policy "attorneys_read_contact_merges"
  on public.contact_merges for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin')));

-- ── Rewriting contact ids inside design sheets ──────────────────────────────
--
-- Design sheets store contact ids in jsonb, and §8 of the migration doc lists
-- where: ten `*_slots` arrays of objects, `remote_beneficiary_individuals` and
-- the HIPAA agent arrays as bare id strings, `excluded_guardians` as objects —
-- and `fiduciary_contact_details` / `fiduciary_document_inclusions` keyed *by*
-- contact id. Those last two are the trap: a rewrite that only replaces values
-- silently misses them, and the fiduciary's details reattach to nobody.
--
-- Rather than enumerate ~15 paths and be wrong when a new one appears, this
-- walks the document and replaces the id wherever it occurs, as a value or as
-- an object key. Contact ids are UUIDs, so a false positive would require a
-- collision.

create or replace function public.jsonb_replace_id(
  doc jsonb,
  from_id text,
  to_id text
)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb;
  item jsonb;
  entry record;
  new_key text;
begin
  if doc is null then
    return null;
  end if;

  case jsonb_typeof(doc)
    when 'object' then
      result := '{}'::jsonb;
      for entry in select key, value from jsonb_each(doc) loop
        new_key := case when entry.key = from_id then to_id else entry.key end;
        -- When both keys are present the winner's entry wins; the loser's is
        -- dropped rather than clobbering it.
        if result ? new_key and entry.key = from_id then
          continue;
        end if;
        result := result || jsonb_build_object(
          new_key,
          public.jsonb_replace_id(entry.value, from_id, to_id)
        );
      end loop;
      return result;
    when 'array' then
      result := '[]'::jsonb;
      for item in select value from jsonb_array_elements(doc) loop
        result := result || jsonb_build_array(public.jsonb_replace_id(item, from_id, to_id));
      end loop;
      return result;
    when 'string' then
      return case when doc #>> '{}' = from_id then to_jsonb(to_id) else doc end;
    else
      return doc;
  end case;
end
$$;

comment on function public.jsonb_replace_id(jsonb, text, text) is
  'Replace a UUID everywhere it appears in a jsonb document — as a value and as '
  'an object key. Used to repoint design-sheet contact references on merge.';

-- ── The merge ───────────────────────────────────────────────────────────────

create or replace function public.merge_contacts(
  p_winner_id uuid,
  p_loser_id uuid,
  p_reason text default null,
  p_actor_id uuid default null
)
RETURNS TABLE (
  matter_links_moved integer,
  roles_moved integer,
  messages_moved integer,
  design_sheets_rewritten integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_winner public.contacts;
  v_loser  public.contacts;
  v_links  integer := 0;
  v_roles  integer := 0;
  v_msgs   integer := 0;
  v_sheets integer := 0;
  v_moved  integer;
  v_col    text;
  v_sql    text;
  v_touched uuid[];
  v_sheet_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING errcode = '42501';
  END IF;

  IF p_winner_id = p_loser_id THEN
    RAISE EXCEPTION 'Cannot merge a contact into itself' USING errcode = '22023';
  END IF;

  SELECT * INTO v_winner FROM public.contacts WHERE id = p_winner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Winner % not found', p_winner_id USING errcode = '22023'; END IF;
  SELECT * INTO v_loser FROM public.contacts WHERE id = p_loser_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Loser % not found', p_loser_id USING errcode = '22023'; END IF;

  -- Merging a tombstone, or into one, would build a chain nothing resolves.
  IF v_winner.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'Winner % has itself been merged away', p_winner_id USING errcode = '22023';
  END IF;
  IF v_loser.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'Loser % has already been merged', p_loser_id USING errcode = '22023';
  END IF;

  -- ── Matters ──────────────────────────────────────────────────────────────
  -- Where both are already on a matter, the winner's row stands and the
  -- loser's is dropped: repointing would violate (matter_id, contact_id).
  DELETE FROM public.matter_contacts loser_link
  WHERE loser_link.contact_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.matter_contacts winner_link
      WHERE winner_link.matter_id = loser_link.matter_id
        AND winner_link.contact_id = p_winner_id
    );

  UPDATE public.matter_contacts SET contact_id = p_winner_id WHERE contact_id = p_loser_id;
  GET DIAGNOSTICS v_links = ROW_COUNT;

  -- ── Appointments ─────────────────────────────────────────────────────────
  -- Same shape: an identical appointment held by both collapses to one.
  DELETE FROM public.contact_roles loser_role
  WHERE loser_role.contact_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.contact_roles winner_role
      WHERE winner_role.contact_id = p_winner_id
        AND winner_role.matter_id IS NOT DISTINCT FROM loser_role.matter_id
        AND winner_role.role = loser_role.role
        AND winner_role.for_party = loser_role.for_party
        AND winner_role.priority = loser_role.priority
        AND winner_role.is_coagent = loser_role.is_coagent
    );

  UPDATE public.contact_roles SET contact_id = p_winner_id WHERE contact_id = p_loser_id;
  GET DIAGNOSTICS v_roles = ROW_COUNT;

  -- ── Communications ───────────────────────────────────────────────────────
  UPDATE public.sms_messages SET contact_id = p_winner_id WHERE contact_id = p_loser_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT; v_msgs := v_msgs + v_moved;

  UPDATE public.calls SET contact_id = p_winner_id WHERE contact_id = p_loser_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT; v_msgs := v_msgs + v_moved;

  IF to_regclass('public.email_log') IS NOT NULL THEN
    UPDATE public.email_log SET contact_id = p_winner_id WHERE contact_id = p_loser_id;
    GET DIAGNOSTICS v_moved = ROW_COUNT; v_msgs := v_msgs + v_moved;
  END IF;

  -- The CRM mirror is unique on contact_id, so the loser's row is dropped
  -- rather than repointed onto the winner's.
  DELETE FROM public.cornerstone_crm_people WHERE contact_id = p_loser_id;

  -- ── Design sheets ────────────────────────────────────────────────────────
  -- Every jsonb column, discovered rather than listed, so a column added later
  -- is covered without anyone remembering this function exists.
  FOR v_col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'design_sheets' AND data_type = 'jsonb'
  LOOP
    -- Ids collected rather than row counts summed: a sheet naming the loser in
    -- two columns is updated twice, and reporting that as two sheets would read
    -- as a wider blast radius than the merge actually had.
    v_sql := format(
      'WITH updated AS ('
      '  UPDATE public.design_sheets SET %1$I = public.jsonb_replace_id(%1$I, $1, $2) '
      '  WHERE %1$I IS NOT NULL AND %1$I::text LIKE ''%%'' || $1 || ''%%'' '
      '  RETURNING id'
      ') SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) FROM updated',
      v_col
    );
    EXECUTE v_sql USING p_loser_id::text, p_winner_id::text INTO v_touched;
    v_sheet_ids := v_sheet_ids || v_touched;
  END LOOP;

  SELECT count(DISTINCT s) INTO v_sheets FROM unnest(v_sheet_ids) AS s;

  -- ── Tombstone ────────────────────────────────────────────────────────────
  -- Kept, not deleted: a merge that turns out to be wrong is undone by clearing
  -- these two columns and re-linking, and any stale reference still resolves to
  -- a row that says where the person went.
  UPDATE public.contacts
  SET merged_into_id = p_winner_id,
      merged_at = now(),
      client_intake_id = NULL
  WHERE id = p_loser_id;

  INSERT INTO public.contact_merges (
    winner_contact_id, loser_contact_id, loser_first_name, loser_last_name,
    loser_email, matter_links_moved, roles_moved, messages_moved,
    design_sheets_rewritten, reason, merged_by
  ) VALUES (
    p_winner_id, p_loser_id, v_loser.first_name, v_loser.last_name,
    v_loser.email, v_links, v_roles, v_msgs, v_sheets, p_reason, p_actor_id
  );

  RETURN QUERY SELECT v_links, v_roles, v_msgs, v_sheets;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid, text, uuid) TO service_role;

-- ── Candidates ──────────────────────────────────────────────────────────────
--
-- Exact, case-insensitive email match only (decision §12.4). Deliberately not
-- name similarity: a father and son sharing a name would pair constantly.
--
-- Even on email this only *proposes*. A couple sharing an inbox is the obvious
-- false positive, and it is common enough that nothing here merges on its own.
-- Self contacts are ranked first as winners, since they are the row the join
-- and the write-through triggers already treat as the person.

create or replace view public.contact_merge_candidates as
with live as (
  select
    c.id,
    lower(btrim(c.email)) as email_key,
    c.first_name, c.last_name, c.email, c.relationship_type, c.created_at,
    (select count(*) from public.matter_contacts mc where mc.contact_id = c.id) as matter_count
  from public.contacts c
  where c.merged_into_id is null
    and c.email is not null
    and btrim(c.email) <> ''
    and coalesce(c.deceased, false) = false
)
select
  winner.id   as winner_contact_id,
  loser.id    as loser_contact_id,
  winner.email_key as email,
  winner.first_name as winner_first_name,
  winner.last_name  as winner_last_name,
  winner.matter_count as winner_matter_count,
  loser.first_name  as loser_first_name,
  loser.last_name   as loser_last_name,
  loser.matter_count as loser_matter_count,
  -- The signal a reviewer most needs: same email but different names is very
  -- often a couple, not a duplicate.
  (lower(coalesce(winner.last_name, '')) = lower(coalesce(loser.last_name, ''))
     and lower(coalesce(winner.first_name, '')) = lower(coalesce(loser.first_name, ''))) as names_match
from live winner
join live loser
  on loser.email_key = winner.email_key
 and loser.id <> winner.id
-- One row per pair, and the better-connected row is the winner.
where (winner.relationship_type = 'self') > (loser.relationship_type = 'self')
   or (
     (winner.relationship_type = 'self') = (loser.relationship_type = 'self')
     and (winner.matter_count, winner.created_at, winner.id) > (loser.matter_count, loser.created_at, loser.id)
   );

comment on view public.contact_merge_candidates is
  'Pairs of live contacts sharing an email, most-connected first as the proposed '
  'winner. Proposals only — nothing merges without a human, because a couple '
  'sharing an inbox looks exactly like a duplicate.';

notify pgrst, 'reload schema';
