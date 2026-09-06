# Run Steps and Surgical Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record what each unit of a run did, so a failed unit can be retried without re-running — or re-paying for — the ones that succeeded.

**Architecture:** One `workflow_run_steps` row per unit, written as the unit settles through a new optional `onUnitSettled` hook on the shared engine. The run row is inserted before the engine starts, so a run that dies mid-flight leaves a record. A field audit's resolved inputs are pinned on the run, giving it the guarantee the review already had from `text_layer_id`, so a retry replays against what the original run saw.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres with RLS, vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-run-steps-and-retry-design.md`

---

## File structure

**`packages/citations/src/prompt/`**
- `runPrompt.ts` (modify) — one optional dependency, `onUnitSettled`. Nothing else changes.

**`apps/workbench/lib/runs/`** (new — shared by both kinds, which is the point)
- `steps.ts` — `statusFromSteps`, `unitsToRetry`, the single `RunStatus`, the pure policy
- `record.ts` — `openRun`, `recordStep`, `finaliseRun`: the three phases
- `retry.ts` — `retryFailedSteps`, handling both kinds
- `history.ts` — `loadAnyRun`, kind-aware, replacing the review-shaped loader

**`apps/workbench/lib/fieldAudit/`**
- `persist.ts` (modify) — restructured onto the three phases

**`apps/workbench/lib/review/`**
- `persist.ts` (modify) — same restructure

**`apps/workbench/app/review/[runId]/`**
- `page.tsx`, `StoredFindings.tsx` (modify) — steps list and the retry control
- `actions.ts` (modify) — the retry action

**`supabase/migrations/`**
- `20261030000000_run_steps.sql`

---

## Task 1: The migration

**Files:**
- Create: `supabase/migrations/20261030000000_run_steps.sql`
- Test: `apps/workbench/tests/run-steps-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Model it on `apps/workbench/tests/prompt-schema.test.ts` — read that first and follow its
`tableBlock()` idiom for scoping assertions to one statement.

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261030000000_run_steps.sql'),
  'utf8',
)

describe('the run steps migration', () => {
  it('gives a run at most one step per unit', () => {
    // Two rows for the same unit would make "which step failed" unanswerable,
    // and retry would run it twice.
    expect(sql).toMatch(/unique \(run_id, unit_id\)/)
  })

  it('lets a step say how many attempts it has had', () => {
    expect(sql).toMatch(/attempts integer not null default 0/)
  })

  it('keeps a step pointing at what it produced, and survives that finding going', () => {
    // A retry deletes the superseded finding. The step must not go with it —
    // its attempt count and error history are the record of what happened.
    expect(sql).toMatch(/finding_id uuid references public\.workflow_findings\(id\) on delete set null/)
  })

  it('drops a run’s steps with the run', () => {
    expect(sql).toMatch(/run_id uuid not null references public\.workflow_runs\(id\) on delete cascade/)
  })

  it('pins the evidence a field audit ran against', () => {
    expect(sql).toContain('resolved_inputs')
  })

  it('protects the new table with row level security', () => {
    expect(sql).toContain('alter table public.workflow_run_steps enable row level security')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/run-steps-schema.test.ts`
Expected: FAIL — ENOENT.

- [ ] **Step 3: Write the migration**

Follow the comment register of `supabase/migrations/20261028000000_prompt_objects.sql`, and
copy its RLS policy shape exactly — including the role list `('admin','attorney','va','staff')`,
which is the house convention. Read it before writing.

