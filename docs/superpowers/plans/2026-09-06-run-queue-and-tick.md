# The Run Queue and Tick Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A run spans as many invocations as it needs, so a forty-unit playbook cannot die at the 300-second ceiling.

**Architecture:** The run *is* the queue — `workflow_runs.status = 'queued'` means work to do, and `workflow_run_steps` already says which units remain. A cron-driven tick claims one run at a time through a `for update skip locked` RPC, works its pending steps until a time budget is nearly spent, and leaves the rest for the next tick. A reaper hands back runs killed mid-flight, three times, then asks for a person.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres with RLS and plpgsql, Vercel cron, vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-run-queue-and-tick-design.md`

---

## File structure

**`scripts/`**
- `checkDbRpcs.mjs` (modify) — scan `apps/workbench` too

**`supabase/migrations/`**
- `20261031000000_run_queue.sql` — three columns and the claim function

**`apps/workbench/lib/runs/`**
- `context.ts` (new) — `loadRunContext`, factored out of `retry.ts`
- `worker.ts` (new) — the time budget, `workRun`
- `reaper.ts` (new) — the reap decision and its application
- `enqueue.ts` (new) — `pokeTick`, the fire-and-forget self-call
- `retry.ts` (modify) — queues instead of running inline; loses the rebuild it now shares
- `record.ts` (modify) — `openRun` opens `queued`

**`apps/workbench/app/api/cron/tick/`**
- `route.ts` (new)

**`apps/workbench/`**
- `vercel.json` (modify) — its first `crons` entry
- `lib/env.ts` (modify) — `CRON_SECRET` joins `REQUIRED_SERVER_ENV`

---

## Task 1: The RPC checker must look at the workbench

Do this first. It is independently valuable — the workbench's **sign-in path** already
calls `ensure_user_profile` and nothing has ever verified it — and every later task in this
plan depends on an RPC.

**Files:**
- Modify: `scripts/checkDbRpcs.mjs`
- Test: `apps/workbench/tests/rpc-check-scope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const script = fs.readFileSync(
  path.resolve(__dirname, '../../../scripts/checkDbRpcs.mjs'),
  'utf8',
)

