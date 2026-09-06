# Output Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A prompt version declares what a run produces — `chat` (nothing), `task_set` (one task per finding), or `checklist` (one task, one item per finding) — and the design-sheet audit switches to `checklist`.

**Architecture:** `outputTarget` is a field of the field-audit arm of the prompt **body**, so it is pinned to an immutable version and an old run stays interpretable (see `docs/superpowers/specs/2026-09-06-output-targets-design.md`). `emitTasks` stops taking a `unitIds` hint — which #412 silently stopped passing, leaving a duplicate-task regression — and instead computes one plan from content identity: keep the tasks that already say what this run wants to say, insert what is missing, withdraw the rest. Both `batch_tag` shapes fall out of that with no special case. Separately, the root app learns to label a `source: 'prompt'` task, which it has never done.

**Tech Stack:** TypeScript, zod, vitest, Supabase Postgres (plpgsql migrations), Next.js 16 App Router.

---

## Read this first

**Worktree.** Every command runs from
`/Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.claude/worktrees/workbench-app-improvements-e03851`.
Do not `cd` to the repository root. Never use `git stash` — the stash stack is shared with
the main checkout and other worktrees.

**Two apps, one repo.** The repository root is the old app (`lib/`, `app/`, `components/`,
`tests/`). The workbench is `apps/workbench/`. Shared pure code is `packages/citations/`.
Task 6 touches the **root app**; everything else touches the workbench and packages.

**Naming.** The overhaul plan writes the concept as `output_target`. Inside the prompt body
the field is **`outputTarget`**, camelCase, because that is what the body already uses —
`taskTemplate`, not `task_template`. Snake case in this codebase belongs to database
columns, and this is not one.

