# A cornerstone-native matters MCP server

**Date:** 2026-09-09
**Status:** approved, ready for an implementation plan

## Why

An agent correcting matter data today has no safe tool. The `aubreylaw-matters`
MCP server that is registered looks like one and is not: it belongs to a
different application with a different schema.

| | `aubreylaw-matters` | cornerstone `public.matters` |
| --- | --- | --- |
| identity | `matter_number`, `title` | `name` |
| state | `status` (`lead`→`closed`) | `stage` (17 values) + `relationship_status` (4) + `status` (4) |
| other | `type`, `mike_project_id`, `opened_at` | `client_intake_id`, `track`, `revision_round`, … |

They share `id` and the timestamps. Its `DATABASE_URL` points at
`postgres://matters@127.0.0.1:54323/matters`, a Postgres 16 container from that
repo's own `docker-compose.yml`, and it has no deployment. Repointing that URL
at cornerstone would make `update_matter` fail on a missing `title` column and
would make `create_matter` attempt to insert `matter_number`/`type`/`status`
rows into the real matters table.

So this is a new server, not a configuration change.

**What prompted it.** On 2026-09-09 three matters were found filed under the
wrong person's name — the design sheet and every linked contact agreed with each
other and only the matter title disagreed. Correcting them meant hand-written
SQL against production: five exploratory queries to find the right column names
(`matter_contacts.role`, `contacts.full_name`, `public.documents` and
`signing_ceremonies.scheduled_at` all turned out not to exist), a catalog read of
all ten triggers on `matters` to confirm none fire on a rename, and a
rolled-back dry run. That is the right level of care for three rows and the
wrong thing to repeat.

It also left no audit trail. The three renames wrote nothing to
`matter_activity`; the old names survive only because the archived identity
tasks happen to quote them in their titles. There is no history table for
`name` — only `matter_stage_history` and
`matter_relationship_status_history`.

## Scope

Agent data corrections. Not party data for drafting sessions, and not a general
matters API. Three tools, one new RPC.

## Architecture

`tools/matters-mcp/`, a new npm workspace beside `tools/workflows` and
`tools/aubreylaw-docgeneration`, named `@aubrey-law/matters-mcp`. A stdio MCP
server at `src/stdio.ts`, registered in `~/.claude.json` in place of the
`aubreylaw-matters` entry.

It depends on `@aubrey-law/db-types` — the shared generated schema
(`packages/db-types/src/supabase.generated.ts`, 11,551 lines, covering `matters`
and `matter_activity`) that `apps/workbench/lib/supabase/database.ts` already
re-exports as `WorkbenchDatabase`. Every column and RPC it touches is
typechecked, and CI's *Generated types match the database* keeps the types
honest against the real schema.

Transport to Supabase is the JS client with the service key over PostgREST — the
same client the workbench uses.

### Why the guardrails live in the database

PostgREST cannot run a multi-statement transaction. A server that updates
`matters` and then inserts `matter_activity` can fail between the two and leave
an unaudited change — precisely the state the three renames are in now.

So the correction is a single `security definer` RPC. This follows the repo's
existing idiom (`claim_workflow_run`, `claim_prompt_stage_trigger`,
`ensure_user_profile`), including `set search_path = pg_catalog, public`.

Putting the rules there rather than in the server means they hold for **every**
caller, not only this one. The server becomes thin enough that its own bugs
cannot produce an illegal write.

## The RPC

```sql
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
  -- concurrency check silently opting itself out. Neither may depend on a
  -- client remembering to refuse them.
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
  -- absent by construction, not by check: they have validation triggers, they
  -- write history tables, and `trg_matters_fire_stage_prompts` enqueues real
  -- drafting runs on a stage change. An agent tripping that by accident is a
  -- far worse failure than a wrong title.
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

  update public.matters set
    name         = coalesce(p_set ->> 'name', name),
    matter_number = coalesce(p_set ->> 'matter_number', matter_number),
    matter_type  = coalesce(p_set ->> 'matter_type', matter_type)
  where id = p_matter_id
  returning * into v_after;

  -- Same transaction as the update. This is the whole reason the correction is
  -- a function rather than two client calls.
  --
  -- `matter_id` is text on this table while `matters.id` is uuid, so the cast
  -- is required, not stylistic. RLS on matter_activity allows staff inserts
  -- only; a security definer function runs as owner and is not subject to it.
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
```

`p_expect` is **required and non-empty**, checked in the function itself and
again in the server so the round trip is skipped. Making it optional would make
the safe path the one you have to remember.

`coalesce` on each field means a key absent from `p_set` is left alone, and it
also means **this function cannot set a field to null**. That is deliberate:
clearing `matter_number` or `matter_type` is not a correction, and a tool that
could do it by omission would be a tool that does it by accident. If clearing is
ever wanted it needs its own explicit argument, not a null slipped through
`p_set`.

