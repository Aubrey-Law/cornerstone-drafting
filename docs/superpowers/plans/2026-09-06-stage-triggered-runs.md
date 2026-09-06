# Stage-Triggered Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A matter entering `design` or `drafting` audits itself, and an unresolved blocker is visible without anyone having gone looking for it.

**Architecture:** A Postgres trigger on `matters.stage` records a signal per prompt that declares it fires on the stage entered. The existing tick claims one signal per invocation and materialises it into a queued run through `runMatterAudit` — the same path the screen uses — after which nothing new is needed to finish it. An unresolved blocker is a `severity = 'blocker'` finding with `disposition = 'open'`, surfaced on `/prompts`. **A transition is never blocked.**

**Tech Stack:** Next.js 16 App Router, Supabase Postgres with plpgsql triggers and RLS, vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-stage-triggered-runs-design.md`

---

## File structure

**`supabase/migrations/`**
- `20261103000000_stage_triggered_runs.sql` — the column, the table, the trigger, the claim RPC
- `20261103010000_fire_design_sheet_audit.sql` — turns firing on for the one prompt

**`apps/workbench/lib/runs/`**
- `triggers.ts` (new) — `materialiseTrigger`, and the pure decision about what a failure means
- `advisory.ts` (new) — `loadUnresolvedBlockers`

**`apps/workbench/lib/fieldAudit/`**
- `run.ts` (modify) — accepts a system-fired run with no actor, and an optional poke

**`apps/workbench/app/api/cron/tick/`**
- `route.ts` (modify) — claims a trigger before claiming a run

**`apps/workbench/app/prompts/`**
- `page.tsx`, `PromptsWorkspace.tsx` (modify) — the advisory section

---

## Task 1: The migration

**Files:**
- Create: `supabase/migrations/20261103000000_stage_triggered_runs.sql`
- Test: `apps/workbench/tests/stage-trigger-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Follow `apps/workbench/tests/run-queue-schema.test.ts` for its idiom.

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261103000000_stage_triggered_runs.sql'),
  'utf8',
)