**Client data is privileged.** When reporting a real run (Task 8), print counts, check
numbers, field keys and paths. Never paste a client's field values or a finding's full
rationale into the conversation or a commit message.

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/citations/src/prompt/body.ts` | Modify: `outputTarget` on the field-audit arm, defaulting to `task_set`. |
| `packages/citations/tests/prompt-body.test.ts` | Modify (or create): the schema's acceptance and refusal of targets. |
| `apps/workbench/lib/fieldAudit/tasks.ts` | Modify: `planEmit` replaces the two `tasksToSupersede*` functions; `taskRowsFor` takes a target and can build a checklist row; `emitTasks` short-circuits on `chat`. |
| `apps/workbench/tests/field-audit-tasks.test.ts` | Modify: replace the `tasksToSupersede*` suites with `planEmit`'s; add the checklist and chat cases. |
| `apps/workbench/app/api/cron/tick/route.ts` | Modify: pass the target and the prompt title through to `emitTasks`. |
| `lib/tasks/types.ts` (root app) | Modify: `'prompt'` joins `TASK_SOURCES`, with a label and an AA-contrast pill. |
| `tests/task-pill-contrast.test.ts` (root app) | Modify: assert the label and pill maps are total, which is what would have caught this. |
| `supabase/migrations/20261104000000_design_sheet_audit_v4.sql` | Create: version 4 of `ma-design-sheet-audit`, identical to version 3 but for `"outputTarget":"checklist"`. |

---

### Task 1: `outputTarget` in the field-audit body schema

The schema admits only the three implemented targets. It must **default** rather than
require: `promptBodySchema` re-validates every body on every read
(`apps/workbench/lib/prompts/repository.ts:49`), and versions 1 to 3 of
`ma-design-sheet-audit` are already published with no such field. A required field would
make `loadPromptVersionById` throw for every existing run — breaking the run pages and
retry for runs already in the database. `.default('task_set')` parses those bodies and gives
them exactly the behaviour they have always had.

**Files:**
- Modify: `packages/citations/src/prompt/body.ts:45-49`
- Test: `apps/workbench/tests/prompt-body.test.ts` (the existing suite for this schema — `packages/citations` has no test runner of its own)

- [ ] **Step 1: Find the existing body tests**

Run:

```bash
ls apps/workbench/tests/ | grep -i -E "body|prompt"
```

Expected: `prompt-body.test.ts` among them. **`packages/citations` has no test runner** —
the root `vitest.config.ts` includes `tests/**` relative to the repo root and
`apps/workbench/vitest.config.ts` includes `tests/**` relative to that app, so nothing
picks up a file under `packages/`. The existing suite for `promptBodySchema` is
`apps/workbench/tests/prompt-body.test.ts`, importing it as
`@aubrey-law/citations/prompt/body`. Append the Step 2 block there.

Note for every later task: a workbench test must be run from `apps/workbench`. A command
like `npx vitest run apps/workbench/tests/x.test.ts` from the repo root matches no files and
**reports success**, which is worse than failing.

- [ ] **Step 2: Write the failing tests**

Add to `apps/workbench/tests/prompt-body.test.ts`, which already covers this schema:

```ts
describe('outputTarget', () => {
  /** The minimum valid field-audit body, with no outputTarget stated. */
  function bodyWithout(): Record<string, unknown> {
    return {
      kind: 'field_audit',
      inputs: [{ key: 'concerns', source: 'design_sheet.concerns', required: true }],
      checks: [
        {
          number: '1',
          statement: 'Every concern has a provision.',
          risk: 'blocker',
          reads: ['concerns'],
          taskTemplate: { title: 'A concern is unanswered', description: 'Confirm it.', priority: 'high' },
        },
      ],
    }
  }

  /**
   * The load-bearing case. Versions 1 to 3 of `ma-design-sheet-audit` are
   * published without this field, and `toPublishedPrompt` re-validates every
   * body on every read — so a required field would throw for every run
   * already in the database, not merely for new ones.
   */
  it('defaults to task_set, so a body published before it existed still parses', () => {
    const parsed = promptBodySchema.parse(bodyWithout())
    expect(parsed.kind).toBe('field_audit')
    if (parsed.kind !== 'field_audit') throw new Error('unreachable')
    expect(parsed.outputTarget).toBe('task_set')
  })

  it.each(['chat', 'task_set', 'checklist'] as const)('accepts %s', (target) => {
    const parsed = promptBodySchema.parse({ ...bodyWithout(), outputTarget: target })
    if (parsed.kind !== 'field_audit') throw new Error('unreachable')
    expect(parsed.outputTarget).toBe(target)
  })

  /**
   * The overhaul plan names five targets; two are not built. A schema that
   * accepted them would let someone publish a prompt that silently produces
   * nothing, which is the failure mode this whole project keeps finding.
   */
  it.each(['draft_doc', 'email_draft', 'tasks', ''])('refuses the unimplemented target %s', (target) => {
    expect(promptBodySchema.safeParse({ ...bodyWithout(), outputTarget: target }).success).toBe(false)
  })

  it('does not accept outputTarget on a review body', () => {
    const review = {
      kind: 'review',
      inputs: [],
      rules: [],
      outputTarget: 'checklist',
    }
    // Refused for having no rules, whatever happens to the extra key — the
    // point is that the review arm gains nothing here.
    expect(promptBodySchema.safeParse(review).success).toBe(false)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```bash
cd apps/workbench && npx vitest run tests/prompt-body.test.ts
```

Expected: **all** the new cases FAIL. The `defaults to task_set` and `accepts %s` cases fail
because `parsed.outputTarget` is `undefined`, and TypeScript reports that `outputTarget`
does not exist on the field-audit type.

The `refuses` cases fail too, and it is worth being precise about why, because the obvious
guess is backwards: zod **strips** an unknown key rather than rejecting it, so before the
schema knows about `outputTarget`, `safeParse` *succeeds* and `expect(success).toBe(false)`
fails. They are real red-to-green tests, not cases that pass for the wrong reason. If you
see them pass at this step, something is wrong — do not weaken the assertions to match.

- [ ] **Step 4: Add the field to the schema**

In `packages/citations/src/prompt/body.ts`, replace `fieldAuditBodySchema` (lines 45-49):

```ts
/**
 * What a run produces. Three values, not the overhaul plan's five: `draft_doc`
 * and `email_draft` need R2 write access, a document-creation path outside the
 * root app's drafting engine, and above all an answer to what verifies
 * generated prose — a claim with no source to check it against. Admitting a
 * value nothing implements would let someone publish a prompt that silently
 * produces nothing.
 */
export const outputTargetSchema = z.enum(['chat', 'task_set', 'checklist'])

export const fieldAuditBodySchema = z.object({
  kind: z.literal('field_audit'),
  inputs: z.array(promptInputSchema),
  checks: z.array(fieldAuditCheckSchema).min(1),
  /**
   * Defaulted, never required. `toPublishedPrompt` re-validates every body on
   * every read, and versions 1 to 3 of `ma-design-sheet-audit` are already
   * published without this field — so requiring it would not reject a bad new
   * prompt, it would throw on every run already in the database. The default
   * is `task_set` because that is what those versions in fact did.
   */
  outputTarget: outputTargetSchema.default('task_set'),
})
```

And add to the exported types at the bottom of the file, after the existing `PromptInput`
line:

```ts
export type OutputTarget = z.infer<typeof outputTargetSchema>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
cd apps/workbench && npx vitest run tests/prompt-body.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 6: Confirm nothing else broke**

Run:

```bash
cd apps/workbench && npx vitest run
```

Expected: PASS. `outputTarget` is now a non-optional property of the parsed field-audit
type, so any code constructing a `FieldAuditBody` literal in a test will fail to compile —
fix those by adding `outputTarget: 'task_set'` to the literal, which is what those bodies
meant.

- [ ] **Step 7: Commit**

```bash
git add packages/citations/src/prompt/body.ts packages/citations/tests/prompt-body.test.ts
git commit -m "A prompt version says what its run produces

Three targets, not the plan's five. draft_doc and email_draft need R2 write
access and a document-creation path the workbench does not have, and neither
has an answer to what verifies generated prose when the claim has no source to
check against — so admitting the value would let someone publish a prompt that
silently produces nothing.

Defaulted rather than required. toPublishedPrompt re-validates every body on
every read, and versions 1 to 3 of ma-design-sheet-audit are published without
this field: requiring it would throw for every run already in the database
rather than reject a bad new prompt. The default is task_set because that is
what those versions did.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `planEmit` — one decision for keep, insert and withdraw

This replaces `tasksToSupersede` and `tasksToSupersedeForUnits`, and it fixes a live
regression. `emitTasks` accepts a `unitIds` argument that switches between them; **nothing
passes it**. `git log -S "unitIds:"` shows `unitIds: retryUnitIds` in `retry.ts` until #412
moved `emitTasks` into the tick, where it was never reinstated. So a retried run reaching
`done` a second time inserts a task for every actionable finding again, including the units
that never failed, whose first-pass task survives because `tasksToSupersede` excludes this
run's own id. There is no unique index on `batch_tag` to stop it.

The fix is not to re-thread `unitIds`. `emitTasks` already reads the existing tasks *before*
inserting (`apps/workbench/lib/fieldAudit/tasks.ts:226`, deliberately), so the snapshot can
never contain rows the call just wrote — which is the only thing the run-id exclusion was
protecting against. Drop it, and one question answers everything: of this tool's own open,
unassigned tasks on this matter, which already say exactly what this run wants to say?

**Files:**
- Modify: `apps/workbench/lib/fieldAudit/tasks.ts`
- Test: `apps/workbench/tests/field-audit-tasks.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `apps/workbench/tests/field-audit-tasks.test.ts`. It already has `check()`, `finding()`
and `existingTask()` helpers — reuse them rather than declaring new ones under the same
names. Three edits:

**(a)** Replace the import block (lines 1-10) with:

```ts
import { describe, expect, it } from 'vitest'
import {
  PROMPT_TASK_SOURCE,
  planEmit,
  taskRowsFor,
  type ExistingPromptTask,
  type TaskRow,
} from '@/lib/fieldAudit/tasks'
import type { FieldAuditCheck } from '@aubrey-law/citations/prompt/body'
import type { FieldAuditFinding } from '@aubrey-law/citations/fieldAudit/types'
```

**(b)** `ExistingPromptTask` gains five content fields, so give the existing `existingTask`
helper defaults for them. Replace it where it sits, just after the `taskRowsFor` suite
(around line 99):

```ts
const existingTask = (over: Partial<ExistingPromptTask> = {}): ExistingPromptTask => ({
  id: 'task-1',
  source: PROMPT_TASK_SOURCE,
  batchTag: 'prompt:run-old',
  status: 'open',
  assigneeId: null,
  title: 'A stated concern is not answered by the plan',
  description: 'Whatever it said last time.',
  priority: 'high',
  taskType: 'single',
  checklist: [],
  ...over,
})
```

**(c)** Delete the whole `describe('tasksToSupersede', ...)` and
`describe('tasksToSupersedeForUnits', ...)` blocks — they begin around lines 108 and 181 and
run to the end of the file — and append this in their place:

```ts
describe('planEmit', () => {
  /** A row this run wants to exist, matching `existingTask`'s content. */
  function desiredRow(overrides: Partial<TaskRow> = {}): TaskRow {
    return {
      matter_id: 'matter-1',
      source: PROMPT_TASK_SOURCE,
      task_type: 'single',
      auto: true,
      batch_tag: 'prompt:run-new#1',
      title: 'A stated concern is not answered by the plan',
      description: 'Whatever it said last time.',
      priority: 'high',
      checklist: [],
      ...overrides,
    }
  }

  /** One of this run's own open, unassigned tasks. */
  function open(overrides: Partial<ExistingPromptTask> = {}): ExistingPromptTask {
    return existingTask({ batchTag: 'prompt:run-new#1', ...overrides })
  }

  it('inserts everything and withdraws a previous run’s set on a first run', () => {
    const plan = planEmit([open({ id: 'old-1', batchTag: 'prompt:run-old#1' })], [desiredRow()])
    expect(plan.insert).toHaveLength(1)
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['old-1'])
  })

  /**
   * The regression this function exists to fix. #412 stopped passing
   * `unitIds`, so a retried run's second done-pass re-inserted a task for
   * every unit — including the ones that never failed, whose task survived
   * because the old filter excluded this run's own id. Nothing in the
   * database stops it: `tasks` has no unique index on `batch_tag`.
   */
  it('inserts nothing and withdraws nothing when the run already said this', () => {
    const plan = planEmit([open()], [desiredRow()])
    expect(plan.insert).toEqual([])
    expect(plan.keep).toEqual(['task-1'])
    expect(plan.supersede).toEqual([])
  })

  it('replaces a task whose rationale changed, and only that one', () => {
    const plan = planEmit(
      [
        open({ id: 'unit-1', batchTag: 'prompt:run-new#1' }),
        open({ id: 'unit-2', batchTag: 'prompt:run-new#2', title: 'A person is missing' }),
      ],
      [
        desiredRow({ batch_tag: 'prompt:run-new#1' }),
        desiredRow({
          batch_tag: 'prompt:run-new#2',
          title: 'A person is missing',
          description: 'Now it says something else.',
        }),
      ],
    )
    // Unit 1 is untouched: same id, same created_at, no churn.
    expect(plan.keep).toEqual(['unit-1'])
    expect(plan.supersede).toEqual(['unit-2'])
    expect(plan.insert.map((row) => row.batch_tag)).toEqual(['prompt:run-new#2'])
  })

  it('withdraws a task for a finding this run no longer makes', () => {
    const plan = planEmit([open({ id: 'gone', batchTag: 'prompt:run-new#9' })], [])
    expect(plan.insert).toEqual([])
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['gone'])
  })

  /** A duplicate pair left by the pre-fix bug has only one twin to match. */
  it('self-heals a duplicate left by the earlier bug', () => {
    const plan = planEmit([open({ id: 'first' }), open({ id: 'second' })], [desiredRow()])
    expect(plan.insert).toEqual([])
    expect(plan.keep).toEqual(['first'])
    expect(plan.supersede).toEqual(['second'])
  })

  it('never touches a task someone else made, holds, or has moved on', () => {
    const plan = planEmit(
      [
        existingTask({ id: 'manual', source: 'manual', batchTag: null }),
        existingTask({ id: 'assigned', batchTag: 'prompt:run-old#1', assigneeId: 'user-1' }),
        existingTask({ id: 'done', batchTag: 'prompt:run-old#2', status: 'done' }),
        existingTask({ id: 'in-progress', batchTag: 'prompt:run-old#3', status: 'in_progress' }),
      ],
      [desiredRow()],
    )
    expect(plan.supersede).toEqual([])
    expect(plan.insert).toHaveLength(1)
  })

  /** The checklist tag has no unit suffix and needs no special case. */
  it('treats a run-level tag exactly like a unit-level one', () => {
    const row = desiredRow({
      batch_tag: 'prompt:run-new',
      task_type: 'checklist',
      checklist: [{ text: 'One', done: false }],
    })
    const same = existingTask({
      id: 'list',
      batchTag: 'prompt:run-new',
      taskType: 'checklist',
      checklist: [{ text: 'One', done: false }],
    })
    expect(planEmit([same], [row])).toEqual({ insert: [], keep: ['list'], supersede: [] })

    const changed = existingTask({
      id: 'list',
      batchTag: 'prompt:run-new',
      taskType: 'checklist',
      checklist: [{ text: 'Two', done: false }],
    })
    const plan = planEmit([changed], [row])
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['list'])
    expect(plan.insert).toHaveLength(1)
  })

  /**
   * A ticked item is someone's progress. `planEmit` only inserts and archives,
   * so "not matching" means archived-and-replaced-with-a-blank-copy, never
   * rewritten in place — which is why `done` is outside the content key.
   */
  it('keeps a checklist someone has partly ticked, so their progress survives', () => {
    const row = desiredRow({
      batch_tag: 'prompt:run-new',
      task_type: 'checklist',
      checklist: [
        { text: 'One', done: false },
        { text: 'Two', done: false },
      ],
    })
    const ticked = existingTask({
      id: 'list',
      batchTag: 'prompt:run-new',
      taskType: 'checklist',
      checklist: [
        { text: 'One', done: true },
        { text: 'Two', done: false },
      ],
    })
    expect(planEmit([ticked], [row])).toEqual({ insert: [], keep: ['list'], supersede: [] })
  })

  /** But a checklist whose *items* changed is a different checklist. */
  it('replaces a checklist whose item text changed, ticks or not', () => {
    const row = desiredRow({
      batch_tag: 'prompt:run-new',
      task_type: 'checklist',
      checklist: [{ text: 'One', done: false }],
    })
    const ticked = existingTask({
      id: 'list',
      batchTag: 'prompt:run-new',
      taskType: 'checklist',
      checklist: [{ text: 'Something else', done: true }],
    })
    const plan = planEmit([ticked], [row])
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['list'])
    expect(plan.insert).toHaveLength(1)
  })

  /** `priority` alone, because Task 3 makes it a *derived* value — the highest
   *  among the contributing checks — which is the kind of field a later
   *  refactor gets wrong without anything failing. */
  it('replaces a task whose priority alone changed', () => {
    const plan = planEmit([open({ priority: 'normal' })], [desiredRow()])
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['task-1'])
    expect(plan.insert).toHaveLength(1)
  })

  /** The mirror of the self-heal case: one existing row against two identical
   *  desired rows must keep it once and insert the second, which is where an
   *  off-by-one in `matched` would show. */
  it('claims each twin at most once when two desired rows are identical', () => {
    const plan = planEmit([open({ id: 'only' })], [desiredRow(), desiredRow()])
    expect(plan.keep).toEqual(['only'])
    expect(plan.insert).toHaveLength(1)
    expect(plan.supersede).toEqual([])
  })
})
```


- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd apps/workbench && npx vitest run tests/field-audit-tasks.test.ts
```

