-- Repair merge_contacts (20260929000000), which has never completed a merge.
--
-- It repointed `public.calls.contact_id`, a column production never had, so
-- every call failed with 42703 and rolled back — the review page's Merge button
-- only ever returned "column contact_id does not exist". It also missed two
-- tables that did gain a contact reference later (email_triage_threads,
-- email_inbound_messages).
--
-- The fix stops listing the plain references by hand. Every single-column
-- foreign key onto contacts is discovered from the catalog and repointed, so a
-- table that gains one later is covered without anyone remembering this
-- function. Only the references that need more than an UPDATE stay explicit:
-- matter_contacts and contact_roles (unique keys that collide when both people
-- are on the same matter) and the CRM mirror (unique on contact_id).
--
-- The candidate view is reshaped too. It listed every pair within an email
-- group, so one person entered 108 times produced 5,778 rows and the page,
-- capped at 200, showed an arbitrary slice of one family. It now pairs each
-- copy with the single row that would be kept: n - 1 rows per group.

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
  v_ref    record;
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

  -- The CRM mirror is unique on contact_id, so the loser's row is dropped
  -- rather than repointed onto the winner's.
  DELETE FROM public.cornerstone_crm_people WHERE contact_id = p_loser_id;

  -- ── Everything else that points at a contact ─────────────────────────────
  -- Messages, email threads, inbound mail, and earlier tombstones that were
  -- merged into the loser (so a chain collapses onto the survivor rather than
  -- ending at a row that has itself been merged away).
  FOR v_ref IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.contacts'::regclass
      AND array_length(c.conkey, 1) = 1
      AND c.conrelid NOT IN (
        'public.matter_contacts'::regclass,
        'public.contact_roles'::regclass,
        'public.cornerstone_crm_people'::regclass
      )
  LOOP
    EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', v_ref.tbl, v_ref.col, v_ref.col)
      USING p_winner_id, p_loser_id;
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    IF v_ref.tbl <> 'public.contacts'::regclass THEN
      v_msgs := v_msgs + v_moved;
    END IF;
  END LOOP;

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

-- ── Candidates: one row per copy, paired with the row that would be kept ────
--
-- Same columns as before, so the API reads it unchanged. The kept row is
-- chosen as before: a self contact first, then the most matters, then the
-- newest.

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
),
ranked as (
  select
    live.*,
    row_number() over (
      partition by email_key
      order by (relationship_type = 'self') desc nulls last,
               matter_count desc, created_at desc, id desc
    ) as rank
  from live
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
from ranked winner
join ranked loser
  on loser.email_key = winner.email_key
 and loser.rank > 1
where winner.rank = 1;

comment on view public.contact_merge_candidates is
  'Each live contact that shares an email with another, paired with the one row '
  'per email that would be kept. Proposals only — nothing merges without a '
  'human, because a couple sharing an inbox looks exactly like a duplicate.';

notify pgrst, 'reload schema';