describe('the RPC checker’s reach', () => {
  it('looks at the workbench, not only the root app', () => {
    // apps/workbench/lib/supabase/profile.ts calls ensure_user_profile on the
    // sign-in path, and until this the checker never saw it. A dropped or
    // renamed function would have broken sign-in in production with nothing
    // catching it first — which is the outage this workflow was written after.
    expect(script).toContain('apps/workbench')
  })

  it('still looks at the root app', () => {
    for (const dir of ['app', 'lib', 'components']) {
      expect(script).toMatch(new RegExp(`'${dir}'`))
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/rpc-check-scope.test.ts`
Expected: FAIL on the first test.

- [ ] **Step 3: Extend the checker**

In `scripts/checkDbRpcs.mjs`, change:

```js
const SOURCE_DIRS = ['app', 'lib', 'components']
```

to

```js
// The root app's own directories, plus the workbench's. The workbench calls
// `ensure_user_profile` on its sign-in path, and scanning only the repository
// root meant that call — and every one the workbench adds — went unverified.
const SOURCE_DIRS = [
  'app',
  'lib',
  'components',
  'apps/workbench/app',
  'apps/workbench/lib',
]
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/rpc-check-scope.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the extension actually catches something**

Temporarily add to `apps/workbench/lib/supabase/profile.ts`:

```ts
// TEMPORARY
export const probe = (client: never) => (client as never as { rpc: (n: string) => unknown }).rpc('no_such_function_xyz')
```

Then run `node scripts/checkDbRpcs.mjs` from the worktree root **with credentials present**
if you have them; without credentials it will skip the comparison, in which case confirm
instead that the reported "found N RPC calls" count includes your probe by comparing the
count before and after. Report which of the two you did and the numbers. Remove the probe.

**This is the point of the task — a checker that scans a directory but would not fail on a
missing function there is not a check.** If you cannot demonstrate it either way, say so
rather than claiming it works.

- [ ] **Step 6: Commit**

```bash
git add scripts/checkDbRpcs.mjs apps/workbench/tests/rpc-check-scope.test.ts
git commit -m "The RPC check looks at the workbench, which calls one on sign-in"
```

---

## Task 2: The migration

**Files:**
- Create: `supabase/migrations/20261031000000_run_queue.sql`
- Test: `apps/workbench/tests/run-queue-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Follow `apps/workbench/tests/run-steps-schema.test.ts` for its idiom.

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261031000000_run_queue.sql'),
  'utf8',
)

describe('the run queue migration', () => {
  it('gives a run a heartbeat', () => {
    expect(sql).toMatch(/add column if not exists last_tick_at timestamptz/)
  })

  it('records which worker holds a run', () => {
    expect(sql).toMatch(/add column if not exists locked_by text/)
  })

  it('counts how many times a run has been handed back', () => {
    // A run that kills every worker it touches must stop being handed to the
    // next one; without a count there is nothing to stop on.
    expect(sql).toMatch(/add column if not exists reclaims integer not null default 0/)
  })

  it('claims a run without two workers getting the same one', () => {
    // The whole reason this is a function rather than a query: PostgREST has
    // no way to say `for update skip locked`.
    expect(sql).toMatch(/for update skip locked/)
    expect(sql).toMatch(/create or replace function public\.claim_workflow_run/)
  })

  it('claims only one run, and the oldest', () => {
    expect(sql).toMatch(/order by started_at/)
    expect(sql).toMatch(/limit 1/)
  })

  it('runs the claim as its definer with a pinned search path', () => {
    // Matches claim_workflow_jobs in 20261004000000. An unpinned search_path
    // on a security definer function is how a definer becomes a foothold.
    expect(sql).toMatch(/security definer set search_path = pg_catalog, public/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — ENOENT.

- [ ] **Step 3: Write the migration**

Read `supabase/migrations/20261004000000_solo_practice_efficiency_billing.sql` around
`claim_workflow_jobs` first and follow it — same `security definer`, same pinned
`search_path`, same `with selected as (...) update ... from selected` shape.

```sql
-- A run spans as many invocations as it needs.
--
-- A unit takes about ten seconds and maxDuration is 300, so roughly thirty fit
-- in one invocation. The ~40-prompt library is coming, and a forty-unit run is
-- four hundred seconds of work -- it cannot finish in one, and the failure
-- would be a run dying at the ceiling with no way to resume.
--
-- No queue table. `workflow_runs.status = 'queued'` already means there is work
-- to do and `workflow_run_steps` already says which units remain; a parallel
-- jobs row would be a second source of truth about the same work, and the two
-- would drift the first time one was written without the other.

alter table public.workflow_runs
  -- The heartbeat. A worker stamps this after every unit, so a run whose
  -- worker was killed mid-flight is distinguishable from one still going --
  -- without it, `running` means both, and the reaper has nothing to read.
  add column if not exists last_tick_at timestamptz,

  -- Which worker holds it. A claim that is only implied by `running` cannot
  -- be debugged when two of them disagree.
  add column if not exists locked_by text,

  -- How many times the reaper has handed this run back. A run that kills
  -- every worker it touches must stop being handed to the next one, or one
  -- bad run becomes a permanent load on the queue.
  add column if not exists reclaims integer not null default 0;

create index if not exists workflow_runs_queued_idx
  on public.workflow_runs (status, started_at)
  where status in ('queued', 'running');

-- Claim exactly one queued run, atomically.
--
-- `for update skip locked` is the whole reason this is a function: PostgREST
-- cannot express it, and without it two ticks firing in the same second would
-- claim the same run and do its work twice -- two model calls per unit, two
-- findings racing for one (run_id, rule_number). Same shape as
-- claim_workflow_jobs in 20261004000000.
create or replace function public.claim_workflow_run(p_worker text)
returns public.workflow_runs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_run public.workflow_runs;
begin
  with selected as (
    select id from public.workflow_runs
    where status = 'queued'
    order by started_at
    for update skip locked
    limit 1
  )
  update public.workflow_runs r
     set status = 'running',
         locked_by = p_worker,
         last_tick_at = statement_timestamp()
    from selected
   where r.id = selected.id
  returning r.* into v_run;

  return v_run;
end $$;

revoke all on function public.claim_workflow_run(text) from public, anon, authenticated;
grant execute on function public.claim_workflow_run(text) to service_role;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Run to verify it passes**

Expected: PASS, 6 tests.

- [ ] **Step 5: Prove one assertion bites**

Remove `for update skip locked` from the function, confirm that test fails, restore.
Report verbatim.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261031000000_run_queue.sql apps/workbench/tests/run-queue-schema.test.ts
git commit -m "A run can be claimed by one worker at a time"
```

**Do not apply this migration.** Someone with credentials applies it and regenerates the
types before Task 4.

---

## Task 3: Factor the run context out of retry

**Files:**
- Create: `apps/workbench/lib/runs/context.ts`
- Modify: `apps/workbench/lib/runs/retry.ts`
- Test: `apps/workbench/tests/run-context.test.ts`

Retry already rebuilds everything a worker needs: the prompt body at the run's own
`prompt_version_id`, and the pinned evidence for its kind. The tick needs exactly the same
thing. Two copies would drift, and the drift would look like a queued run and a retried run
disagreeing about the same document.

- [ ] **Step 1: Read `retry.ts` and identify the block**

The rebuild spans roughly the run load, `loadPromptVersionById`, and the per-kind branch
that produces `checks` + `values` or `rules` + `layer`. Extract it whole; do not rewrite it.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { unitsFor } from '@/lib/runs/context'

describe('the units a run still has to do', () => {
  it('is every unit of the body, filtered to the ones asked for', () => {
    const body = { kind: 'field_audit' as const, inputs: [], checks: [
      { number: '1' }, { number: '2' }, { number: '3' },
    ] } as never
    expect(unitsFor(body, ['2', '3']).map((u: { number: string }) => u.number)).toEqual(['2', '3'])
  })

  it('is the whole body when nothing is named', () => {
    // A first run has no filter: every unit is still to do.
    const body = { kind: 'review' as const, inputs: [], rules: [
      { number: '1' }, { number: '2' },
    ] } as never
    expect(unitsFor(body, null)).toHaveLength(2)
  })

  it('keeps the body’s own order, not the order asked for', () => {
    // A playbook's order is the order its author meant, and the prompt cache
    // depends on the document sitting ahead of a varying unit — reordering
    // would not break correctness but it would make a run read wrongly.
    const body = { kind: 'field_audit' as const, inputs: [], checks: [
      { number: '1' }, { number: '2' }, { number: '3' },
    ] } as never
    expect(unitsFor(body, ['3', '1']).map((u: { number: string }) => u.number)).toEqual(['1', '3'])
  })
})
```

- [ ] **Step 3: Write `context.ts`**

Export `loadRunContext(client, runId)` returning the run row, the parsed prompt, the
rebuilt evidence for its kind, and `unitsFor(body, only)`. Move the code; keep its comments
— they carry the pinned-evidence and pinned-version reasoning.

- [ ] **Step 4: Rewrite `retry.ts` to use it**

`retryFailedSteps` calls `loadRunContext` instead of doing the rebuild itself.

- [ ] **Step 5: The acceptance test for the extraction**

Run: `cd apps/workbench && npx vitest run tests/run-retry.test.ts`
Expected: PASS, **with `run-retry.test.ts` unmodified.** `git diff` it to confirm. If a
retry test needed changing, the extraction changed behaviour — revert and redo it.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/runs/context.ts apps/workbench/lib/runs/retry.ts apps/workbench/tests/run-context.test.ts
git commit -m "One place that rebuilds what a run was asked"
```

---

## Task 4: The worker and its time budget

**Prerequisite:** Task 2's migration applied and types regenerated. If `last_tick_at` is not
in the generated types, **stop and report** rather than casting around it.

**Files:**
- Create: `apps/workbench/lib/runs/worker.ts`
- Test: `apps/workbench/tests/run-worker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { budgetExhausted, TICK_BUDGET_MS } from '@/lib/runs/worker'

describe('the tick’s time budget', () => {
  it('stops well inside the invocation ceiling', () => {
    // maxDuration is 300s. Stopping at 240 leaves room for the unit in
    // flight to finish and for the run to be finalised — a worker killed at
    // the ceiling loses the unit it was mid-way through.
    expect(TICK_BUDGET_MS).toBeLessThanOrEqual(240_000)
    expect(TICK_BUDGET_MS).toBeGreaterThan(60_000)
  })

  it('is not exhausted at the start', () => {
    expect(budgetExhausted(0, 0)).toBe(false)
  })

  it('is exhausted once the budget has passed', () => {
    expect(budgetExhausted(0, TICK_BUDGET_MS + 1)).toBe(true)
  })

  it('stops before a unit that would not fit', () => {
    // A unit takes about ten seconds. Starting one with five seconds left
    // spends the money and loses the answer.
    expect(budgetExhausted(0, TICK_BUDGET_MS - 5_000)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/workbench/lib/runs/worker.ts

/**
 * How long a tick will work before leaving the rest for the next one.
 *
 * `maxDuration` is 300 seconds. Stopping at 240 leaves room for the unit in
 * flight to finish and for the run to be finalised: a worker killed at the
 * ceiling loses the unit it was mid-way through, and that unit's model call
 * has already been paid for.
 */
export const TICK_BUDGET_MS = 240_000

/** A unit takes about ten seconds; starting one without room spends the money and loses the answer. */
const UNIT_HEADROOM_MS = 15_000

export function budgetExhausted(startedAt: number, now: number): boolean {
  return now - startedAt >= TICK_BUDGET_MS - UNIT_HEADROOM_MS
}
```

Then `workRun(client, context, deps)`: loops the run's `pending` steps in order, runs one
unit through the engine, records the step, stamps `last_tick_at`, and stops when
`budgetExhausted`. Returns `{ done: boolean; worked: number }` — `done` when no `pending`
steps remain, so the caller knows whether to `finaliseRun` and, for a field audit, to
`emitTasks` from the run's actionable findings. Both belong to the caller, not here: a
worker that emitted tasks halfway through a run would create them for findings the run had
not finished disagreeing with.

Take `now: () => number` as an injected clock, so the budget is testable without waiting.

- [ ] **Step 4: Run to verify it passes**

Expected: PASS, 4 tests.

- [ ] **Step 5: Prove a tick leaves the rest resumable**

```ts
  it('leaves the units it did not reach pending, and the run resumable', async () => {
    // The property the whole slice turns on: a run too long for one
    // invocation must be continuable, not lost.
    const clock = fakeClock()
    const result = await workRun(client, contextWith(4), {
      callModel: async () => { clock.advance(120_000); return reply() },
      now: clock.now,
    })
    expect(result.done).toBe(false)
    expect(result.worked).toBe(2)
    expect(await pendingSteps(client)).toEqual(['3', '4'])
  })
```

`fakeClock`, `contextWith` and `pendingSteps` are local helpers you write in that test
file; build the client with `makeFakeClient` from `apps/workbench/tests/helpers/fakeSupabase.ts`
rather than writing a third stub.

Then break it — remove the budget check — and confirm this test fails because all four ran.
Restore. Report verbatim.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/runs/worker.ts apps/workbench/tests/run-worker.test.ts
git commit -m "A tick works what it can and leaves the rest"
```

---

## Task 5: The reaper

**Files:**
- Create: `apps/workbench/lib/runs/reaper.ts`
- Test: `apps/workbench/tests/run-reaper.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { reapDecision, STALE_AFTER_MS, MAX_RECLAIMS } from '@/lib/runs/reaper'

const minutes = (n: number) => n * 60_000

describe('deciding a run was abandoned', () => {
  it('leaves a run whose worker is still stamping alone', () => {
    expect(reapDecision({ status: 'running', lastTickAt: minutes(1), reclaims: 0 }, minutes(2)))
      .toEqual({ reap: false })
  })

  it('reaps a run whose heartbeat stopped', () => {
    // Nothing will ever finish it. Left alone it reads as "in progress"
    // forever, which is worse than saying it died.
    expect(reapDecision({ status: 'running', lastTickAt: 0, reclaims: 0 }, STALE_AFTER_MS + 1))
      .toEqual({ reap: true, requeue: true })
  })

  it('stops requeueing a run that has killed enough workers', () => {
    // Handing it back forever is how one bad run becomes a permanent load.
    expect(reapDecision({ status: 'running', lastTickAt: 0, reclaims: MAX_RECLAIMS }, STALE_AFTER_MS + 1))
      .toEqual({ reap: true, requeue: false })
  })

  it('never reaps a run that is not running', () => {
    for (const status of ['queued', 'completed', 'partial', 'failed'] as const) {
      expect(reapDecision({ status, lastTickAt: 0, reclaims: 0 }, minutes(60)).reap).toBe(false)
    }
  })

  it('never reaps a run that has not stamped at all yet', () => {
    // A run claimed a moment ago has a `last_tick_at` from the claim itself.
    // A null one means the claim has not happened, so there is no worker to
    // have died — reaping it would fight the claim.
    expect(reapDecision({ status: 'running', lastTickAt: null, reclaims: 0 }, minutes(60)).reap).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`STALE_AFTER_MS = 10 * 60_000`, `MAX_RECLAIMS = 3`, the pure `reapDecision`, and
`reapAbandonedRuns(client, now)` which applies it: the run's `running` steps become
`failed` with `'The worker running this step stopped without finishing it.'`, then the run
is requeued (incrementing `reclaims`) or finalised `partial`.

Comment why ten minutes: a tick's own budget is four, so a run mid-tick is never stale;
ten leaves room for a slow unit and a clock skew without leaving a genuinely dead run
sitting for an hour.

- [ ] **Step 4: Run to verify it passes**

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/workbench/lib/runs/reaper.ts apps/workbench/tests/run-reaper.test.ts
git commit -m "Hand back a run whose worker died, three times, then ask a person"
```

---

## Task 6: The tick route, the cron, and the secret

**Files:**
- Create: `apps/workbench/app/api/cron/tick/route.ts`
- Modify: `apps/workbench/vercel.json`, `apps/workbench/lib/env.ts`
- Test: `apps/workbench/tests/tick-route.test.ts`, `apps/workbench/tests/env.test.ts` (existing)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/cron/tick/route'

describe('the tick route’s door', () => {
  it('refuses when the secret is not set', async () => {
    // A queue whose worker authenticates by accident is worse than one that
    // never runs. No secret means no, never "allow".
    delete process.env.CRON_SECRET
    const res = await GET(new Request('http://x/api/cron/tick'))
    expect(res.status).toBe(401)
  })

  it('refuses a wrong secret', async () => {
    process.env.CRON_SECRET = 'right'
    const res = await GET(new Request('http://x/api/cron/tick', {
      headers: { authorization: 'Bearer wrong' },
    }))
    expect(res.status).toBe(401)
  })

  it('accepts the cron’s own header', async () => {
    process.env.CRON_SECRET = 'right'
    const res = await GET(new Request('http://x/api/cron/tick', {
      headers: { authorization: 'Bearer right' },
    }))
    expect(res.status).toBe(200)
  })
})
```

Stub the worker so the accepted case does no real work — the door is what this tests.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

`maxDuration = 300`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, matching
`app/api/cron/workflow-jobs/route.ts`'s auth shape exactly.

Order: reap first, then claim, then work, then finalise if done. Return a small JSON
summary — claimed run id, units worked, whether it finished — so a cron log says something.

- [ ] **Step 4: Add the cron and require the secret**

`apps/workbench/vercel.json` gains:

```json
  "crons": [
    { "path": "/api/cron/tick", "schedule": "* * * * *" }
  ]
```

`apps/workbench/lib/env.ts` adds `'CRON_SECRET'` to `REQUIRED_SERVER_ENV`. Its own comment
already states the convention: *"Add a variable here when the code that reads it lands, in
the same PR."*

Update `apps/workbench/tests/env.test.ts` to expect it — **rewrite the assertion, do not
delete the test.**

- [ ] **Step 5: Run the suite and the build**

```bash
cd apps/workbench && npm run verify
VERCEL=1 NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder SUPABASE_SERVICE_ROLE_KEY=placeholder \
  CRON_SECRET=placeholder npm run build
```

Both must pass. **Then run the build once WITHOUT `CRON_SECRET` and confirm it fails,
naming the variable** — that is the guard's whole purpose. Report both outputs.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "A tick route, a cron to call it, and a secret it refuses to run without"
```

---

## Task 7: Enqueue instead of run

**Files:**
- Modify: `apps/workbench/lib/runs/record.ts`, `apps/workbench/lib/fieldAudit/run.ts`, `apps/workbench/app/api/staff/review/route.ts`
- Create: `apps/workbench/lib/runs/enqueue.ts`
- Test: `apps/workbench/tests/run-enqueue.test.ts`, plus the existing run tests

- [ ] **Step 1: `openRun` opens `queued`**

Change `openRunRowFor`'s `status` from `'running'` to `'queued'`, and update its comment:
`running` now means a worker holds it, and a run is `queued` from `openRun` until a tick
claims it. Update `apps/workbench/tests/run-record.test.ts` — **rewrite the assertion, do
not delete it.**

- [ ] **Step 2: Write the poke**

```ts
// apps/workbench/lib/runs/enqueue.ts

/**
 * Nudge the tick route so a queued run starts now rather than on the next cron.
 *
 * Fire-and-forget, and a failure is deliberately not an error: cron will pick
 * the run up within the minute. A run that starts a few seconds late is not a
 * run that failed, and reporting it as one would turn a cosmetic delay into a
 * red message on screen.
 *
 * The absolute URL is the part that usually breaks. A relative fetch works in
 * development and silently does nothing in production, so the base comes from
 * VERCEL_URL when it is set and localhost otherwise.
 */
export async function pokeTick(): Promise<void> {
  const secret = process.env.CRON_SECRET
  if (!secret) return
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'
  try {
    await fetch(`${base}/api/cron/tick`, {
      headers: { authorization: `Bearer ${secret}` },
    })
  } catch {
    // See above: cron is the guarantee, this is only the hurry.
  }
}
```

- [ ] **Step 3: Add `openSteps`, because nothing writes a pending step today**

`recordStep` only writes a step that has already settled. Enqueueing needs the opposite: a
`pending` row per unit, written before any work happens. Add to `record.ts`:

`openSteps(client, runId, unitIds: string[])` — inserts one `pending` step per unit, with
`sequence` from the unit's position in the body, `attempts: 0`, and no timestamps. Follow
the inline-column-literal convention the rest of that file documents.

Writing them at enqueue time is what makes the run's shape known before any work happens,
so the page can say "3 of 40" from the first moment rather than counting up from nothing.

- [ ] **Step 4: Callers enqueue and return**

`runMatterAudit` opens the run, calls `openSteps`, calls `pokeTick`, and returns
`{ ok: true, runId, queued: true }` — it no longer runs the engine. The review route does
the same after saving its text layer.

**`emitTasks` moves with the work.** `runMatterAudit` calls it today, after the engine.
The engine now runs in the tick, so a queued field-audit run that finished must emit its
tasks there — in the same place `finaliseRun` is called, and only when the run is actually
done, never on a tick that merely worked part of it. Leaving it behind would mean a queued
run produces findings and no tasks, which is the same silent inconsistency the previous
slice found in retry.

- [ ] **Step 5: Update the existing run tests**

`field-audit-run.test.ts` and the review's tests assert on findings produced inline. They
must now assert the run is queued with its steps pending. **Rewrite them; do not delete
them.** If a test cannot be rewritten to mean the same thing, stop and report.

- [ ] **Step 6: Run the suite**

`cd apps/workbench && npm run verify` — green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "A run is queued, and a tick does the work"
```

---

## Task 8: Retry queues too

**Files:**
- Modify: `apps/workbench/lib/runs/retry.ts`
- Test: `apps/workbench/tests/run-retry.test.ts`

- [ ] **Step 1: Rewrite `retryFailedSteps` to enqueue**

It resets the failed steps to `pending`, sets the run back to `queued`, deletes the
superseded findings as it already does, and pokes the tick. It no longer calls the engine.

One code path, not two behaviours: a retry of twenty units must not have to finish in one
request either.

- [ ] **Step 2: Rewrite the retry tests**

The headline property changes shape but not meaning: instead of "calls the model only for
the failed units", it becomes **"marks only the failed units pending, leaving the
successful ones untouched"** — and the model-call count moves to the worker's own test,
where the units come from `pending` steps.

Keep a test asserting the successful steps' `attempts` and `finding_id` are unchanged by a
retry. That is what proves successful work is not re-paid for.

- [ ] **Step 3: Run the suite**

`cd apps/workbench && npm run verify` — green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "A retry queues the units that failed"
```

---

## Task 9: The page shows progress

**Files:**
- Modify: `apps/workbench/app/runs/RunSteps.tsx`, `apps/workbench/app/prompts/[runId]/page.tsx`, `apps/workbench/app/review/[runId]/page.tsx`, `apps/workbench/app/prompts/PromptsWorkspace.tsx`
- Test: `apps/workbench/tests/run-steps-view.test.tsx` or the existing view tests

- [ ] **Step 1: Write the failing test**

```tsx
  it('says how far along a queued run is', () => {
    render(<RunSteps steps={[
      { unitId: '1', status: 'succeeded', attempts: 1, sequence: 0, lastError: null },
      { unitId: '2', status: 'running', attempts: 1, sequence: 1, lastError: null },
      { unitId: '3', status: 'pending', attempts: 0, sequence: 2, lastError: null },
    ]} runStatus="running" unitNoun="check" />)
    expect(screen.getByText(/1 of 3/)).toBeInTheDocument()
  })

  it('offers no retry while the run is still going', () => {
    // Retrying a run a worker currently holds would race it.
    render(<RunSteps steps={[
      { unitId: '1', status: 'failed', attempts: 1, sequence: 0, lastError: 'overloaded' },
      { unitId: '2', status: 'pending', attempts: 0, sequence: 1, lastError: null },
    ]} runStatus="running" unitNoun="check" onRetry={() => {}} />)
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })
```

- [ ] **Step 2: Implement**

`RunSteps` shows `N of M` complete and a `pending`/`running` state per step. The retry
control appears only when the run has settled — `completed`, `partial` or `failed` — and
some step failed.

The run pages refresh while a run is unfinished. Use `export const revalidate = 5` on the
run page rather than a client polling loop; it is the smaller change and there is no
websocket in this codebase to be consistent with.

- [ ] **Step 3: Run and build**

`npm run verify`, then the `VERCEL=1 … CRON_SECRET=placeholder npm run build`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Show how far along a run is, and hide retry while it is going"
```

---

## Task 10: The checks no test can stand in for

Requires credentials — whoever holds them runs this.

- [ ] **Step 1: Two ticks must never claim the same run**

The one property a stub cannot demonstrate, because `for update skip locked` is the
database's behaviour and not the app's. Queue one run, fire two tick requests
simultaneously, and confirm exactly one claims it and the other reports nothing to do.
Report both responses.

- [ ] **Step 2: A run spans ticks**

There is no forty-unit playbook yet, so lower `TICK_BUDGET_MS` temporarily rather than
inventing one. Run the six-check audit with a budget that fits two units, and confirm: the
first tick works two and leaves four `pending`, the run stays `running` with a fresh
`last_tick_at`, and subsequent ticks finish it. **State plainly in the report that the
budget was lowered — this is a substitution for load that does not exist yet, not a
demonstration of it.**

- [ ] **Step 3: The reaper actually reaps**

Set a run's `last_tick_at` back by fifteen minutes while `running`, tick, and confirm its
`running` steps became `failed` with the reason and the run returned to `queued` with
`reclaims` incremented.

- [ ] **Step 4: The results are unchanged**

A queued run must produce what a synchronous one did. Compare a queued six-check run's
findings, references and task count against the numbers recorded on 2026-09-05: six
findings, all references verified, three actionable. Report the comparison.

- [ ] **Step 5: Clean up**

Remove scratch scripts and the credential copy. Report what test data was left and how to
remove it.

---

## Verification checklist

- [ ] `cd apps/workbench && npm run verify` passes.
- [ ] Root `npm run lint`, `npm run typecheck`, `npm test` pass.
- [ ] `node scripts/checkDbColumns.mjs` and `node scripts/checkDbRpcs.mjs` both pass, the latter now covering the workbench.
- [ ] `tests/query-columns.test.ts` green **without being edited**.
- [ ] The build fails without `CRON_SECRET`, and succeeds with it.
- [ ] Two simultaneous ticks claimed different runs, proven against the real database.
- [ ] A run spanning ticks was demonstrated with a lowered budget, and the substitution was stated.