Expected: FAIL — `planEmit` is not exported from `@/lib/fieldAudit/tasks`, and
`ExistingPromptTask` has no `title`, `description`, `priority`, `taskType` or `checklist`.

- [ ] **Step 3: Widen `ExistingPromptTask` and `TaskRow`, and add `planEmit`**

In `apps/workbench/lib/fieldAudit/tasks.ts`, replace the `TaskRow` interface (lines 18-27):

```ts
/**
 * A checklist item as `public.tasks.checklist` holds them. Declared here
 * rather than imported from the root app's `lib/tasks/types.ts`: this is a
 * separate app with its own module graph, and the shared contract is the
 * column, not a TypeScript file across an app boundary.
 */
export type ChecklistItem = {
  text: string
  done: boolean
}

export interface TaskRow {
  matter_id: string
  source: string
  task_type: string
  auto: boolean
  batch_tag: string
  title: string
  description: string
  priority: string
  /** Empty for a `single` task; one entry per finding for a `checklist` one. */
  checklist: ChecklistItem[]
}
```

Replace the `ExistingPromptTask` interface (lines 76-82):

```ts
/**
 * An existing prompt task, with everything `planEmit` compares.
 *
 * The content fields are here because identity is by content: a task that
 * already says exactly what this run wants to say is the same task, and
 * re-creating it would churn its id and its `created_at` for nothing.
 */
export interface ExistingPromptTask {
  id: string
  source: string
  batchTag: string | null
  status: string
  assigneeId: string | null
  title: string
  description: string
  priority: string
  taskType: string
  checklist: ChecklistItem[]
}
```

Delete `parseBatchTag` (lines 84-101), `tasksToSupersede` (lines 103-138) and
`tasksToSupersedeForUnits` (lines 140-173) entirely, and put this in their place:

```ts
export interface EmitPlan {
  /** Rows to create. */
  insert: TaskRow[]
  /** Ids left exactly as they are, because they already say this. */
  keep: string[]
  /** Ids to withdraw. */
  supersede: string[]
}

/**
 * Everything this call compares, as one string: tag, title, description,
 * priority, type, and the checklist items' text. Byte-identical, not
 * semantically equivalent — the description embeds the model's own rationale,
 * so a re-executed unit churns even when the finding is substantively the
 * same. That is the intended trade; a comparison that tried to judge
 * "substantively the same" would be a second verifier with nothing to verify
 * against.
 *
 * **An item's `done` flag is deliberately excluded.** `planEmit` only inserts
 * and archives — it has no branch that rewrites a row in place. So including
 * `done` would mean a partly-ticked checklist stops matching, gets archived,
 * and is replaced by a blank copy, taking the attorney's progress out of the
 * working queue. Excluding it means the keys match, the row is kept untouched,
 * and the ticks survive along with its id and `created_at`. Nothing is lost:
 * if the findings really changed, the rationales in the description changed
 * with them and the key mismatches on its own merits. `done` differs only when
 * a person changed it, which is the one case that must not cause a withdrawal.
 *
 * The item text is read positionally rather than by stringifying each item
 * object, because `jsonb` sorts object keys on the way in — a stored item
 * comes back as `{"done":…,"text":…}` whatever order it was written in, so
 * stringifying the objects would make every checklist comparison fail
 * forever, silently, from the first real run.
 */
function contentKey(parts: {
  batchTag: string | null
  title: string
  description: string
  priority: string
  taskType: string
  checklist: ChecklistItem[]
}): string {
  return JSON.stringify([
    parts.batchTag,
    parts.title,
    parts.description,
    parts.priority,
    parts.taskType,
    // Text only — see the note above on why `done` is excluded.
    parts.checklist.map((item) => item.text),
  ])
}

/**
 * What a run should create, keep and withdraw — one question, replacing the
 * two functions this used to be.
 *
 * `tasksToSupersede` and `tasksToSupersedeForUnits` split on whether the
 * caller passed the unit ids a retry had touched. Nothing passed them: #411
 * added the mechanism in `retry.ts`, #412 moved `emitTasks` into the tick and
 * dropped the argument, and the result was that a retried run's second
 * done-pass re-created a task for every unit including the ones that never
 * failed. `tasks` has no unique index on `batch_tag`, so the duplicates simply
 * appeared.
 *
 * Asking about content instead of about units removes the need for the hint
 * altogether, and is what makes this idempotent: run it twice over an
 * unchanged run and the second call does nothing at all — provided nobody
 * edited the tasks in between, since a hand-edited title or description is a
 * content change like any other.
 *
 * Idempotent *within a run*, to be exact. The tag carries the run id, so a
 * genuinely new run is new content and an unchanged finding still archives and
 * re-inserts. That is what the advisory logic in `lib/runs/advisory.ts`
 * expects — a newer run's answer replaces an older one's — but it means the
 * anti-churn argument below holds only for a run re-emitting its own tasks. A retried unit whose
 * rationale changed no longer matches, so it is withdrawn and re-created; a
 * unit the retry never touched matches exactly, so it keeps its id and its
 * `created_at`. Both `batch_tag` shapes — `prompt:<runId>#<unitId>` for a
 * task set and `prompt:<runId>` for a checklist — fall out of this with
 * neither being special-cased, which is why `parseBatchTag` is gone too.
 *
 * Narrow on the same three axes it always was, for the same reasons:
 *
 *  - `source === PROMPT_TASK_SOURCE` only. A tool may withdraw its own
 *    suggestion; it must never touch a task a person added by hand, or one the
 *    stage engine or the SLA plan is tracking.
 *  - `status === 'open'` only. A `done` task is a record of work that
 *    happened; a `blocked` or `in_progress` one has something underway on it.
 *  - `assigneeId === null` only. The moment someone picks it up, a suggested
 *    task is real work someone is doing, and a newer run not surfacing the
 *    same finding does not make that work moot.
 *
 * What is *not* narrowed, and should be: this is scoped to the matter, not to
 * the prompt. Two prompts emitting tasks on one matter would each withdraw the
 * other's. That was true before this change too — it is invisible only
 * because one prompt emits tasks and the review prompt does not — and fixing
 * it means putting the prompt into the tag, which is its own decision. See
 * the design note.
 */
export function planEmit(existing: ExistingPromptTask[], desired: TaskRow[]): EmitPlan {
  const candidates = existing.filter(
    (task) => task.source === PROMPT_TASK_SOURCE && task.status === 'open' && task.assigneeId === null,
  )

  const byContent = new Map<string, string[]>()
  for (const task of candidates) {
    const key = contentKey({
      batchTag: task.batchTag,
      title: task.title,
      description: task.description,
      priority: task.priority,
      taskType: task.taskType,
      checklist: task.checklist,
    })
    const ids = byContent.get(key)
    if (ids) ids.push(task.id)
    else byContent.set(key, [task.id])
  }

  const keep: string[] = []
  const insert: TaskRow[] = []
  const matched = new Set<string>()

  for (const row of desired) {
    const key = contentKey({
      batchTag: row.batch_tag,
      title: row.title,
      description: row.description,
      priority: row.priority,
      taskType: row.task_type,
      checklist: row.checklist,
    })
    // The first twin not already claimed. A duplicate pair left by the
    // pre-fix bug therefore keeps one and withdraws the other, which is how
    // this self-heals rather than preserving the damage.
    const twin = byContent.get(key)?.find((id) => !matched.has(id))
    if (twin) {
      matched.add(twin)
      keep.push(twin)
    } else {
      insert.push(row)
    }
  }

  const supersede = candidates.filter((task) => !matched.has(task.id)).map((task) => task.id)
  return { insert, keep, supersede }
}
```

- [ ] **Step 4: Fix the comment that names the deleted function**

`apps/workbench/lib/runs/advisory.ts:98` explains itself by pointing at
`tasksToSupersede`, which no longer exists. A comment naming a function that is gone sends
the next reader looking for it. Replace that sentence:

```ts
 * are stale answers to a question already re-answered. `planEmit`
 * (`lib/fieldAudit/tasks.ts`) already encodes exactly this notion for the
 * tasks a run emits — a newer run's tasks replace an older run's, not add to
 * them — and this is the same idea applied to the advisory instead of
 * inventing a second one.
```

Then confirm nothing else refers to either deleted function:

```bash
grep -rn "tasksToSupersede\|parseBatchTag" --include="*.ts" --include="*.tsx" apps packages lib app components
```

Expected: hits **only** inside `apps/workbench/lib/fieldAudit/tasks.ts`, and only in two places
— `planEmit`'s own doc comment, which names what it replaced deliberately, and inside
`EmitTasksInput`/`emitTasks`, which Task 3 rewrites wholesale. Fixing that second group now
would only churn code Task 3 replaces, so leave it. A hit in any *other* file is a real
problem: report it rather than fixing it, since it means something depended on the old
behaviour.


- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
cd apps/workbench && npx vitest run tests/field-audit-tasks.test.ts
```

Expected: the `planEmit` suite PASSES. The `taskRowsFor` and `emitTasks` suites in the same
file will FAIL to compile, because `TaskRow` now has a `checklist` field their fixtures do
not set and `emitTasks` still references the deleted functions. That is Task 3.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/fieldAudit/tasks.ts apps/workbench/tests/field-audit-tasks.test.ts apps/workbench/lib/runs/advisory.ts
git commit -m "One question decides which tasks a run creates, keeps and withdraws