`event_type` is free text on this table; existing values are snake_case verbs
(`stage_changed`, `matter_created`, `draft_generated`), and `matter_corrected`
joins them. `actor_id`/`actor_email` stay null: an MCP call has no `auth.uid()`,
and inventing one would be worse than an honest null beside
`actor_name = 'matters-mcp'`.

## The tools

### `list_matters`

Optional `relationship_status`, `stage`, and `name_contains`. Returns `id`,
`name`, `matter_number`, `stage`, `relationship_status`, capped at 100 rows with
the count of any remainder, so a broad call degrades into a narrower question
rather than a wall of client names.

### `get_matter`

One call returning what a correction decision actually needs:

- the matter: `id`, `name`, `matter_number`, `stage`, `relationship_status`, `status`, `matter_type`
- its **latest** design sheet (`max(version)`): `client_name`, `spouse_name`
- its contacts: `relationship_type`, `relationship_label`, and the assembled name from `first_name`/`middle_name`/`last_name`, plus `preferred_name` where set

That join is the deliverable. It is what took five queries by hand, and it is
what makes a disagreement visible in one look: on `e543cdd7` the sheet said
Matteo Lorenzo Neretti, the `self` contact agreed, and Veronica Pace — whose
name was on the matter — was linked as `mother`.

`relationship_type` is reported verbatim, including the three rows that say
`client` where the other 97 say `self`. Normalising it here would hide a real
data inconsistency behind a tool that exists to find them.

### `correct_matter`

```ts
correct_matter({
  matter_id: string,
  expect: { name?: string; matter_number?: string; matter_type?: string },  // required, non-empty
  set:    { name?: string; matter_number?: string; matter_type?: string },  // required, non-empty
  reason: string,                                                            // required, non-empty
})
```

Calls the RPC and returns the updated row. Every rule above is enforced in the
database; the server's own validation exists only to give a better message
before the round trip.

## Errors

Every failure returns its reason as text. No silent no-ops — a tool that reports
success while changing nothing is the failure mode this whole design is
guarding against.

| condition | response |
| --- | --- |
| stale `expect` | names the field, quotes both values |
| unknown matter | says so with the id |
| disallowed field in `set` | names the field and that it is not corrigible here |
| CHECK violation | surfaces the constraint name (`matters_matter_type_check`) |
| `PGRST202` | says the RPC is missing from PostgREST and to check the catalog, **not** `supabase_migrations.schema_migrations` — this project has had a migration recorded as applied whose body never ran, which is exactly how `update_lead_opportunity_field` went missing in production |

## A CI gap this introduces

`scripts/checkDbRpcs.mjs` cross-checks every RPC the code calls against
PostgREST's OpenAPI document. Its `SOURCE_DIRS` are `app`, `lib`, `components`,
`apps/workbench/app`, `apps/workbench/lib`. A `tools/` directory is invisible to
it, so `correct_matter` would be the one RPC in the repo nobody verifies — the
precise failure that script was written for.

**`tools/matters-mcp/src` is added to `SOURCE_DIRS` as part of this work.** Not a
follow-up.

## Testing

**Tool layer** — unit tests against a fake Supabase client, in
`tools/matters-mcp/tests/`: argument validation, the empty-`expect` refusal, the
`get_matter` join assembling sheet and contacts into one shape, and each error
message.

**The RPC** — exercised against the real database inside a **rolled-back
transaction**, which is this repo's rule for proving trigger and constraint
behaviour rather than editing and restoring client data:

1. a valid correction updates the row **and** writes exactly one
   `matter_activity` row carrying before and after
2. a stale `expect` raises and leaves both tables untouched
3. an empty `reason` raises
4. an empty or absent `p_expect` raises — the check cannot opt itself out
5. an empty `p_set` raises rather than succeeding with nothing changed
6. `p_set` containing `stage` raises, and the stage is unchanged
7. an unknown `matter_id` raises

Cases 3–5 are called **directly against the function**, bypassing the server's
own copies of those checks. A test that reaches them through the tool layer
would pass with the database enforcing nothing.

Each is written to fail first against the absent function, so the test is known
to be capable of failing before the function exists to satisfy it.

## Out of scope

Creating matters, deleting matters, contact mutation, stage and relationship
transitions, and anything touching design sheets. Each is a real capability and
none is needed to correct a wrong name; adding them now would widen the blast
radius of a tool whose entire value is that it is narrow.

## Follow-up noted, not designed here

The name-agreement sweep has no way to record that a matter's title is
deliberately different from its sheet client. Every such matter is re-flagged
every minute, forever. All three found so far were genuine errors, so nothing is
broken today — but the first deliberate case will need a suppression mechanism,
and `correct_matter` is not it.