```sql
-- What each unit of a run actually did, so a failure costs one unit and not the run.
--
-- A run that lost one rule of forty had one remedy: run all forty again. That
-- re-pays for thirty-nine successful model calls to fix one failure and throws
-- away work that was correct. A row per unit makes retry surgical.
--
-- It also changes when a run becomes visible. Both paths used to run the engine
-- to completion and insert everything afterwards, so a run that died mid-flight
-- left nothing at all -- neither the work nor any evidence of why. A step
-- written as its unit settles needs a run_id to reference, so the run row is
-- inserted first, as `running`, and finalised at the end.

create table if not exists public.workflow_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.workflow_runs(id) on delete cascade,

  -- The rule number or check number, matching workflow_findings.rule_number.
  -- Text rather than an integer because a playbook numbers its rules however
  -- it likes -- "4a" is a rule.
  unit_id text not null,

  -- The order the unit ran in, so a run reads in playbook order rather than in
  -- whatever order the steps happened to settle.
  sequence integer not null,

  status text not null
    check (status = any (array['pending', 'running', 'succeeded', 'failed'])),

  attempts integer not null default 0,
  last_error text,

  started_at timestamptz,
  finished_at timestamptz,

  -- What this step produced. `on delete set null` and not cascade: a retry
  -- deletes the superseded finding, and the step must outlive it -- the
  -- attempt count and the error that preceded it are the record of what
  -- happened, and losing them would hide the very thing steps exist to show.
  finding_id uuid references public.workflow_findings(id) on delete set null,

  unique (run_id, unit_id)
);

create index if not exists workflow_run_steps_run_idx
  on public.workflow_run_steps (run_id);

comment on table public.workflow_run_steps is
  'One row per unit of a run -- a rule against a document, a check against a matter. Retry re-runs only the failed ones.';

-- The evidence a field audit ran against, pinned.
--
-- The review path has always had this: text_layer_id fixes the exact extracted
-- text, so a citation's character offsets index the text they were measured
-- against. A field audit read design_sheets live and had no equivalent, which
-- only becomes visible with retry -- replaying a step an hour later against an
-- edited sheet would produce a run holding one check judged on one version of
-- the matter and another on a different one, with nothing on either finding
-- saying so. Retry replays from this column and never re-reads the sheet; a
-- fresh run is how you audit the current one.
alter table public.workflow_runs
  add column if not exists resolved_inputs jsonb;

alter table public.workflow_run_steps enable row level security;

drop policy if exists "Staff read run steps" on public.workflow_run_steps;
create policy "Staff read run steps" on public.workflow_run_steps
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

Run: `cd apps/workbench && npx vitest run tests/run-steps-schema.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261030000000_run_steps.sql apps/workbench/tests/run-steps-schema.test.ts
git commit -m "A row per unit of a run, and the evidence a field audit saw"
```

**Do not apply this migration.** Someone with credentials applies it and regenerates the
types before Task 4.

---

## Task 2: The engine reports each unit as it settles

**Files:**
- Modify: `packages/citations/src/prompt/runPrompt.ts`
- Test: `apps/workbench/tests/run-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/workbench/tests/run-prompt.test.ts` (read it first for its existing
fixtures and reuse them):

```ts
  it('reports each unit as it settles, in order, with its outcome', async () => {
    // A run that dies halfway must leave a record of how far it got. That is
    // only possible if the engine says so per unit rather than at the end.
    const settled: Array<[string, boolean]> = []
    let call = 0
    await runPrompt(
      { ...seams, units: [{ id: '1', risk: 'high' }, { id: '2', risk: 'low' }] },
      {
        callModel: async () => {
          call += 1
          if (call === 1) throw new Error('overloaded')
          return reply({ outcome: 'compliant' })
        },
        context: { route: 'test' },
        onUnitSettled: async (unitId, outcome) => { settled.push([unitId, outcome.ok]) },
      },
    )
    expect(settled).toEqual([['1', false], ['2', true]])
  })

  it('carries the failure reason to the hook, not just to the result', async () => {
    const reasons: string[] = []
    await runPrompt(
      { ...seams, units: [{ id: '1', risk: 'high' }] },
      {
        callModel: async () => { throw new Error('overloaded') },
        context: { route: 'test' },
        onUnitSettled: async (_unitId, outcome) => {
          if (!outcome.ok) reasons.push(outcome.reason)
        },
      },
    )
    expect(reasons).toEqual(['overloaded'])
  })

  it('runs without a hook, because most callers do not need one', async () => {
    const result = await runPrompt(
      { ...seams, units: [{ id: '1', risk: 'high' }] },
      { callModel: async () => reply({ outcome: 'compliant' }), context: { route: 'test' } },
    )
    expect(result.findings).toHaveLength(1)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/run-prompt.test.ts`
Expected: FAIL — `onUnitSettled` is not accepted / not called.

- [ ] **Step 3: Write the implementation**

In `packages/citations/src/prompt/runPrompt.ts`, add to `RunPromptDependencies`:

```ts
export interface RunPromptDependencies {
  callModel: ModelCaller
  context: ModelCallContext
  /**
   * Called as each unit settles, before the next one starts.
   *
   * The loop knows what happened to a unit at the moment it happens; the
   * caller is the only one that can write it down. Reporting at the end
   * instead would mean a run killed halfway — a timeout, a deploy, a closed
   * lambda — leaves neither its work nor any evidence of how far it got.
   *
   * Deliberately not given the finding. Persistence belongs to the app and
   * this package knows nothing about a database; what a unit produced is
   * stored by the caller from the result, and linked to the step afterwards.
   */
  onUnitSettled?: (
    unitId: string,
    outcome: { ok: true } | { ok: false; reason: string },
  ) => Promise<void>
}
```

In the loop, replace each `failures.push({ unitId, reason })` / `continue` and the final
`findings.push(finding)` so that every path reports before moving on. A hook that throws
must not cost the unit its result — wrap the call so a failing recorder degrades to a
run that still returns its findings.

Concretely, after the existing `catch` and success paths resolve, funnel through one
helper inside `runPrompt`:

```ts
  const settle = async (
    unitId: string,
    outcome: { ok: true } | { ok: false; reason: string },
  ): Promise<void> => {
    if (!deps.onUnitSettled) return
    // A recorder that fails must not lose the unit's actual result. The step
    // row is the record of the work, not the work.
    try {
      await deps.onUnitSettled(unitId, outcome)
    } catch {
      // Intentionally swallowed; see above.
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/run-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the hook cannot cost a finding**

Add:

```ts
  it('still returns findings when the recorder throws', async () => {
    const result = await runPrompt(
      { ...seams, units: [{ id: '1', risk: 'high' }] },
      {
        callModel: async () => reply({ outcome: 'compliant' }),
        context: { route: 'test' },
        onUnitSettled: async () => { throw new Error('database down') },
      },
    )
    expect(result.findings).toHaveLength(1)
    expect(result.failures).toEqual([])
  })
```

Run it. Then temporarily remove the try/catch in `settle` and confirm this test fails.
Restore. Report both outputs.

- [ ] **Step 6: Confirm both engines still pass unmodified**

Run: `cd apps/workbench && npx vitest run tests/review-run.test.ts tests/field-audit-run.test.ts`
Expected: PASS, with neither file edited. `git diff` them to confirm.

- [ ] **Step 7: Commit**

```bash
git add packages/citations/src/prompt/runPrompt.ts apps/workbench/tests/run-prompt.test.ts
git commit -m "The engine says what happened to each unit as it happens"
```

---

## Task 3: Status comes from the steps

**Files:**
- Create: `apps/workbench/lib/runs/steps.ts`
- Test: `apps/workbench/tests/run-steps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { statusFromSteps, unitsToRetry } from '@/lib/runs/steps'

const step = (unitId: string, status: 'pending' | 'running' | 'succeeded' | 'failed') =>
  ({ unitId, status, attempts: 1, sequence: Number(unitId) })

describe('a run’s status, read from its steps', () => {
  it('is completed only when every step succeeded', () => {
    expect(statusFromSteps([step('1', 'succeeded'), step('2', 'succeeded')])).toBe('completed')
  })

  it('is partial when some succeeded and some failed', () => {
    // `completed` may not describe a run that lost a unit — that overstates
    // its coverage in the one field a reader skims.
    expect(statusFromSteps([step('1', 'succeeded'), step('2', 'failed')])).toBe('partial')
  })

  it('is failed when nothing succeeded', () => {
    expect(statusFromSteps([step('1', 'failed'), step('2', 'failed')])).toBe('failed')
  })

  it('is running while any step has not settled', () => {
    // A run with work outstanding is not a run with a verdict.
    expect(statusFromSteps([step('1', 'succeeded'), step('2', 'pending')])).toBe('running')
    expect(statusFromSteps([step('1', 'running')])).toBe('running')
  })

  it('is failed for a run with no steps at all', () => {
    // Nothing ran. Calling that `completed` would say a review happened.
    expect(statusFromSteps([])).toBe('failed')
  })
})

describe('which units a retry runs', () => {
  it('takes the failed ones, in sequence order', () => {
    expect(unitsToRetry([step('2', 'failed'), step('1', 'succeeded'), step('3', 'failed')]))
      .toEqual(['2', '3'])
  })

  it('takes nothing when nothing failed', () => {
    // The caller must be able to tell "nothing to do" from "retry everything".
    expect(unitsToRetry([step('1', 'succeeded')])).toEqual([])
  })

  it('does not take a step that never settled', () => {
    // A pending step was never attempted. Retrying it would be a first
    // attempt wearing a retry's name, and its attempt count would lie.
    expect(unitsToRetry([step('1', 'pending'), step('2', 'failed')])).toEqual(['2'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/run-steps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/workbench/lib/runs/steps.ts

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed'

/**
 * The one `RunStatus`.
 *
 * `lib/review/persist.ts` and `lib/fieldAudit/persist.ts` each declared their
 * own, both `'completed' | 'partial' | 'failed'`, and neither admitted
 * `running` — which the database has always allowed and which a run now
 * genuinely is while its steps settle. Both are deleted in favour of this.
 */
export type RunStatus = 'running' | 'completed' | 'partial' | 'failed'

export interface RunStep {
  unitId: string
  status: StepStatus
  attempts: number
  sequence: number
}

/**
 * One answer to "how did this run go", read from what its units actually did.
 *
 * There used to be two of these — `runStatusFor` in the review's persistence
 * and `runStatusForAudit` in the audit's — computing the same thing from
 * finding and failure counts, and disagreeing: given no findings and no
 * failures the first said `failed` and the second `completed`. Neither case
 * was reachable, which is exactly why nobody noticed. Steps make the counts
 * unnecessary: the rows say what happened.
 */
export function statusFromSteps(steps: RunStep[]): RunStatus {
  if (steps.length === 0) return 'failed'
  if (steps.some((s) => s.status === 'pending' || s.status === 'running')) return 'running'
  const succeeded = steps.filter((s) => s.status === 'succeeded').length
  if (succeeded === steps.length) return 'completed'
  return succeeded === 0 ? 'failed' : 'partial'
}

/**
 * The units a retry re-runs: the ones that were attempted and failed.
 *
 * A `pending` step was never attempted, so running it would be a first attempt
 * wearing a retry's name — and its attempt count would say otherwise.
 */
export function unitsToRetry(steps: RunStep[]): string[] {
  return steps
    .filter((s) => s.status === 'failed')
    .sort((a, b) => a.sequence - b.sequence)
    .map((s) => s.unitId)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/run-steps.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/workbench/lib/runs/steps.ts apps/workbench/tests/run-steps.test.ts
git commit -m "A run's status is what its units did"
```

---

## Task 4: The three phases

**Files:**
- Create: `apps/workbench/lib/runs/record.ts`
- Test: `apps/workbench/tests/run-record.test.ts`

**Prerequisite:** the migration from Task 1 must be applied and
`packages/db-types/src/supabase.generated.ts` regenerated, or the typed client will reject
`workflow_run_steps` and `resolved_inputs`. If they are absent from the generated types,
**stop and report** rather than casting around it.

- [ ] **Step 1: Write the failing test**

Test the pure row builders, not the client calls:

```ts
import { describe, expect, it } from 'vitest'
import { stepRowFor, openRunRowFor } from '@/lib/runs/record'

describe('the rows a run is recorded with', () => {
  it('opens a run as running, before anything has happened to it', () => {
    // The run has to exist before the engine starts, so its steps have
    // something to reference — and so a run that dies leaves a trace.
    const row = openRunRowFor({
      matterId: 'm1', kind: 'field_audit', promptVersionId: 'v1', model: 'claude-sonnet-5',
      unitTotal: 6, userId: null, resolvedInputs: { concerns: 'x' },
      documentVersionId: null, textLayerId: null,
    })
    expect(row.status).toBe('running')
    expect(row.rule_total).toBe(6)
    expect(row.finding_count).toBe(0)
    expect(row.failed_count).toBe(0)
    expect(row.finished_at).toBeNull()
    expect(row.resolved_inputs).toEqual({ concerns: 'x' })
  })

  it('records a settled step with its attempt count and outcome', () => {
    expect(stepRowFor('run-1', '3', 2, { ok: false, reason: 'overloaded' }, 1)).toEqual({
      run_id: 'run-1', unit_id: '3', sequence: 2, status: 'failed',
      attempts: 1, last_error: 'overloaded',
      started_at: expect.any(String), finished_at: expect.any(String),
    })
  })

  it('records a succeeded step with no error', () => {
    const row = stepRowFor('run-1', '1', 0, { ok: true }, 1)
    expect(row.status).toBe('succeeded')
    expect(row.last_error).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/run-record.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`apps/workbench/lib/runs/record.ts` exports the pure builders above plus three functions
taking a typed client:

- `openRun(client, input): Promise<string>` — inserts the run as `running` and returns its id.
- `recordStep(client, runId, unitId, sequence, outcome, attempt): Promise<void>` — upserts on `(run_id, unit_id)` so a retry updates the existing row and increments `attempts` rather than inserting a second one.
- `finaliseRun(client, runId, steps): Promise<void>` — sets `status` from `statusFromSteps`, `finding_count`, `failed_count` and `finished_at`.

Follow the inline-literal convention `apps/workbench/lib/fieldAudit/persist.ts` documents
at length: column names must appear as literals in the `.insert(...)` / `.update(...)`
object so `scripts/checkDbColumns.mjs` and `tests/query-columns.test.ts` can see them.
Read that comment before writing, and keep the pure builders as the tested statement of
the shape.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/run-record.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Confirm the checker sees the new columns**

Run from the worktree root: `node scripts/checkDbColumns.mjs`
Expected: no error, and the reported column-read count is higher than before this task.
Report both numbers. If `workflow_run_steps` columns are not counted, the literals are not
where the checker can see them — fix that rather than accepting it.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/runs/record.ts apps/workbench/tests/run-record.test.ts
git commit -m "Open a run, record each step, finalise from the steps"
```

---

## Task 5: The field audit runs in three phases

**Files:**
- Modify: `apps/workbench/lib/fieldAudit/persist.ts`, `apps/workbench/lib/fieldAudit/run.ts`
- Test: `apps/workbench/tests/field-audit-persist.test.ts` (existing), `apps/workbench/tests/field-audit-run.test.ts` (existing)

- [ ] **Step 1: Restructure `runMatterAudit`**

`apps/workbench/lib/fieldAudit/run.ts` currently resolves inputs, runs the engine, then
calls `saveAuditRun`. It becomes:

1. `openRun` with the resolved inputs as `resolvedInputs` and `unitTotal` = `body.checks.length`
2. `runFieldAudit(...)` with `onUnitSettled` wired to `recordStep`
3. store findings, link each to its step, `finaliseRun`

`runFieldAudit` must accept and forward `onUnitSettled`. Add it to
`RunFieldAuditDependencies` and pass it straight through to `runPrompt` — the engine
already accepts it after Task 2. Do the same for `RunReviewDependencies` in Task 6.

- [ ] **Step 2: Delete `runStatusForAudit` and its local `RunStatus`**

`statusFromSteps` replaces it. Update `apps/workbench/tests/field-audit-persist.test.ts`,
which tests it — **rewrite those assertions against `statusFromSteps`, do not delete
them.** If you find yourself deleting a test, stop and report.

- [ ] **Step 3: Run the suite**

Run: `cd apps/workbench && npm run verify`
Expected: green.

- [ ] **Step 4: Prove a dead run leaves a record**

Add to `apps/workbench/tests/field-audit-run.test.ts` a test where the model caller throws
on every unit, asserting the run row was opened and steps were recorded — i.e. that the
failure is visible rather than absent. Use the existing stub-client idiom in that file.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "A field audit records itself as it goes"
```

---

## Task 6: The review runs in three phases

**Files:**
- Modify: `apps/workbench/lib/review/persist.ts`, `apps/workbench/app/api/staff/review/route.ts`
- Test: `apps/workbench/tests/run-status.test.ts`, `apps/workbench/tests/stored-run.test.ts` (existing)

- [ ] **Step 1: Restructure `saveRun` the same way**

The text layer is already persisted before the run row, so `text_layer_id` is available at
`openRun` — the `workflow_runs_review_needs_document` constraint holds. Confirm that
before you start by reading the current `saveRun`.

- [ ] **Step 2: Delete `runStatusFor` and its local `RunStatus`, rewrite the tests against `statusFromSteps`**

Same rule as Task 5: rewrite, never delete.

- [ ] **Step 3: Run the suite**

Run: `cd apps/workbench && npm run verify`
Expected: green, with the review's own behaviour tests unmodified.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "A review records itself as it goes"
```

---

## Task 7: Retry, for both kinds

**Files:**
- Create: `apps/workbench/lib/runs/retry.ts`
- Test: `apps/workbench/tests/run-retry.test.ts`

**Why not field-audit only.** Both kinds get steps, so both get a steps list, and a review
run showing failed steps with no way to retry them would be a worse gap than the extra
work. The machinery is the same either way: the only difference is how the units and the
pinned evidence are rebuilt — a review's from its `text_layer_id` (the layer's text and
blocks are already in `document_text_layers`, so nothing is re-fetched from R2), a field
audit's from `resolved_inputs`. Dispatch on `kind` at that one point and share the rest.

- [ ] **Step 1: Write the failing test — the property that matters most**

```ts
import { describe, expect, it } from 'vitest'
import { retryFailedSteps } from '@/lib/fieldAudit/retry'

describe('retrying a run', () => {
  it('calls the model only for the units that failed', async () => {
    // The whole point. A run that lost one check of six must cost one call to
    // fix, not six — and the five that succeeded must not be re-paid for.
    const called: string[] = []
    const client = stubClientWithRun({
      steps: [
        { unit_id: '1', status: 'succeeded', sequence: 0 },
        { unit_id: '2', status: 'failed', sequence: 1 },
        { unit_id: '3', status: 'succeeded', sequence: 2 },
      ],
    })
    await retryFailedSteps(client, 'run-1', {
      callModel: async (request) => { called.push(unitOf(request)); return reply() },
    })
    expect(called).toEqual(['2'])
  })

  it('replays against the evidence the run was pinned to, not the sheet as it is now', async () => {
    // A retry an hour later must answer the same question the run asked. A
    // sheet edited in between belongs to a fresh run, not this one.
    const client = stubClientWithRun({
      resolved_inputs: { concerns: 'the original words' },
      designSheetNow: { concerns: 'edited since' },
      steps: [{ unit_id: '1', status: 'failed', sequence: 0 }],
    })
    let seen = ''
    await retryFailedSteps(client, 'run-1', {
      callModel: async (request) => { seen = sheetTextOf(request); return reply() },
    })
    expect(seen).toContain('the original words')
    expect(seen).not.toContain('edited since')
  })

  it('uses the prompt version the run used, not whatever is published now', async () => {
    // A retry finishes the run it belongs to. Silently upgrading it to a
    // newer wording would make the run's findings answers to two questions.
    const client = stubClientWithRun({
      prompt_version_id: 'v1', publishedVersionId: 'v2',
      steps: [{ unit_id: '1', status: 'failed', sequence: 0 }],
    })
    await retryFailedSteps(client, 'run-1', { callModel: async () => reply() })
    expect(client.versionsRead).toEqual(['v1'])
  })

  it('does nothing when no step failed', async () => {
    const client = stubClientWithRun({ steps: [{ unit_id: '1', status: 'succeeded', sequence: 0 }] })
    let calls = 0
    const result = await retryFailedSteps(client, 'run-1', {
      callModel: async () => { calls += 1; return reply() },
    })
    expect(calls).toBe(0)
    expect(result).toEqual({ ok: true, retried: 0 })
  })
})
```

Write `stubClientWithRun`, `unitOf`, `sheetTextOf` and `reply` as local helpers in the test
file. Follow the stub-client idiom already used in
`apps/workbench/tests/review-real-document.test.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/run-retry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`retryFailedSteps(client, runId, deps)`:

1. Load the run: `id, kind, prompt_version_id, matter_id, resolved_inputs, text_layer_id, model`.
2. Load its steps; `unitsToRetry` gives the unit ids. Empty → return `{ ok: true, retried: 0 }` without touching anything.
3. Load **that** `prompt_version_id` — not the published version — and parse its body.
4. Filter the body's units to the retry set — `body.checks` for a field audit, `body.rules` for a review.
5. Rebuild the pinned evidence for the kind: `resolved_inputs` for a field audit; for a review, the layer read back from `document_text_layers` by `text_layer_id`. Run the matching engine with `onUnitSettled` wired to `recordStep`.
6. For each retried unit: delete the step's previous finding, then insert the new one and link it. See Task 8.
7. `finaliseRun` from the full step set.

Comment the pinned-evidence and pinned-version decisions where they are made, with the
reason, not the mechanism.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/workbench && npx vitest run tests/run-retry.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the first test can fail**

Temporarily change the unit filter to pass all checks through, and confirm
"calls the model only for the units that failed" fails with `['1','2','3']`. Restore.
Report the output. That test is the reason this slice exists; it must be shown to bite.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/runs/retry.ts apps/workbench/tests/run-retry.test.ts
git commit -m "Retry runs the units that failed and nothing else"
```

---

## Task 8: Replacing a superseded finding

**Files:**
- Modify: `apps/workbench/lib/runs/retry.ts`
- Test: `apps/workbench/tests/run-retry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it('replaces the finding its earlier attempt left, and only that one', async () => {
    // workflow_findings has unique (run_id, rule_number), so a retried unit's
    // new finding collides with its predecessor. The old one is a superseded
    // answer to the same question from the same run — keeping both would make
    // the constraint a lie. Another unit's finding is untouched.
    const client = stubClientWithRun({
      steps: [
        { unit_id: '1', status: 'succeeded', sequence: 0, finding_id: 'f1' },
        { unit_id: '2', status: 'failed', sequence: 1, finding_id: 'f2' },
      ],
    })
    await retryFailedSteps(client, 'run-1', { callModel: async () => reply() })
    expect(client.deletedFindings).toEqual(['f2'])
  })

  it('deletes nothing when the retried step never produced a finding', async () => {
    const client = stubClientWithRun({
      steps: [{ unit_id: '1', status: 'failed', sequence: 0, finding_id: null }],
    })
    await retryFailedSteps(client, 'run-1', { callModel: async () => reply() })
    expect(client.deletedFindings).toEqual([])
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/run-retry.test.ts`
Expected: FAIL — no deletion happens.

- [ ] **Step 3: Implement the replacement**

Delete by `finding_id` from the step row, not by `(run_id, rule_number)` — the step already
knows which finding it produced, and matching on the pair would delete a row the step never
claimed. `workflow_citations` and `workflow_field_references` cascade from
`workflow_findings`; confirm that in the migrations rather than assuming it, and say so in
a comment.

- [ ] **Step 4: Run to verify it passes**

Expected: PASS, 6 tests in the file.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "A retried unit replaces its own superseded finding"
```

---

## Task 9: A run view that works for either kind

**Files:**
- Create: `apps/workbench/app/prompts/[runId]/page.tsx`
- Create: `apps/workbench/app/runs/RunSteps.tsx` — the steps list and retry control, shared
- Create: `apps/workbench/lib/runs/history.ts` — `loadAnyRun`, kind-aware
- Modify: `apps/workbench/app/review/[runId]/page.tsx`, `StoredFindings.tsx`, `actions.ts`
- Modify: `apps/workbench/app/prompts/page.tsx` — it passes `runs={[]}` today
- Test: `apps/workbench/tests/stored-findings.test.tsx`, `apps/workbench/tests/run-history.test.ts`

**A field-audit run currently has nowhere to be seen.** `app/prompts/page.tsx` passes
`runs={[]}` and there is no `[runId]` route under it, so every audit run recorded so far is
invisible in the app. Steps and a retry button are worth nothing on a page that does not
exist.

**And the existing loader is review-shaped.** `apps/workbench/lib/review/history.ts` does
`documentVersionId: String(runRow.document_version_id)`, which yields the literal string
`"null"` for a field audit, and `loadRunSummaries` joins every run to a document name.
Confirm both by reading it before you change anything. Move the kind-agnostic parts to
`lib/runs/history.ts` as `loadAnyRun`, returning a document only when the run has one, and
leave the review's own view reading through it.

Fix that first, then add the steps to both views.

- [ ] **Step 1: Write the failing test**

```tsx
  it('names how many units a retry will re-run, because it costs money', () => {
    // A button that says only "Retry" invites being pressed without that
    // being a decision. It calls the model again.
    render(<StoredFindings {...props} steps={[
      { unitId: '1', status: 'succeeded', attempts: 1, sequence: 0, lastError: null },
      { unitId: '2', status: 'failed', attempts: 1, sequence: 1, lastError: 'overloaded' },
      { unitId: '3', status: 'failed', attempts: 2, sequence: 2, lastError: 'overloaded' },
    ]} />)
    expect(screen.getByRole('button', { name: /retry 2 failed/i })).toBeEnabled()
  })

  it('offers no retry when nothing failed', () => {
    render(<StoredFindings {...props} steps={[
      { unitId: '1', status: 'succeeded', attempts: 1, sequence: 0, lastError: null },
    ]} />)
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })

  it('shows why a step failed, and how many times it has been tried', () => {
    render(<StoredFindings {...props} steps={[
      { unitId: '2', status: 'failed', attempts: 3, sequence: 0, lastError: 'overloaded' },
    ]} />)
    expect(screen.getByText(/overloaded/)).toBeInTheDocument()
    expect(screen.getByText(/3/)).toBeInTheDocument()
  })
```

Read the existing `stored-findings.test.tsx` first and reuse its `props` fixture.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/workbench && npx vitest run tests/stored-findings.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`loadRun` in `apps/workbench/lib/review/history.ts` also loads the run's steps, ordered by
`sequence`. `StoredFindings` renders them and the retry control. `actions.ts` gains a
`retryRun` server action calling `retryFailedSteps`, following the shape of the existing
`recordDisposition` action.

- [ ] **Step 4: Run to verify it passes**

Expected: PASS.

- [ ] **Step 5: Build**

```bash
cd apps/workbench && VERCEL=1 \
  NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder \
  SUPABASE_SERVICE_ROLE_KEY=placeholder \
  npm run build
```
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Show what each unit did, and what a retry would cost"
```

---

## Task 10: The check no test can stand in for

A real run with a real induced failure, retried against the real database, reported before
this is called done. Requires credentials — whoever holds them runs this.

- [ ] **Step 1: Induce a real failure**

Run a field audit against a real matter with a model caller that throws on one check
(wrap `anthropicModelCaller()` and fail, say, check 3). Confirm the run is recorded
`partial`, with five `succeeded` steps and one `failed` carrying its error.

- [ ] **Step 2: Retry with a working caller**

Call `retryFailedSteps` with the real caller and **count the model calls**. It must be
exactly one. Report the count — that number is the whole slice.

- [ ] **Step 3: Confirm the run is now whole**

The run's status is `completed`, `failed_count` is 0, six findings exist, and the five
untouched findings still carry their original `created_at`. That last one is the proof
they were not silently rewritten.

- [ ] **Step 4: Confirm the pinned evidence held**

Edit the matter's design sheet between the run and the retry, and confirm the retried check
saw the original values. Restore the sheet afterwards.

- [ ] **Step 5: Clean up**

Remove any scratch script and the credential copy. Report what test data was left behind
and how to remove it.

---

## Verification checklist

- [ ] `cd apps/workbench && npm run verify` passes.
- [ ] Root `npm run lint`, `npm run typecheck`, `npm test` pass.
- [ ] `node scripts/checkDbColumns.mjs` passes with the new columns counted.
- [ ] `tests/query-columns.test.ts` green **without being edited**.
- [ ] `VERCEL=1 … npm run build` succeeds.
- [ ] `runStatusFor` and `runStatusForAudit` are both gone, along with their two local `RunStatus` declarations, with their tests rewritten rather than deleted.
- [ ] A field-audit run can be opened and read in the app, which it could not before.
- [ ] A real retry re-ran exactly the failed unit, and the count was reported.