emitTasks took a unitIds hint that chose between tasksToSupersede and
tasksToSupersedeForUnits. Nothing passed it. #411 added the mechanism in
retry.ts so a retry could replace one unit's task without touching the others;
#412 moved emitTasks out of retry and into the tick and never reinstated the
argument. So tasksToSupersedeForUnits was dead code, and a retried run
reaching done a second time inserted a task for every actionable finding again
-- including the units that never failed, whose first-pass task survived
because tasksToSupersede excluded this run's own id. tasks has no unique index
on batch_tag, so the duplicates simply appeared. No live duplicates exist only
because the prompt tasks happened to be cleared by hand yesterday.

Re-threading unitIds was the obvious fix and is the wrong one. emitTasks
already reads the existing tasks before inserting anything, deliberately, so
the snapshot can never contain rows the call just wrote -- which is the only
thing the run-id exclusion protected against. Removing it lets one question
answer the whole thing: of this tool's own open, unassigned tasks on this
matter, which already say exactly what this run wants to say?

That makes it idempotent, which is the property that was missing. It also
means both batch_tag shapes work with neither special-cased, so parseBatchTag
is gone; a checklist run's suffix-less tag needs no second code path. And a
duplicate pair left by the bug has only one twin among the desired rows, so
the other is withdrawn -- it self-heals.

Still scoped to the matter rather than the prompt, so two task-emitting
prompts would each withdraw the other's. Unchanged by this commit and
invisible today because only one prompt emits tasks; noted in the design.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `taskRowsFor` builds a checklist, and `emitTasks` uses the plan

`chat` short-circuits inside `emitTasks` rather than at the call site, so it holds for every
caller. It must return before the query, not merely produce no rows: a `chat` run whose
`desired` is empty would otherwise withdraw every open prompt task on the matter, which is
not "produces no objects" — it is "destroys other prompts' objects".

**Two things Task 2 left for you, found while it ran:**

1. `checklist: ChecklistItem[]` on `TaskRow` does not type-check at the `insert` call.
   The generated column type is `Json`, and an `interface` is not assignable to it. Fix it
   at the type, never with `as never` at the boundary — and fix it by making
   `ChecklistItem` a **type alias**, which is the whole change:

   ```ts
   /**
    * A checklist item as `public.tasks.checklist` holds them.
    *
    * A `type` rather than an `interface` on purpose. The generated column type
    * is `Json`, and TypeScript synthesises an implicit index signature for an
    * object *type alias* but not for an *interface* — so this is assignable to
    * `Json` with no cast at the `insert`, while still rejecting an excess
    * property. As an interface it would need an explicit
    * `[key: string]: string | boolean` to satisfy `Json`, and that signature
    * would then quietly accept any misspelled field. Nothing extends or
    * re-opens this type, so the interface bought nothing.
    *
    * Declared here rather than imported from the root app's
    * `lib/tasks/types.ts`: that is a separate app whose `@/*` resolves to a
    * different root, and the shared contract is the column, not a TypeScript
    * file across an app boundary.
    */
   export type ChecklistItem = {
     text: string
     done: boolean
   }
   ```

   If that turns out not to satisfy the generated `Json` type, report
   DONE_WITH_CONCERNS with the exact error rather than reaching for `as never` — a cast
   there would hide a genuine mismatch between what this writes and what the column holds.

2. `EmitTasksInput.unitIds` is still declared, and `emitTasks` still filters
   `input.findings` by it. `planEmit` needs no such hint — that parameter *was* the bug.
   Step 4 replaces the whole interface, so both go; make sure neither survives.

**Files:**
- Modify: `apps/workbench/lib/fieldAudit/tasks.ts`
- Test: `apps/workbench/tests/field-audit-tasks.test.ts`

- [ ] **Step 1: Write the failing tests**

Two edits.

**First, the five existing `taskRowsFor` calls.** Its signature gains two arguments, so
every call in the `describe('taskRowsFor', ...)` suite (lines 42-97) needs
`, 'task_set', 'Audit'` appended, and the fully-specified expected row in its first test
needs `checklist: []` after `priority: 'high'`. The first becomes:

```ts
    const rows = taskRowsFor('matter-1', 'run-1', [check()], [finding()], 'task_set', 'Audit')

    expect(rows).toEqual([
      {
        matter_id: 'matter-1',
        source: PROMPT_TASK_SOURCE,
        task_type: 'single',
        auto: true,
        batch_tag: 'prompt:run-1#1',
        title: 'A stated concern is not answered by the plan',
        description:
          'The design sheet records a concern the structured decisions do not address.\n\n' +
          'The client raised a concern about the stepchildren that the residuary never answers.',
        priority: 'high',
        checklist: [],
      },
    ])
```

**Then append a new suite**, reusing the file's own `check()` and `finding()` helpers —
both take a `Partial<>` override, which is the idiom here:

```ts
const CHECK_2 = check({
  number: '2',
  taskTemplate: {
    title: 'A person named in the notes is missing from the plan',
    description: 'Someone is named in free text but appears in no structured field.',
    priority: 'normal',
  },
})
/**
 * Check 2 first, deliberately. Declared in numeric order, body order and
 * check-number order coincide — and the ordering test below could then not
 * tell a body-order sort from a sort on `checkNumber`, which would pass today
 * and diverge the moment a prompt declares its checks out of order, or reaches
 * check 10, which sorts before check 2 as a string.
 */
const CHECKS = [CHECK_2, check({ number: '1' })]

const FINDING_1 = finding({ checkNumber: '1', rationale: 'Because the residuary never answers it.' })
const FINDING_2 = finding({ checkNumber: '2', rationale: 'And nobody named Ruth appears anywhere.' })

describe('taskRowsFor with an output target', () => {
  it('produces no rows at all for chat', () => {
    expect(taskRowsFor('matter-1', 'run-1', CHECKS, [FINDING_1], 'chat', 'Audit')).toEqual([])
  })

  it('produces one single task per finding for task_set', () => {
    const rows = taskRowsFor('matter-1', 'run-1', CHECKS, [FINDING_1, FINDING_2], 'task_set', 'Audit')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.task_type)).toEqual(['single', 'single'])
    // Body order here too: `CHECKS` declares check 2 first.
    expect(rows.map((row) => row.batch_tag)).toEqual(['prompt:run-1#2', 'prompt:run-1#1'])
    expect(rows.every((row) => row.checklist.length === 0)).toBe(true)
  })

  it('produces exactly one checklist task carrying an item per finding', () => {
    const rows = taskRowsFor('matter-1', 'run-1', CHECKS, [FINDING_1, FINDING_2], 'checklist', 'MA design sheet audit')
    expect(rows).toHaveLength(1)
    expect(rows[0].task_type).toBe('checklist')
    // No unit suffix: there is no single unit a run-level task belongs to.
    expect(rows[0].batch_tag).toBe('prompt:run-1')
    expect(rows[0].title).toBe('MA design sheet audit')
    expect(rows[0].checklist).toEqual([
      { text: 'A person named in the notes is missing from the plan', done: false },
      { text: 'A stated concern is not answered by the plan', done: false },
    ])
    // Collapsing into items must not lose the evidence.
    expect(rows[0].description).toContain('Because the residuary never answers it.')
    expect(rows[0].description).toContain('And nobody named Ruth appears anywhere.')
  })

  /**
   * The body's order, not the findings' arrival order. A prompt's checks are
   * ordered the way their author meant, and a checklist read out of that
   * order reads as a different document.
   */
  it('orders items by the prompt body, not by the findings array or the check number', () => {
    // `CHECKS` declares check 2 before check 1 and the findings arrive 1 then
    // 2, so body order is the *only* order producing this result. A sort on
    // `checkNumber` would put check 1 first and fail.
    const rows = taskRowsFor('matter-1', 'run-1', CHECKS, [FINDING_1, FINDING_2], 'checklist', 'Audit')
    expect(rows[0].checklist.map((item) => item.text)).toEqual([
      'A person named in the notes is missing from the plan',
      'A stated concern is not answered by the plan',
    ])
  })

  it('takes the highest priority among the contributing checks', () => {
    // Check 2 alone is 'normal'; with check 1's 'high' in the set it is 'high'.
    expect(taskRowsFor('matter-1', 'run-1', CHECKS, [FINDING_2], 'checklist', 'Audit')[0].priority).toBe('normal')
    expect(taskRowsFor('matter-1', 'run-1', CHECKS, [FINDING_1, FINDING_2], 'checklist', 'Audit')[0].priority).toBe('high')
  })

  /**
   * Not an empty checklist. A task with no items says work is needed and then
   * names none, which is worse than saying nothing — and it is exactly what a
   * run whose every finding failed verification would otherwise produce.
   */
  it('produces no checklist task when nothing is actionable', () => {
    expect(taskRowsFor('matter-1', 'run-1', CHECKS, [], 'checklist', 'Audit')).toEqual([])
  })

  it('skips a finding whose check the prompt version does not contain', () => {
    const drifted = finding({ checkNumber: '99', rationale: 'Out of step.' })
    expect(taskRowsFor('matter-1', 'run-1', CHECKS, [drifted], 'checklist', 'Audit')).toEqual([])
  })
})
```


- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd apps/workbench && npx vitest run tests/field-audit-tasks.test.ts
```

Expected: FAIL — `taskRowsFor` takes four arguments, not six.

- [ ] **Step 3: Rewrite `taskRowsFor`**

In `apps/workbench/lib/fieldAudit/tasks.ts`, add to the imports at the top:

```ts
import type { FieldAuditCheck, OutputTarget } from '@aubrey-law/citations/prompt/body'
```

(replacing the existing `FieldAuditCheck` import line), then replace `taskRowsFor`
(lines 29-74) with:

```ts
const PRIORITY_ORDER: Record<string, number> = { low: 0, normal: 1, high: 2 }

/**
 * The rows one run's findings become, in the shape its prompt version asked
 * for.
 *
 * `findings` is expected to already be `actionableFindings(result)` from
 * `@aubrey-law/citations/fieldAudit/runFieldAudit` — the severity,
 * disposition and verified-reference gate — so nothing here re-checks that.
 * This is the templating step and the shaping step, nothing more.
 *
 * A finding whose check number names nothing in this prompt version is
 * skipped rather than guessed at: the prompt and the result have fallen out
 * of step with each other, and there is no template to fill in.
 */
export function taskRowsFor(
  matterId: string,
  runId: string,
  checks: FieldAuditCheck[],
  findings: FieldAuditFinding[],
  target: OutputTarget,
  promptTitle: string,
): TaskRow[] {
  // Nothing at all, not an empty row. See `emitTasks`, which returns before
  // it reads anything for this target.
  if (target === 'chat') return []

  const checkByNumber = new Map(checks.map((check) => [check.number, check]))
  const bodyOrder = new Map(checks.map((check, index) => [check.number, index]))

  // The body's order, not the findings' arrival order: a playbook's order is
  // the order its author meant.
  const matched = findings
    .flatMap((f) => {
      const check = checkByNumber.get(f.checkNumber)
      return check ? [{ finding: f, check }] : []
    })
    .sort((a, b) => (bodyOrder.get(a.finding.checkNumber) ?? 0) - (bodyOrder.get(b.finding.checkNumber) ?? 0))

  if (target === 'task_set') {
    return matched.map(({ finding, check }) => ({
      matter_id: matterId,
      source: PROMPT_TASK_SOURCE,
      task_type: 'single',
      auto: true,
      // Names both the run and the unit, so a retry can replace one unit's
      // task without touching the rest. `planEmit` compares whole tags and
      // does not parse this, but a person reading the row can.
      batch_tag: `prompt:${runId}#${finding.checkNumber}`,
      title: check.taskTemplate.title,
      // The template says what kind of problem this is; the rationale says
      // what the sheet actually shows.
      description: `${check.taskTemplate.description}\n\n${finding.rationale}`,
      priority: check.taskTemplate.priority,
      checklist: [],
    }))
  }

  // `checklist`: one task for the whole run.
  //
  // No items means no task. An empty checklist says work is needed and then
  // names none, which is worse than saying nothing — and it is what a run
  // whose every finding failed verification would otherwise produce.
  if (matched.length === 0) return []

  const items: ChecklistItem[] = matched.map(({ check }) => ({ text: check.taskTemplate.title, done: false }))

  // The rationales go in the description rather than into the item text: an
  // item is a line someone ticks, and six paragraphs of reasoning is not
  // that. Nothing is lost — the evidence is right underneath.
  const description = [
    // No "on the design sheet": this templates every prompt in the library,
    // and 39 of the coming 40 are not that prompt. The title says what ran.
    `${promptTitle} found ${items.length === 1 ? '1 item' : `${items.length} items`} to confirm.`,
    '',
    ...matched.map(({ finding, check }, index) => `${index + 1}. ${check.taskTemplate.title}\n${finding.rationale}`),
  ].join('\n')

  const priority = matched.reduce(
    (highest, { check }) =>
      (PRIORITY_ORDER[check.taskTemplate.priority] ?? 0) > (PRIORITY_ORDER[highest] ?? 0)
        ? check.taskTemplate.priority
        : highest,
    'low' as string,
  )

  return [
    {
      matter_id: matterId,
      source: PROMPT_TASK_SOURCE,
      task_type: 'checklist',
      auto: true,
      // No unit suffix: there is no single unit a run-level task belongs to.
      batch_tag: `prompt:${runId}`,
      title: promptTitle,
      description,
      priority,
      checklist: items,
    },
  ]
}
```

- [ ] **Step 4: Rewrite `emitTasks`**

Replace `EmitTasksInput`, `EmitTasksResult` and `emitTasks`
(from line 175 to the end of the file) with:

```ts
export interface EmitTasksInput {
  matterId: string
  runId: string
  checks: FieldAuditCheck[]
  findings: FieldAuditFinding[]
  /** From the run's pinned prompt version body — never the published one. */
  outputTarget: OutputTarget
  /** Titles a `checklist` task. Unused by `task_set`. */
  promptTitle: string
}

export interface EmitTasksResult {
  created: number
  /** Already said exactly this, so left alone — id and `created_at` intact. */
  kept: number
  superseded: number
}

/**
 * Makes this matter's open prompt tasks say what this run says.
 *
 * Reads the existing tasks *before* inserting anything, which is what lets
 * `planEmit` compare against a snapshot that cannot contain rows this call
 * just wrote. The withdrawal happens only after the insert succeeds: if the
 * insert throws, nothing that was open a moment ago has been closed out for a
 * run that never produced its replacements.
 *
 * Safe to call twice. `planEmit` is idempotent over an unchanged run, so a
 * retried run's second pass through the tick creates nothing and withdraws
 * nothing — which is exactly what it did not do before `planEmit` existed.
 */
export async function emitTasks(
  client: SupabaseClient<WorkbenchDatabase>,
  input: EmitTasksInput,
): Promise<EmitTasksResult> {
  // `chat` produces no objects, so it reads nothing and writes nothing. This
  // returns before the query rather than after it on purpose: an empty
  // `desired` would make `planEmit` withdraw every open prompt task on the
  // matter, which is not "produces nothing", it is "destroys someone else's
  // something".
  if (input.outputTarget === 'chat') return { created: 0, kept: 0, superseded: 0 }

  const sb = client

  const { data: existingRows, error: existingError } = await sb
    .from('tasks')
    .select('id, source, batch_tag, status, assignee_id, title, description, priority, task_type, checklist')
    .eq('matter_id', input.matterId)
    .eq('source', PROMPT_TASK_SOURCE)
  if (existingError) {
    throw new Error(`Could not load this matter's earlier prompt tasks: ${existingError.message}`)
  }

  const existing: ExistingPromptTask[] = (existingRows ?? []).map((row) => ({
    id: String(row.id),
    source: String(row.source),
    batchTag: (row.batch_tag as string | null) ?? null,
    status: String(row.status),
    assigneeId: (row.assignee_id as string | null) ?? null,
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    priority: String(row.priority ?? ''),
    taskType: String(row.task_type ?? ''),
    checklist: Array.isArray(row.checklist) ? (row.checklist as ChecklistItem[]) : [],
  }))

  const desired = taskRowsFor(
    input.matterId,
    input.runId,
    input.checks,
    input.findings,
    input.outputTarget,
    input.promptTitle,
  )

  const plan = planEmit(existing, desired)

  if (plan.insert.length > 0) {
    const { error: insertError } = await sb.from('tasks').insert(plan.insert)
    if (insertError) throw new Error(`Could not create tasks for this run: ${insertError.message}`)
  }

  if (plan.supersede.length > 0) {
    const { error: updateError } = await sb
      .from('tasks')
      .update({
        // Not a distinct 'skipped' status — see the header comment in
        // 20261029000000_prompt_task_source.sql for why this reuses the
        // archived + skipped_at pair `lib/tasks/types.ts`'s `isTaskSkipped`
        // already defines as "skipped" everywhere else in this codebase.
        status: 'archived',
        skipped_at: new Date().toISOString(),
        closeout_reason: 'prompt_superseded',
      })
      .in('id', plan.supersede)
    if (updateError) throw new Error(`Could not withdraw superseded tasks: ${updateError.message}`)
  }

  return { created: plan.insert.length, kept: plan.keep.length, superseded: plan.supersede.length }
}
```

- [ ] **Step 5: Give `emitTasks` its first tests**

`emitTasks` has never had any — the file ends at `tasksToSupersedeForUnits`, and the two
functions it used to delegate to were the only things under test. So this adds a suite
rather than fixing one, and the `chat` case is the one that matters most: it is the target
whose entire content is an absence, and an absence is what nobody notices is broken.

Append to `apps/workbench/tests/field-audit-tasks.test.ts`:

```ts
import { emitTasks } from '@/lib/fieldAudit/tasks'

/**
 * Enough of a PostgREST client for `emitTasks`: a `select` chain that resolves
 * to `rows`, plus recorders for what was inserted and updated.
 */
function fakeClient(rows: unknown[]) {
  const inserted: unknown[][] = []
  const updatedIds: string[][] = []
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return { eq: async () => ({ data: rows, error: null }) }
            },
          }
        },
        async insert(values: unknown[]) {
          inserted.push(values)
          return { error: null }
        },
        update() {
          return {
            async in(_column: string, ids: string[]) {
              updatedIds.push(ids)
              return { error: null }
            },
          }
        },
      }
    },
  }
  return { client: client as never, inserted, updatedIds }
}

