-- One transaction that corrects a matter and records that it did.
--
-- PostgREST cannot run a multi-statement transaction, so a client that updates
-- `matters` and then inserts `matter_activity` can fail between the two and
-- leave a change nobody can trace. Three matters were renamed by hand on
-- 2026-09-09 and are in exactly that state: the old names survive only because
-- the archived identity tasks happen to quote them.
--
-- The guardrails are here rather than in the calling server so they hold for
-- every caller.

create or replace function public.correct_matter(
  p_matter_id uuid,
  p_expect jsonb,
  p_set jsonb,
  p_reason text
)
returns public.matters
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_before public.matters;
  v_after public.matters;
  v_key text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required: it is the only record of why this changed';
  end if;

  -- Both must be non-empty here, not only in the caller. An empty p_set is a
  -- write that reports success and changes nothing; an empty p_expect is the
  -- concurrency check silently opting itself out.
  if p_set is null or p_set = '{}'::jsonb then
    raise exception 'Nothing to set';
  end if;
  if p_expect is null or p_expect = '{}'::jsonb then
    raise exception 'p_expect is required: state the value you read, so a stale read is refused rather than applied';
  end if;

  select * into v_before from public.matters where id = p_matter_id;
  if not found then
    raise exception 'No matter %', p_matter_id;
  end if;

  -- Only these three are corrigible. `stage` and `relationship_status` are
  -- absent by construction: they have validation triggers, they write history
  -- tables, and trg_matters_fire_stage_prompts enqueues real drafting runs on a
  -- stage change. An agent tripping that by accident is a far worse failure
  -- than a wrong title.
  for v_key in select jsonb_object_keys(p_set) loop
    if v_key not in ('name', 'matter_number', 'matter_type') then
      raise exception 'Field % cannot be corrected through this function', v_key;
    end if;
  end loop;

  -- Optimistic concurrency. The caller states what it believes it read; a
  -- mismatch means the read is stale and the write would clobber whatever
  -- changed in between.
  for v_key in select jsonb_object_keys(p_expect) loop
    if to_jsonb(v_before) -> v_key is distinct from p_expect -> v_key then
      raise exception 'Stale read on %: expected %, found %',
        v_key, p_expect -> v_key, to_jsonb(v_before) -> v_key;
    end if;
  end loop;

  -- coalesce means a key absent from p_set is left alone, and it also means
  -- this function cannot set a field to null. That is deliberate: clearing
  -- matter_number is not a correction, and a tool that could do it by omission
  -- would do it by accident.
  update public.matters set
    name          = coalesce(p_set ->> 'name', name),
    matter_number = coalesce(p_set ->> 'matter_number', matter_number),
    matter_type   = coalesce(p_set ->> 'matter_type', matter_type)
  where id = p_matter_id
  returning * into v_after;

  -- Same transaction as the update. This is the whole reason the correction is
  -- a function rather than two client calls.
  --
  -- matter_id is text on this table while matters.id is uuid, so the cast is
  -- required, not stylistic. RLS on matter_activity allows staff inserts only;
  -- a security definer function runs as owner and is not subject to it.
  --
  -- actor_id and actor_email stay null: an MCP call has no auth.uid(), and
  -- inventing one would be worse than an honest null beside the actor_name.
  insert into public.matter_activity (matter_id, event_type, actor_name, title, detail, metadata)
  values (
    p_matter_id::text,
    'matter_corrected',
    'matters-mcp',
    'Matter corrected',
    p_reason,
    jsonb_build_object(
      'before', (select jsonb_object_agg(k, to_jsonb(v_before) -> k) from jsonb_object_keys(p_set) k),
      'after',  (select jsonb_object_agg(k, to_jsonb(v_after)  -> k) from jsonb_object_keys(p_set) k)
    )
  );

  return v_after;
end;
$$;

comment on function public.correct_matter(uuid, jsonb, jsonb, text) is
  'Correct a matter''s name, matter_number or matter_type and record it in matter_activity, in one transaction. Refuses a stale p_expect, an empty p_set, an empty reason, and any field outside the three.';

-- The service role only. This bypasses RLS by design and must not be reachable
-- from a browser session.
revoke all on function public.correct_matter(uuid, jsonb, jsonb, text) from public;
revoke all on function public.correct_matter(uuid, jsonb, jsonb, text) from authenticated;
grant execute on function public.correct_matter(uuid, jsonb, jsonb, text) to service_role;

-- PostgREST resolves functions from a cached schema and will answer PGRST202
-- for a brand-new one until it reloads.
notify pgrst, 'reload schema';