describe('the stage-trigger migration', () => {
  it('lets a prompt declare which stage entries fire it, firing none by default', () => {
    // Empty by default is what makes this safe to deploy: the two prompts
    // that already exist keep behaving exactly as they do until told
    // otherwise, in a separate migration.
    expect(sql).toMatch(/fires_on_stage_entry text\[\] not null default '\{\}'/)
  })

  it('fires AFTER the update, not before', () => {
    // `stage_entered_at` is set by a BEFORE trigger (20260711000000). A
    // BEFORE trigger here would read the previous entry's timestamp, reuse
    // its de-duplication key, and silently suppress the re-audit this
    // exists to allow.
    expect(sql).toMatch(/after update of stage on public\.matters/)
    expect(sql).not.toMatch(/before update of stage on public\.matters/)
  })

  it('cannot record the same stage entry twice', () => {
    expect(sql).toMatch(/unique \(matter_id, prompt_id, stage_entered_at\)/)
  })

  it('claims a trigger without two ticks getting the same one', () => {
    expect(sql).toMatch(/for update skip locked/)
    expect(sql).toMatch(/create or replace function public\.claim_prompt_stage_trigger/)
  })

  it('runs the claim as its definer with a pinned search path', () => {
    expect(sql).toMatch(/security definer set search_path = pg_catalog, public/)
  })

  it('protects the new table with row level security', () => {
    expect(sql).toContain('alter table public.prompt_stage_triggers enable row level security')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/stage-trigger-schema.test.ts`
Expected: FAIL — ENOENT.

- [ ] **Step 3: Write the migration**

Read `supabase/migrations/20261031000000_run_queue.sql` first — the claim RPC here follows
`claim_workflow_run` exactly, including the pinned `search_path` and the
`revoke`/`grant execute to service_role` pair. Match the comment register of
`20261030000000_run_steps.sql`.

```sql
-- A matter entering a stage audits itself.
--
-- A prompt that only runs when someone opens /prompts and picks a matter runs
-- on the matters someone already suspected. Firing on a stage entry is what
-- makes a prompt library something the firm's process applies rather than
-- something an attorney has to remember.
--
-- The trigger hangs off `matters.stage` rather than off the route that writes
-- it. transition_matter_stage_with_jobs (20261004000000) and the root app's
-- PATCH /api/admin/matters/[id]/stage both work today, and both are in the app
-- phase 15 deletes. A trigger on the column fires whichever app wrote the
-- change, and keeps firing when only one app is left.
--
-- What it records is a signal, not a run. Creating a run means resolving a
-- prompt's declared inputs against an allow-list and writing one pending step
-- per unit -- app logic with a zod schema behind it, not something to
-- reimplement here. The tick turns the signal into a run.

alter table public.prompts
  -- Which stage entries fire this prompt. Deliberately not `stages`, which
  -- means "offer this prompt for a matter at these stages": a large library
  -- will hold prompts worth offering at a stage but not worth a model call on
  -- every entry to it, and one column carrying both meanings cannot say so.
  --
  -- Empty by default, so nothing begins running on its own until a later
  -- migration says which prompt should.
  add column if not exists fires_on_stage_entry text[] not null default '{}';

create table if not exists public.prompt_stage_triggers (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  prompt_id uuid not null references public.prompts(id) on delete cascade,

  to_stage text not null,

  -- The matter's stage_entered_at at the moment of firing. Part of the
  -- uniqueness below, and the reason this trigger must fire AFTER the update:
  -- trg_matters_stage_entered_at (20260711000000) is a BEFORE trigger that
  -- sets this value, so an AFTER trigger sees the new one.
  stage_entered_at timestamptz not null,

  status text not null default 'pending'
    check (status = any (array['pending', 'claimed', 'done', 'skipped'])),

  -- The run this became, once it became one. Null while pending, and null
  -- forever for a trigger that was skipped.
  run_id uuid references public.workflow_runs(id) on delete set null,

  -- Why a trigger was skipped -- a matter with no design sheet, a required
  -- field nobody has filled in. A skip is not a failure and is recorded as
  -- neither.
  last_error text,

  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  settled_at timestamptz,

  -- Two writes of the same stage in one transition cannot fire twice. A
  -- matter genuinely re-entering `drafting` next week has a new
  -- stage_entered_at and does re-audit, which is the behaviour worth having:
  -- a sheet that has changed deserves a fresh look.
  unique (matter_id, prompt_id, stage_entered_at)
);

create index if not exists prompt_stage_triggers_pending_idx
  on public.prompt_stage_triggers (status, created_at)
  where status = 'pending';

comment on table public.prompt_stage_triggers is
  'One row per prompt that a matter''s stage entry fired. A signal the tick turns into a run; never a run itself.';

create or replace function public.trg_matters_fire_stage_prompts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.prompt_stage_triggers (matter_id, prompt_id, to_stage, stage_entered_at)
  select new.id, p.id, new.stage, new.stage_entered_at
  from public.prompts p
  where new.stage = any (p.fires_on_stage_entry)
  on conflict (matter_id, prompt_id, stage_entered_at) do nothing;

  return null;
end $$;

drop trigger if exists trg_matters_fire_stage_prompts on public.matters;

-- AFTER, and the `when` clause matters as much as the timing: an update that
-- writes the same stage back is not a stage entry, and firing on it would
-- audit a matter every time any unrelated field on it was saved.
create trigger trg_matters_fire_stage_prompts
  after update of stage on public.matters
  for each row
  when (new.stage is distinct from old.stage)
  execute function public.trg_matters_fire_stage_prompts();

-- Claim exactly one pending trigger, atomically. Same reasoning as
-- claim_workflow_run in 20261031000000: PostgREST cannot express
-- `for update skip locked`, and without it two ticks in the same second would
-- materialise the same signal into two runs of the same prompt on the same
-- matter.
create or replace function public.claim_prompt_stage_trigger(p_worker text)
returns public.prompt_stage_triggers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_trigger public.prompt_stage_triggers;
begin
  with selected as (
    select id from public.prompt_stage_triggers
    where status = 'pending'
    order by created_at
    for update skip locked
    limit 1
  )
  update public.prompt_stage_triggers t
     set status = 'claimed',
         claimed_at = statement_timestamp()
    from selected
   where t.id = selected.id
  returning t.* into v_trigger;

  return v_trigger;
end $$;

revoke all on function public.claim_prompt_stage_trigger(text) from public, anon, authenticated;
grant execute on function public.claim_prompt_stage_trigger(text) to service_role;

alter table public.prompt_stage_triggers enable row level security;

drop policy if exists "Staff read stage triggers" on public.prompt_stage_triggers;
create policy "Staff read stage triggers" on public.prompt_stage_triggers
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Run to verify it passes**

Expected: PASS, 6 tests.

- [ ] **Step 5: Prove two assertions bite**

Change `after update of stage` to `before update of stage`, confirm that test fails, restore.
Then remove the `unique (...)` line, confirm that test fails, restore. Report both verbatim.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261103000000_stage_triggered_runs.sql apps/workbench/tests/stage-trigger-schema.test.ts
git commit -m "A stage entry records which prompts it fires"
```

**Do not apply this migration.** Someone with credentials applies it and regenerates the
types before Task 3.

---

## Task 2: A run can be fired by nobody

**Files:**
- Modify: `apps/workbench/lib/fieldAudit/run.ts`
- Test: `apps/workbench/tests/field-audit-run.test.ts` (existing)

`runMatterAudit` is already the whole path from "a prompt and a matter" to "a run is
queued". The tick's materialisation needs exactly that, with two differences.

- [ ] **Step 1: Write the failing test**

Add to `apps/workbench/tests/field-audit-run.test.ts`:

```ts
  it('opens a run with no actor when the stage engine fired it', async () => {
    // A trigger-fired run has no user behind it. `created_by` is nullable for
    // exactly this case, and inventing an actor would put a person's name on
    // something they did not do.
    const client = makeFakeClient({ /* … as the neighbouring tests build it … */ })
    const result = await runMatterAudit(client as never, {
      slug: 'ma-design-sheet-audit', matterId: 'matter-1', userId: null, poke: false,
    })
    expect(result.ok).toBe(true)
    const [run] = client.tableRows('workflow_runs') as Array<{ created_by: string | null }>
    expect(run.created_by).toBeNull()
  })

  it('pokes the tick by default, which is what the screen relies on', async () => {
    // Asserted first, because the next test asserts the absence of this and
    // an absence proves nothing unless the presence is proven too. With the
    // injection broken, `poke: false` would "pass" trivially.
    let poked = 0
    const client = makeFakeClient({ /* … */ })
    await runMatterAudit(client as never, {
      slug: 'ma-design-sheet-audit', matterId: 'matter-1', userId: 'user-1',
      pokeTick: async () => { poked += 1 },
    })
    expect(poked).toBe(1)
  })

  it('does not poke when it is already inside a tick', async () => {
    // The tick materialises a trigger and then works it in the same
    // invocation. Poking from there would ask a second tick to start for work
    // this one is about to do.
    let poked = 0
    const client = makeFakeClient({ /* … */ })
    await runMatterAudit(client as never, {
      slug: 'ma-design-sheet-audit', matterId: 'matter-1', userId: null, poke: false,
      pokeTick: async () => { poked += 1 },
    })
    expect(poked).toBe(0)
  })
```

Read the existing tests in that file for how they build the fake client, and reuse it.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — `userId: null` is a type error, `poke` is not accepted.

- [ ] **Step 3: Implement**

- `RunMatterAuditOptions.userId` becomes `string | null`. Comment why: a trigger-fired run has no actor, `workflow_runs.created_by` is nullable for that case, and naming one would attribute work to someone who did not do it.
- Add `poke?: boolean` defaulting `true`. When false, `pokeTick` is not called.
- Make the poke injectable (`pokeTick?: () => Promise<void>`) so the second test can observe it without a network call. Default to the real `pokeTick`.

- [ ] **Step 4: Run to verify it passes**

Then run the whole file — every existing test must still pass **unmodified**. `git diff` the
parts you did not add.

- [ ] **Step 5: Commit**

```bash
git add apps/workbench/lib/fieldAudit/run.ts apps/workbench/tests/field-audit-run.test.ts
git commit -m "A run can be fired by the stage engine rather than a person"
```

---

## Task 3: Materialising a trigger

**Prerequisite:** Task 1's migration applied and types regenerated. If
`prompt_stage_triggers` is absent from the generated types, **stop and report**.

**Files:**
- Create: `apps/workbench/lib/runs/triggers.ts`
- Test: `apps/workbench/tests/run-triggers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { settlementFor } from '@/lib/runs/triggers'

describe('what becomes of a claimed trigger', () => {
  it('is done, carrying its run, when a run opened', () => {
    expect(settlementFor({ ok: true, runId: 'run-1', queued: true }))
      .toEqual({ status: 'done', runId: 'run-1', lastError: null })
  })

  it('is skipped, not failed, when the design sheet cannot answer the prompt', () => {
    // A matter reaching `drafting` with an empty `concerns` field is not a run
    // that failed. It is a run that should not have started, and recording it
    // as a failure would make `failed_count` mean something else.
    expect(settlementFor({ ok: false, message: 'The design sheet is missing fields…' }))
      .toEqual({ status: 'skipped', runId: null, lastError: 'The design sheet is missing fields…' })
  })

  it('is skipped when the matter has no design sheet at all', () => {
    expect(settlementFor({ ok: false, message: 'That matter has no design sheet yet…' }).status)
      .toBe('skipped')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`settlementFor(result)` — pure, mapping `runMatterAudit`'s result to a settlement.

Then `materialiseStageTrigger(client, worker)`:

1. `claim_prompt_stage_trigger(worker)` — and **guard on the id, not falsiness**. A composite-returning plpgsql function returns a full row of nulls when there is nothing to claim, not JSON `null`. The tick route's own comment on `claim_workflow_run` explains this; the same trap applies here.
2. Read the prompt's slug from `prompt_id`.
3. `runMatterAudit(client, { slug, matterId, userId: null, poke: false })`.
4. Write the settlement: `status`, `run_id`, `last_error`, `settled_at`.
5. Return `{ claimed: boolean; runId: string | null; status: string | null }`.

Comment WHY a skip is not a failure, and why the poke is off.

- [ ] **Step 4: Run to verify it passes**

Expected: PASS, 3 tests.

- [ ] **Step 5: Prove the null-row guard is real**

Add a test driving `materialiseStageTrigger` against a fake client whose RPC returns a row
of all-null columns, and assert it reports `claimed: false` rather than trying to read a
prompt for a null id. Then remove the id guard and confirm the test fails. Report verbatim.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/runs/triggers.ts apps/workbench/tests/run-triggers.test.ts
git commit -m "A claimed trigger becomes a queued run, or a recorded skip"
```

---

## Task 4: The tick claims a trigger first

**Files:**
- Modify: `apps/workbench/app/api/cron/tick/route.ts`
- Test: `apps/workbench/tests/tick-route.test.ts` (existing)

- [ ] **Step 1: Write the failing test**

```ts
  it('materialises a pending trigger before claiming a run', async () => {
    // Order matters: materialising first means a trigger fired seconds ago is
    // worked by this same tick rather than waiting a minute for the next one.
    process.env.CRON_SECRET = 'right'
    const res = await GET(new Request('http://x/api/cron/tick', {
      headers: { authorization: 'Bearer right' },
    }))
    const body = await res.json()
    expect(body).toHaveProperty('materialised')
  })
```

Follow the file's existing stubbing — the door tests already stub the worker, and this
should stub the materialiser the same way.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — no `materialised` in the response.

- [ ] **Step 3: Implement**

In the tick, after reaping and **before** claiming a run:

```ts
  // Materialise before claiming. A trigger that fired seconds ago becomes a
  // queued run now, and the claim below may pick it up in this same
  // invocation rather than leaving it for the next minute.
  const materialised = await materialiseStageTrigger(admin, worker)
```

Include it in every response shape the route returns — including the early
"nothing to claim" return, so a tick that only materialised something still says so rather
than reporting `claimedRunId: null` and looking idle.

- [ ] **Step 4: Run to verify it passes**

Then `cd apps/workbench && npm run verify` — green.

- [ ] **Step 5: Commit**

```bash
git add apps/workbench/app/api/cron/tick/route.ts apps/workbench/tests/tick-route.test.ts
git commit -m "The tick turns a stage trigger into a run before working the queue"
```

---

## Task 5: Turn firing on, for one prompt

**Files:**
- Create: `supabase/migrations/20261103010000_fire_design_sheet_audit.sql`
- Test: `apps/workbench/tests/stage-trigger-schema.test.ts` (extend)

- [ ] **Step 1: Write the migration**

`fires_on_stage_entry` lives on `prompts`, not on `prompt_versions` — it is configuration,
not content — so **no new prompt version is needed**. Say that in the header comment: the
published body is unchanged, and every run recorded against version 3 stays interpretable
against exactly the wording that produced it.

```sql
-- The design-sheet audit starts firing on its own.
--
-- `fires_on_stage_entry` is on `prompts` rather than in a version body,
-- because when a prompt runs is configuration and not content. Turning firing
-- on therefore needs no new version, and every run already recorded against
-- version 3 stays interpretable against exactly the wording that produced it.
--
-- design and drafting, the owner's decision on 2026-09-06: the sheet changes
-- substantially between them and each entry deserves its own look. Two model
-- runs per matter is the cost, accepted knowingly.

update public.prompts
   set fires_on_stage_entry = array['design', 'drafting']
 where slug = 'ma-design-sheet-audit';
```

- [ ] **Step 2: Add the test**

```ts
describe('turning firing on for the design-sheet audit', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/20261103010000_fire_design_sheet_audit.sql'),
    'utf8',
  )

  it('fires on design and drafting, and names the prompt by slug', () => {
    expect(sql).toMatch(/array\['design', 'drafting'\]/)
    expect(sql).toContain("slug = 'ma-design-sheet-audit'")
  })

  it('does not add a prompt version, because when a prompt runs is not what it says', () => {
    // A new version here would make every existing run's findings look like
    // they came from superseded wording when the wording never changed.
    expect(sql).not.toMatch(/insert into public\.prompt_versions/)
  })

  it('leaves the review playbook alone', () => {
    expect(sql).not.toContain('ma-trust-firm-qa')
  })
})
```

- [ ] **Step 3: Run and commit**

```bash
cd apps/workbench && npx vitest run tests/stage-trigger-schema.test.ts
git add -A && git commit -m "The design-sheet audit fires on design and drafting"
```

---

## Task 6: The advisory

**Files:**
- Create: `apps/workbench/lib/runs/advisory.ts`
- Modify: `apps/workbench/app/prompts/page.tsx`, `PromptsWorkspace.tsx`
- Test: `apps/workbench/tests/run-advisory.test.ts`, `apps/workbench/tests/prompts-page.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { toBlockerAdvisories } from '@/lib/runs/advisory'

const finding = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'f1', run_id: 'run-1', rule_number: '1',
  outcome: 'deviation', severity: 'blocker', disposition: 'open', ...over,
})

describe('which findings a matter is warned about', () => {
  it('warns about an open blocker', () => {
    expect(toBlockerAdvisories([finding()], { 'run-1': 'matter-1' })).toHaveLength(1)
  })

  it('says nothing about a blocker somebody has already dispositioned', () => {
    // The whole point of reusing `disposition`: dispositioning a false
    // positive is what clears it. If an accepted or rejected finding kept
    // warning, the list would only ever grow and would stop being read.
    for (const disposition of ['accepted', 'rejected', 'deferred']) {
      expect(toBlockerAdvisories([finding({ disposition })], { 'run-1': 'matter-1' })).toEqual([])
    }
  })

  it('says nothing about a lesser severity', () => {
    for (const severity of ['high', 'medium', 'low', null]) {
      expect(toBlockerAdvisories([finding({ severity })], { 'run-1': 'matter-1' })).toEqual([])
    }
  })

  it('says nothing about a compliant finding, whatever its severity', () => {
    expect(toBlockerAdvisories([finding({ outcome: 'compliant' })], { 'run-1': 'matter-1' })).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`toBlockerAdvisories(findings, matterByRun)` — pure. Then
`loadUnresolvedBlockers(client)` querying `workflow_findings` for
`severity = 'blocker'`, `disposition = 'open'`, outcome in `deviation`/`absent`, joined to
its run's matter and the matter's name.

Follow the inline-column-literal convention `lib/fieldAudit/persist.ts` documents.

- [ ] **Step 4: Surface it**

`/prompts` gains a section above the picker: the matters with unresolved blockers, each
linking to the run that raised it.

**Say what it is.** The heading should make clear these are advisory and that a stage
transition was not prevented — a list of blockers with no explanation invites the reader to
assume something was stopped. One sentence: an unresolved blocker does not block anything,
and dispositioning it on the run page clears it from here.

Add to `apps/workbench/tests/prompts-page.test.tsx`: the section lists a matter with an
open blocker, says nothing when there are none, and its text does not claim anything was
blocked.

- [ ] **Step 5: Run and build**

`cd apps/workbench && npm run verify`, then:

```bash
cd apps/workbench && VERCEL=1 NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder SUPABASE_SERVICE_ROLE_KEY=placeholder \
  CRON_SECRET=placeholder npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Show the blockers nobody has dispositioned, and say they block nothing"
```

---

## Task 7: The checks no test can stand in for

Requires credentials — whoever holds them runs this. The trigger is a database object, so
its behaviour is the database's and a stub cannot demonstrate it.

- [ ] **Step 1: A stage entry fires exactly one trigger per firing prompt**

Pick a matter with a design sheet whose `concerns` is populated, note its current stage, and
move it to `drafting` with a direct update. Confirm exactly one `prompt_stage_triggers` row
appears, `pending`, for the design-sheet audit and not for the review playbook.

A direct update is the right test rather than a shortcut: the trigger hangs off the column,
so `transition_matter_stage_with_jobs` and the root app's route reach it through the same
`update public.matters set stage = …`. Firing on a bare update is precisely the property
that makes this survive phase 15.

- [ ] **Step 2: The same stage written twice does not fire twice**

Update the stage to the same value again. Confirm no new row — the `when (new.stage is
distinct from old.stage)` clause should mean the trigger does not even run.

Then write a *different* stage and back again, and confirm a new row **does** appear: a real
re-entry has a new `stage_entered_at` and deserves a fresh audit. Report both.

- [ ] **Step 3: The tick materialises it**

Wait for the cron, or call the tick route with the secret. Confirm the trigger becomes
`done` with a `run_id`, and that the run completes with findings. Report the timings.

- [ ] **Step 4: A matter that cannot be audited is skipped, not failed**

Move a matter with **no design sheet** (or an empty `concerns`) into `drafting`. Confirm its
trigger settles `skipped` with a readable reason, and that **no run was created**. This is
the property that keeps `/prompts` from filling with runs that never had a chance.

- [ ] **Step 5: The advisory clears when a blocker is dispositioned**

With an open blocker showing, disposition it on the run page and confirm it leaves the
advisory list. Report before and after.

- [ ] **Step 6: Restore and clean up**

Put every matter's stage back to what it was — **record the original values before changing
anything in Step 1**. Remove scratch scripts and the credential copy. Report what test data
was left behind and how to remove it.

---

## Verification checklist

- [ ] `cd apps/workbench && npm run verify` passes.
- [ ] Root `npm run lint`, `npm run typecheck`, `npm test` pass.
- [ ] `node scripts/checkDbColumns.mjs` and `node scripts/checkDbRpcs.mjs` both pass.
- [ ] `tests/query-columns.test.ts` green **without being edited**.
- [ ] The build succeeds with `CRON_SECRET` and fails without it.
- [ ] A real stage entry fired a trigger, the tick turned it into a run, and the run finished.
- [ ] A matter that could not be audited was skipped with a reason and created no run.
- [ ] Every matter's stage was restored to its original value.