describe('emitTasks', () => {
  /**
   * Not "produces no rows" — touches the database not at all. An empty
   * `desired` set reaching `planEmit` would withdraw every open prompt task on
   * the matter, so a `chat` prompt would silently destroy another prompt's
   * output. The short-circuit has to be before the query, and this is what
   * proves it is.
   */
  it('reads nothing and writes nothing for chat', async () => {
    let touched = false
    const client = {
      from() {
        touched = true
        throw new Error('emitTasks must not touch the database for a chat prompt')
      },
    } as never

    await expect(
      emitTasks(client, {
        matterId: 'matter-1',
        runId: 'run-1',
        checks: CHECKS,
        findings: [FINDING_1],
        outputTarget: 'chat',
        promptTitle: 'Audit',
      }),
    ).resolves.toEqual({ created: 0, kept: 0, superseded: 0 })
    expect(touched).toBe(false)
  })

  it('inserts one checklist row and withdraws the previous run’s tasks', async () => {
    const { client, inserted, updatedIds } = fakeClient([
      {
        id: 'old-1',
        source: PROMPT_TASK_SOURCE,
        batch_tag: 'prompt:run-old#1',
        status: 'open',
        assignee_id: null,
        title: 'A stated concern is not answered by the plan',
        description: 'Older wording.',
        priority: 'high',
        task_type: 'single',
        checklist: [],
      },
    ])

    const result = await emitTasks(client, {
      matterId: 'matter-1',
      runId: 'run-1',
      checks: CHECKS,
      findings: [FINDING_1, FINDING_2],
      outputTarget: 'checklist',
      promptTitle: 'MA design sheet audit',
    })

    expect(result).toEqual({ created: 1, kept: 0, superseded: 1 })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toHaveLength(1)
    expect(updatedIds).toEqual([['old-1']])
  })

  /** The regression, end to end through `emitTasks` rather than `planEmit`. */
  it('is idempotent: a second pass over the same run writes nothing', async () => {
    const first = fakeClient([])
    await emitTasks(first.client, {
      matterId: 'matter-1',
      runId: 'run-1',
      checks: CHECKS,
      findings: [FINDING_1, FINDING_2],
      outputTarget: 'checklist',
      promptTitle: 'MA design sheet audit',
    })
    const row = (first.inserted[0] as Array<Record<string, unknown>>)[0]

    // The same row read back the way PostgREST would return it.
    const second = fakeClient([
      {
        id: 'list-1',
        source: row.source,
        batch_tag: row.batch_tag,
        status: 'open',
        assignee_id: null,
        title: row.title,
        description: row.description,
        priority: row.priority,
        task_type: row.task_type,
        checklist: row.checklist,
      },
    ])

    const result = await emitTasks(second.client, {
      matterId: 'matter-1',
      runId: 'run-1',
      checks: CHECKS,
      findings: [FINDING_1, FINDING_2],
      outputTarget: 'checklist',
      promptTitle: 'MA design sheet audit',
    })

    expect(result).toEqual({ created: 0, kept: 1, superseded: 0 })
    expect(second.inserted).toEqual([])
    expect(second.updatedIds).toEqual([])
  })
})
```

Merge the `emitTasks` import into the existing import block at the top of the file rather
than adding a second one.


- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
cd apps/workbench && npx vitest run tests/field-audit-tasks.test.ts
```

Expected: PASS, every suite.

- [ ] **Step 7: Commit**

```bash
git add apps/workbench/lib/fieldAudit/tasks.ts apps/workbench/tests/field-audit-tasks.test.ts
git commit -m "chat produces nothing, checklist produces one task with items

Three shapes from one templating function. task_set is what the audit already
did. checklist is one task per run carrying one item per actionable finding,
which is what turns the accepted overlap between checks 1 and 2 from two
blocker tasks into two lines on one -- the duplication stays, its cost does
not.

Items are the check titles and the rationales go in the description: an item
is a line someone ticks, and six paragraphs of reasoning is not that. Ordered
by the prompt body rather than by the findings array, because a playbook's
order is the order its author meant. Priority is the highest among the
contributing checks.

No actionable findings means no task, not an empty checklist. A task with no
items says work is needed and then names none.

chat returns before the query rather than producing no rows. An empty desired
set reaching planEmit would withdraw every open prompt task on the matter,
which is not 'produces no objects' -- it is 'destroys someone else's objects'.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The tick passes the run's own target

**Files:**
- Modify: `apps/workbench/app/api/cron/tick/route.ts:125-139`

- [ ] **Step 1: Pass the target and the title**

Replace the `if (context.kind === 'field_audit')` block:

```ts
    // Tasks belong to the caller once a run is actually done, never to
    // `workRun` itself — see its own header comment. Only a field audit
    // emits them, and only from findings that survived reference
    // verification. This is the only place `emitTasks` is ever called — a
    // first run and a retried run both reach it only here, once their run has
    // no `pending` steps left.
    if (context.kind === 'field_audit') {
      const body = context.prompt.body as FieldAuditBody
      const stored = await loadFieldAuditFindings(admin, runId)
      const actionable = actionableFindings({
        promptSlug: context.prompt.slug,
        promptVersion: context.prompt.versionNumber,
        findings: stored,
        failures: [],
      })
      await emitTasks(admin, {
        matterId: String(context.run.matter_id),
        runId,
        checks: body.checks,
        findings: actionable,
        // The target from the version this run pinned, never the published
        // one: a prompt republished as `chat` since must not retroactively
        // decide that a `task_set` run mid-flight produces nothing.
        // `loadRunContext` reads `prompt_version_id` for exactly this reason.
        outputTarget: body.outputTarget,
        promptTitle: context.prompt.title,
      })
    }
```

- [ ] **Step 2: Typecheck**

Run:

```bash
cd apps/workbench && npm run typecheck
```

Expected: no errors. If `body.outputTarget` is reported as possibly undefined, Task 1's
`.default()` is missing — a zod `.default()` makes the *output* type required.

- [ ] **Step 3: Run the workbench suite**

Run:

```bash
cd apps/workbench && npx vitest run
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/workbench/app/api/cron/tick/route.ts
git commit -m "The tick honours the target the run pinned

Read off the run's own prompt version rather than the published one, the same
way loadRunContext reads everything else: a prompt republished as chat since
must not retroactively decide that a task_set run mid-flight produces nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The root app labels a prompt-sourced task

This is the **root app**, not the workbench. `'prompt'` was added to the database's
`tasks_source_check` in #410 and never to `TASK_SOURCES`, so
`TASK_SOURCE_LABEL['prompt']` and `TASK_SOURCE_PILL['prompt']` are both `undefined` and
`TaskSourcePill` renders an empty, unstyled chip. The workbench never reads `tasks` — it
only writes them — so the root app is the only place these tasks are seen, and every one
this feature has ever created has appeared there unlabelled.

`bg-amber-bg text-amber` measures **6.84:1** light and **8.48:1** dark against the theme
tokens, and no other source pill uses amber. Those numbers were measured with
`lib/theme/contrast.ts`, not chosen by eye.

Adding to `TASK_SOURCES` is safe: it is consumed only by the two filter dropdowns
(`app/admin/tasks/TasksClient.tsx:517`, `components/tasks/RecordTasksTab.tsx:251`) and
`tests/task-pill-contrast.test.ts`. Task *creation* at
`app/api/admin/tasks/route.ts:214` hard-codes `'template' | 'cadence' | 'manual'`, so this
cannot let anyone hand-create a prompt task.

**Files:**
- Modify: `lib/tasks/types.ts:6`, `lib/tasks/types.ts:290-296`, `lib/tasks/types.ts:306-312`
- Test: `tests/task-pill-contrast.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('every task source pill is readable', ...)` block in
`tests/task-pill-contrast.test.ts`, before its closing brace:

```ts
  /**
   * The gap that let a whole feature ship unlabelled: `'prompt'` was added to
   * the database's `tasks_source_check` and never to `TASK_SOURCES`, so both
   * maps returned `undefined` for it and `TaskSourcePill` rendered an empty
   * chip. The contrast cases above iterate `TASK_SOURCES` and so could not
   * see a source the union did not know about. This checks the maps are total
   * against the union, which is the assertion that would have caught it.
   */
  it('has a label and a pill for every source, with no blanks', () => {
    for (const source of TASK_SOURCES) {
      expect(TASK_SOURCE_LABEL[source], `${source} label`).toBeTruthy()
      expect(TASK_SOURCE_PILL[source], `${source} pill`).toBeTruthy()
    }
  })

  it('knows about tasks a prompt run created', () => {
    expect(TASK_SOURCES).toContain('prompt')
  })
```

Add `TASK_SOURCE_LABEL` to the import on line 2:

```ts
import { TASK_SOURCES, TASK_SOURCE_LABEL, TASK_SOURCE_PILL, type TaskSource } from '@/lib/tasks/types'
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/task-pill-contrast.test.ts
```

Expected: `knows about tasks a prompt run created` FAILS — `TASK_SOURCES` does not contain
`'prompt'`. The totality test passes for now, because the union has no gap in it yet; it is
there to hold once `'prompt'` is added.

- [ ] **Step 3: Add the source**

In `lib/tasks/types.ts`, replace line 6:

```ts
/**
 * `'prompt'` is a task a prompt run created — the database has allowed it
 * since 20261029000000_prompt_task_source.sql, and this union did not, so
 * every such task rendered with an empty source pill and could not be
 * filtered for. The workbench writes these rows and never reads them; this app
 * is the only place they are seen.
 */
export const TASK_SOURCES = ['manual', 'stage', 'template', 'cadence', 'sla', 'prompt'] as const
```

In `TASK_SOURCE_LABEL` (line 290), add the entry:

```ts
export const TASK_SOURCE_LABEL: Record<TaskSource, string> = {
  stage: 'Stage',
  manual: 'Manual',
  template: 'Template',
  cadence: 'Cadence',
  sla: 'Plan',
  prompt: 'Prompt',
}
```

In `TASK_SOURCE_PILL` (line 306), add the entry:

```ts
export const TASK_SOURCE_PILL: Record<TaskSource, string> = {
  stage: 'bg-stage-work-bg text-stage-work-text',
  manual: 'bg-muted text-foreground',
  template: 'bg-blue-bg text-blue',
  cadence: 'bg-stage-active-bg text-stage-active-text',
  sla: 'bg-green-bg text-green',
  // 6.84:1 light, 8.48:1 dark, measured with lib/theme/contrast.ts against
  // the theme tokens rather than picked by eye. Amber is unused by the other
  // source pills, so the chip carries information at a glance, and it reads
  // as "a machine suggested this, someone still has to agree".
  prompt: 'bg-amber-bg text-amber',
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/task-pill-contrast.test.ts
```

Expected: PASS. The parameterised contrast cases now include `light: prompt` and
`dark: prompt`, and both clear the 4.5 AA threshold.

- [ ] **Step 5: Confirm the root app still typechecks and its suite passes**

Run:

```bash
npm run typecheck && npx vitest run
```

Expected: PASS. `TaskSource` gaining a member can surface exhaustive `switch` statements or
`Record<TaskSource, …>` maps elsewhere that are now missing a key — the compiler names each
one. Fill each in rather than widening its type.

- [ ] **Step 6: Commit**

```bash
git add lib/tasks/types.ts tests/task-pill-contrast.test.ts
git commit -m "A task a prompt run created says so

'prompt' has been a legal tasks.source since #410 and was never added to
TASK_SOURCES, so TASK_SOURCE_LABEL['prompt'] and TASK_SOURCE_PILL['prompt']
were both undefined: TaskSourcePill rendered an empty, unstyled chip and the
source filter had no Prompt option. The workbench writes these rows and never
reads them, so this app is the only place they are seen -- every task the
field audit has ever created has appeared here unlabelled.

The contrast cases iterate TASK_SOURCES, which is why they could not see a
source the union did not know about. The new totality assertion is the one
that would have caught it, and it now holds both maps against the union.

bg-amber-bg text-amber measures 6.84:1 light and 8.48:1 dark, measured with
lib/theme/contrast.ts rather than picked by eye, and no other source pill uses
amber.

Adding to the union cannot let anyone hand-create a prompt task: task creation
in app/api/admin/tasks/route.ts hard-codes template, cadence and manual.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Version 4 of the design-sheet audit — `outputTarget: 'checklist'`

Version 4 is version 3's body with one field added. **`prompt_versions` is immutable** —
version 3 is not edited, and the runs it produced stay interpretable against the wording
that produced them.

`content_hash` is the **sha256 of the JSON with SQL's doubled single quotes collapsed back
to single ones** — verified against version 3, whose stated hash matches
`sha256(body.replace("''", "'"))` and not `sha256(body)`. Getting this backwards produces a
hash that looks plausible and is wrong.

**Files:**
- Create: `supabase/migrations/20261104000000_design_sheet_audit_v4.sql`
- Test: `apps/workbench/tests/design-sheet-audit-content.test.ts` (append a v4 block — the file already has one per seeded version)

- [ ] **Step 1: Generate the migration**

Run this script, which lifts version 3's body verbatim, inserts `"outputTarget":"checklist"`
after `"kind":"field_audit"`, computes the hash correctly, and writes the file:

```bash
python3 - <<'PY'
import hashlib, re, pathlib

src = pathlib.Path('supabase/migrations/20261102000000_design_sheet_audit_v3.sql').read_text()
sql_literal = re.search(r"'(\{\"kind\":\"field_audit\".*?\})'::jsonb", src, re.S).group(1)

# One field added; everything else is version 3 byte for byte.
assert sql_literal.startswith('{"kind":"field_audit",')
new_literal = sql_literal.replace('{"kind":"field_audit",', '{"kind":"field_audit","outputTarget":"checklist",', 1)

# The hash is over the real JSON, so SQL's doubled quotes collapse first.
# Verified against version 3: its stated hash matches this and not the raw form.
digest = hashlib.sha256(new_literal.replace("''", "'").encode()).hexdigest()

header = '''-- The design-sheet audit produces one checklist instead of six tasks.
--
-- outputTarget lives in the body rather than on `prompts` because a run
-- records only its prompt_version_id: as a mutable column, a run from last
-- week would be indistinguishable from one that produced something else
-- entirely. The rule that falls out is that content changes make a version and
-- configuration does not -- fires_on_stage_entry decides *when* a prompt runs
-- and is a column, outputTarget decides *what a run produces* and is content.
-- So this is version 4, and versions 1 to 3 stay interpretable against exactly
-- what they produced.
--
-- Checks 1 and 2 both flag one guardian gap from different angles, and
-- version 3 accepted that overlap deliberately rather than build a
-- finding-suppresses-finding pass for a six-check prompt. As a checklist those
-- two become two items on one task. The duplication is still there; what is
-- gone is its cost in an attorney's task list.
--
-- The body is version 3's byte for byte, with one field added. Generated
-- rather than retyped, and the content_hash is sha256 of the JSON with SQL's
-- doubled single quotes collapsed back -- checked against version 3, whose
-- stated hash matches that form and not the raw literal.
--
-- The prompt is found by slug rather than by a hard-coded id: an earlier
-- migration in this series pasted an id lifted by pattern and got the
-- version's id instead of the prompt's.

insert into public.prompt_versions (
  prompt_id, kind, version_number, body, content_hash, change_summary, validation_status
)
select
  p.id,
  'field_audit',
  4,
'''

body_sql = f"  '{new_literal}'::jsonb,\n"

footer = f'''  '{digest}',
  'The audit produces one checklist task with an item per finding, instead of one task per finding.',
  'valid'
from public.prompts p
where p.slug = 'ma-design-sheet-audit'
on conflict (prompt_id, version_number) do nothing;

-- `do update`, not `do nothing`: a publication row already exists from the
-- earlier versions, and leaving it pinned there would publish nothing at all.
insert into public.prompt_publications (prompt_id, version_id)
select v.prompt_id, v.id
from public.prompt_versions v
join public.prompts p on p.id = v.prompt_id
where p.slug = 'ma-design-sheet-audit' and v.version_number = 4
on conflict (prompt_id) do update
  set version_id = excluded.version_id,
      published_at = now();

notify pgrst, 'reload schema';
'''

out = pathlib.Path('supabase/migrations/20261104000000_design_sheet_audit_v4.sql')
out.write_text(header + body_sql + footer)
print('wrote', out)
print('content_hash', digest)
print('outputTarget present:', '"outputTarget":"checklist"' in new_literal)
print('checks unchanged:', new_literal.count('"number":"') == 6)
PY
```

Expected output: the path, a 64-character hash, `outputTarget present: True`,
`checks unchanged: True`.

- [ ] **Step 2: Add the version-4 block to the seed-content test**

`apps/workbench/tests/design-sheet-audit-content.test.ts` already has a `describe` block per
seeded version — v2 and v3 — each asserting that the body parses, that every declared source
is one `resolveInputs` can resolve, and that the stated `content_hash` is the real sha256
rather than a value typed in and never rechecked. Follow that convention; a permanent test
is the point, not a throwaway check before applying.

A successful `promptBodySchema.safeParse` is itself the proof that every check's `reads`
names a declared input, because `superRefine` refuses a body where that is not true. That
is why these blocks assert the parse and not the relationship.

Append to that file:

```ts
/**
 * Version 4 changes what a run *produces*, not what it checks.
 *
 * `outputTarget` lives in the body rather than on `prompts` because a run
 * records only its `prompt_version_id`: as a mutable column, an old run would
 * be indistinguishable from one that produced something else. So a change of
 * target is a new version, and the checks themselves are untouched — which is
 * the strongest thing this block can assert, and it does.
 */
describe('the version-4 seed migration for the design-sheet audit', () => {
  const V4 = fs.readFileSync(
    path.resolve(__dirname, '../../../supabase/migrations/20261104000000_design_sheet_audit_v4.sql'),
    'utf8',
  )
  const bodyText = () => V4.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'")

  it('publishes version 4, and repoints rather than doing nothing', () => {
    // A `do nothing` here would leave the publication on version 3 — the
    // exact failure the v2 migration already had to correct.
    expect(V4).toMatch(/version_number\s*\)?\s*\n?.*4,|,\s*\n\s*4,/)
    expect(V4).toMatch(/on conflict \(prompt_id\) do update/)
  })

  it('makes the new version insert idempotent', () => {
    expect(V4).toMatch(/on conflict \(prompt_id, version_number\) do nothing/)
  })

  it('adds a version of the same prompt, found by slug rather than a pasted id', () => {
    // An earlier migration in this series pasted an id lifted by pattern and
    // got the *version's* id instead of the prompt's. Selecting by the thing
    // that is stable removes the question.
    expect(V4).toMatch(/where p\.slug = 'ma-design-sheet-audit'/)
    expect(V4).not.toMatch(/insert into public\.prompts\s*\(/)
  })

  it('says checklist', () => {
    const parsed = promptBodySchema.parse(JSON.parse(bodyText()))
    if (parsed.kind !== 'field_audit') throw new Error('expected a field_audit body')
    expect(parsed.outputTarget).toBe('checklist')
  })

  /**
   * The whole claim of this version: it changes the target and nothing else.
   * Comparing the parsed checks against version 3's proves the body was
   * derived rather than retyped — a hand-edited copy would drift a statement
   * or a `reads` entry and nobody would notice until a run behaved
   * differently for a reason nobody chose.
   */
  it('leaves every check exactly as version 3 had it', () => {
    const v3 = fs.readFileSync(
      path.resolve(__dirname, '../../../supabase/migrations/20261102000000_design_sheet_audit_v3.sql'),
      'utf8',
    )
    const checksOf = (sql: string) =>
      JSON.parse(sql.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'")).checks
    expect(checksOf(V4)).toEqual(checksOf(v3))
  })

  it('leaves version 3’s own inputs alone too', () => {
    const v3 = fs.readFileSync(
      path.resolve(__dirname, '../../../supabase/migrations/20261102000000_design_sheet_audit_v3.sql'),
      'utf8',
    )
    const inputsOf = (sql: string) =>
      JSON.parse(sql.match(/'((?:[^']|'')*)'::jsonb/)![1].replace(/''/g, "'")).inputs
    expect(inputsOf(V4)).toEqual(inputsOf(v3))
  })

  it('declares no source outside the allow-list', () => {
    const parsed = promptBodySchema.parse(JSON.parse(bodyText()))
    if (parsed.kind !== 'field_audit') throw new Error('expected a field_audit body')
    expect(unknownSources(parsed.inputs)).toEqual([])
  })

  it('states the real sha256 of the body it seeds', () => {
    const stated = V4.match(/::jsonb,\s*\n\s*'([0-9a-f]{64})'/)![1]
    expect(crypto.createHash('sha256').update(bodyText()).digest('hex')).toBe(stated)
  })

  it('still parses, which is what proves every read is a declared input', () => {
    expect(promptBodySchema.safeParse(JSON.parse(bodyText())).success).toBe(true)
  })
})
```

Run it — and note this must pass **before** the migration is applied, since it reads the
`.sql` file rather than the database:

```bash
cd apps/workbench && npx vitest run tests/design-sheet-audit-content.test.ts
```

Expected: PASS, including the pre-existing v2 and v3 blocks. If `states the real sha256`
fails, the generator in Step 1 hashed the wrong form — it must hash the JSON with SQL's
doubled quotes collapsed, which is what `bodyText()` does here. Fix the migration; do not
adjust the test to match a wrong hash.


- [ ] **Step 3: Apply the migration**

The worktree is not `supabase link`ed and the direct host is IPv6-only; the session-mode
pooler is the only route. Copy the user's env in only for the operation, never print the
password, and delete the copy immediately:

```bash
cp /Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.env.local .env.local.tmp
PW=$(grep -m1 '^SUPABASE_DB_PASSWORD=' .env.local.tmp | cut -d= -f2- | tr -d '"'"'"'')
ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$PW")
DBURL="postgresql://postgres.qifunlovuwaryzsyfbnh:${ENC}@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
psql "$DBURL" -f supabase/migrations/20261104000000_design_sheet_audit_v4.sql
rm -f .env.local.tmp
```

Expected: two `INSERT 0 1` lines and a `NOTIFY`.

- [ ] **Step 4: Verify what is actually published**

Do not trust the migration history — verify the object. Rebuild `DBURL` as in Step 3, then:

```bash
psql "$DBURL" -At -F ' | ' -c "
select v.version_number, v.body->>'outputTarget', jsonb_array_length(v.body->'checks')
from public.prompt_publications pub
join public.prompt_versions v on v.id = pub.version_id
join public.prompts p on p.id = pub.prompt_id
where p.slug = 'ma-design-sheet-audit';"
rm -f .env.local.tmp
```

Expected: `4 | checklist | 6`. If it reports version 3, the publication `on conflict do
update` did not run.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104000000_design_sheet_audit_v4.sql
git commit -m "The design-sheet audit produces one checklist

Version 4, not an edit to version 3: prompt_versions is immutable and the runs
version 3 produced stay interpretable against the wording that produced them.
outputTarget is body content rather than a column on prompts because a run
records only its prompt_version_id -- as a mutable column, an old run would be
indistinguishable from one that produced something else.

Checks 1 and 2 both flag one guardian gap from different angles, which version
3 accepted deliberately rather than build a finding-suppresses-finding pass
for a six-check prompt. As a checklist those two become two items on one task.
The duplication remains; its cost in a task list does not.

The body is version 3's byte for byte with one field added, generated rather
than retyped. content_hash is sha256 of the JSON with SQL's doubled quotes
collapsed back, checked against version 3's own stated hash rather than
assumed -- the raw literal hashes to something else entirely.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Full check before the real run

- [ ] **Step 1: Everything, in both projects**

The root and the workbench are **separate vitest projects and separate typecheck
projects**: the root `tsconfig.typecheck.json` excludes `apps/`, and the root vitest
`include` is root-relative. Neither covers the other, so `npm run typecheck && npx vitest
run` at the root proves nothing about the app this branch mostly changes. Run all four.

```bash
npm run typecheck && npx vitest run
```

```bash
cd apps/workbench && npm run typecheck && npx vitest run
```

Expected: both PASS. For reference, the counts on this branch before Task 2 were
459 files / 4866 passed / 1 skipped at the root, and 83 files / 1007 passed in the
workbench — so a suite that has silently stopped collecting files shows up as a number
that dropped rather than as a green tick.

- [ ] **Step 2: The queried columns exist in the live database**

`emitTasks` now selects `title, description, priority, task_type, checklist` and inserts
`checklist`. The offline check reads the generated types; the live one reads PostgREST:

The offline check, from the workbench:

```bash
cd apps/workbench && npx vitest run tests/query-columns.test.ts
```

Then the live check, from the worktree root:

```bash
cp /Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.env.local .env.local.tmp
set -a && . ./.env.local.tmp && set +a
node scripts/checkDbColumns.mjs
rm -f .env.local.tmp
```

Expected: both PASS. If `checkDbColumns.mjs` reports a column absent that
`information_schema` shows exists, PostgREST's schema cache is stale — `notify pgrst,
'reload schema'` and wait a few seconds rather than chasing a migration that worked.

- [ ] **Step 3: Commit any fixes, then open the PR**

```bash
git push -u origin claude/output-targets
gh pr create --title "A prompt version says what its run produces" --body "$(cat <<'BODY'
`outputTarget` on the field-audit body: `chat` produces nothing, `task_set` is
today's one-task-per-finding, `checklist` is one task carrying one item per
finding. The design-sheet audit becomes version 4 and switches to `checklist`.

It lives in the version body rather than on `prompts` because a run records
only its `prompt_version_id`: as a mutable column, an old run would be
indistinguishable from one that produced something else. Content changes make
a version; configuration does not.

`draft_doc` and `email_draft` are out, and not only for effort — the
workbench's R2 client is read-only and writes nothing to `matter_documents`,
and the safety model does not transfer. Everything trustworthy here rests on a
claim being verified against its source, and generated prose has no source.

## Two things found on the way, both fixed here

**A retried run created duplicate tasks.** `emitTasks` took a `unitIds` hint
that chose between `tasksToSupersede` and `tasksToSupersedeForUnits`; nothing
passed it. `git log -S` shows it in `retry.ts` until #412 moved `emitTasks`
into the tick and never reinstated it — so `tasksToSupersedeForUnits` was dead
code and a retried run's second done-pass re-created a task for every unit,
including the ones that never failed. `tasks` has no unique index on
`batch_tag`. `checklist` inherits this exactly, so it was a prerequisite, not
an aside. Both functions collapse into one `planEmit` that asks about content
instead of units — idempotent, no `unitIds`, both tag shapes with no special
case, and it self-heals a duplicate pair.

**Every prompt task rendered as a blank pill.** `'prompt'` has been a legal
`tasks.source` since #410 and was never added to the root app's
`TASK_SOURCES`, so both the label and pill maps returned `undefined` and
`TaskSourcePill` drew an empty chip. The workbench writes these rows and never
reads them, so that app is the only place they are seen.

## Verified

- A real run of version 4 against a real matter, with the resulting checklist reported.
- `planEmit` proven idempotent, and proven to replace a changed unit while keeping an untouched one's id.
- `chat` proven to touch the database not at all — not merely to produce no rows.
- The new pill measured at 6.84:1 light and 8.48:1 dark.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

### Task 8: Run it against a real matter and report

Nothing on this branch is done until version 4 has actually run. Every bug in this project
worth finding was found this way and not by reasoning: `matters.title`, the `"null"`
document id, the unchecked `ensure_user_profile`, the dead `revalidate`, the requeued
complete run, the guardian false positives, the six-row advisory, the advisory that could
never be cleared.

- [ ] **Step 1: Wait for CI and the deployment**

The workbench only builds on `main` (`scripts/vercel-should-build.sh`), so a PR build shows
"Canceled by Ignored Build Step" — that is correct, not a failure. Merge once CI is green,
then wait for the `cornerstone-drafting-2.0` deployment.

- [ ] **Step 2: Fire the audit on a real matter**

Version 4 fires on entry to `design` and `drafting`
(`20261103010000_fire_design_sheet_audit.sql`), so re-entering a stage is enough to trigger
it. **Record `stage` *and* `stage_entered_at` before touching either**: `stage_entered_at`
drives aging and SLA due dates, `trg_matters_stage_entered_at` is a BEFORE trigger that
overwrites it whenever stage changes, and restoring both needs two separate UPDATEs — set
the stage back first, then the timestamp. Getting this wrong loses a column that has to be
recovered from `matter_activity`.

- [ ] **Step 3: Report what it produced**

State plainly, with counts rather than client content:

- the run id, its step count, and how many ticks it spanned
- **one** task, `task_type = 'checklist'`, tagged `prompt:<runId>` with no unit suffix
- how many items it carries, and which check numbers they came from
- the previous run's tasks archived with `closeout_reason = 'prompt_superseded'`
- the pill rendering as **Prompt** in the root app's task list, in both themes

Then trigger a **second** run and report that the first run's checklist was withdrawn and
one new one created — never two standing at once. That is the regression this branch fixed,
proven in production rather than in a fixture.

- [ ] **Step 4: Clean up**

Ask the owner before deleting anything. The audit tasks on a real matter are the deliverable,
not test residue — they may want to keep them.

---

## Out of scope, named

**`draft_doc` and `email_draft`**, and the questions they carry: R2 write access for the
workbench, a document-creation path outside the root app's drafting engine, an email
surface, and above all what verifies generated prose when there is no source to check it
against. That last one is why they are not here, and it should be answered before either is
built rather than during.

**Superseding is scoped to the matter, not to the prompt.** Two task-emitting prompts on one
matter would each withdraw the other's on every run. True before this branch and true after
— invisible only because one prompt emits tasks and the review prompt does not. The
40-prompt library makes it certain. The fix means putting the prompt into the `batch_tag`, a
third change to its shape, which deserves its own decision.

**No unique index on `tasks.batch_tag`.** `planEmit` makes duplicates unreachable through
this path, but nothing in the database prevents them. Worth considering alongside the
scoping fix above, since both are about what a tag is allowed to identify.
