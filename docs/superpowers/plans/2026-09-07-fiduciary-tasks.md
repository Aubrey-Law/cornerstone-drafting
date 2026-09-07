# Fiduciary Gaps Become Tasks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The fiduciary gaps `matrixIssues` already finds become tasks in the attorney's queue, instead of only rendering on a page nobody has to visit.

**Architecture:** `MatrixIssue` gains a stable identity (`role`, `forParty`), a new `tasks.source` of `'fiduciary'` is added to the database *and* the root app's union, a small pure emitter mirrors `planEmit`'s discipline without sharing its code, and the cron tick sweeps every matter with appointments each tick. See `docs/superpowers/specs/2026-09-07-fiduciary-tasks-design.md`.

**Tech Stack:** TypeScript, vitest, Supabase Postgres, Next.js 16 App Router.

---

## Read this first

**Worktree.** Every command runs from
`/Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.claude/worktrees/workbench-app-improvements-e03851`.
Never `cd` to the repository root — a different checkout. Never `git stash` — the stash
stack is shared; use a temporary commit. Branch is `claude/fiduciary-tasks`.

**Running tests.** Root and workbench are separate vitest *and* typecheck projects:

| What | Command |
| --- | --- |
| One workbench file | `cd apps/workbench && npx vitest run tests/<name>.test.ts` |
| Whole workbench suite | `cd apps/workbench && npx vitest run` |
| Workbench typecheck | `cd apps/workbench && npm run typecheck` |
| One root file | `npx vitest run tests/<name>.test.ts` |
| Root suite | `npx vitest run` |
| Root typecheck | `npm run typecheck` — **excludes `apps/`** |

`npx vitest run apps/workbench/tests/x.test.ts` from the repo root **matches no files and
exits 0**. Always read the reported counts.

Baselines on this branch: root 459 files / 4870 passing / 1 skipped; workbench 84 files /
1066 passing; both typechecks clean. **This machine has been at load average 246 with memory
pressure and vitest cannot always spawn fork workers** — if the root suite reports
non-deterministic counts, collection errors, or `Failed to start forks worker`, that is the
environment and not the change. Say so rather than chasing it, and let CI arbitrate.

**Client data is privileged.** Print counts, roles, kinds and matter ids — never a client's
or fiduciary's name.

**What lands on deploy.** The owner chose one task per gap across every matter with
appointments. Measured now: 72 chains, 39 with no successor, 19 matters with appointments,
11 carrying at least one gap. So the first production sweep creates roughly **39 tasks
across 11 matters within a minute of merge**, automatically. That is intended, and Task 6
reports the real numbers.

---

## File structure

| File | Responsibility |
| --- | --- |
| `apps/workbench/lib/fiduciary/matrix.ts` | Modify: `MatrixIssue` gains `role` and `forParty`. |
| `apps/workbench/tests/fiduciary-matrix.test.ts` | Modify: the identity fields, and that `concentrated` carries none. |
| `supabase/migrations/20261105000000_fiduciary_task_source.sql` | Create: `'fiduciary'` joins `tasks_source_check`. |
| `lib/tasks/types.ts` (root app) | Modify: `'fiduciary'` joins `TASK_SOURCES`, with a label and an AA pill. |
| `tests/task-pill-contrast.test.ts` (root app) | Covered automatically; assert the new member explicitly. |
| `apps/workbench/lib/fiduciary/tasks.ts` | Create: the pure emitter — rows from issues, and the keep/insert/retire plan. |
| `apps/workbench/tests/fiduciary-tasks.test.ts` | Create: the pure tests, skip-on-unknown first. |
| `apps/workbench/lib/fiduciary/sweep.ts` | Create: the queried half — load, plan, write. |
| `apps/workbench/tests/fiduciary-sweep.test.ts` | Create: the sweep against a fake client. |
| `apps/workbench/app/api/cron/tick/route.ts` | Modify: run the sweep each tick. |
| `apps/workbench/tests/tick-route.test.ts` | Modify: assert the sweep runs, and that a failing sweep does not fail the tick. |

---

### Task 1: an issue that can be identified

`MatrixIssue` is `{kind, severity, message}` and the message embeds names — *"Trustee for
the client has no successor. If Jane Smith cannot serve…"*. A task keyed off that would be
orphaned and duplicated the moment a contact is renamed. `role` and `forParty` are already
in scope where each issue is built; they are simply not carried out.

**Files:**
- Modify: `apps/workbench/lib/fiduciary/matrix.ts`
- Test: `apps/workbench/tests/fiduciary-matrix.test.ts`

- [ ] **Step 1: Read what exists**

```bash
sed -n '85,165p' apps/workbench/lib/fiduciary/matrix.ts
```

Note the four `issues.push({...})` sites and which have `chain` in scope (`no_successor`,
`duplicate`, `no_guardian`) versus which have only a `person` (`concentrated`).

- [ ] **Step 2: Write the failing tests**

Append to `apps/workbench/tests/fiduciary-matrix.test.ts`, reusing its existing
`appointment()` fixture rather than declaring a new one:

```ts
describe('issue identity', () => {
  /**
   * A task's `batch_tag` is built from these rather than from `message`,
   * which embeds people's names — keyed off the message, renaming a contact
   * would read as a new issue: the old task orphaned, a duplicate created,
   * and the attorney's place in it lost.
   */
  it('names the role and party a chain issue belongs to', () => {
    const matrix = buildMatrix([appointment()])
    const issue = matrixIssues(matrix, { minorChildren: 0 }).find((i) => i.kind === 'no_successor')
    expect(issue).toBeDefined()
    expect(issue!.role).toBe(appointment().role)
    expect(issue!.forParty).toBe(appointment().forParty)
  })

  /**
   * `concentrated` is about a person across every chain, not one chain, so it
   * has no role to name. It is also the one issue that never becomes a task,
   * so it never needs a tag — but the type must still admit it, and the
   * emitter refuses to build a tag without one rather than writing
   * `fiduciary:...#concentrated:undefined:undefined`.
   */
  it('leaves role and party null for an issue about a person, not a chain', () => {
    const matrix = buildMatrix([appointment()])
    const concentrated = matrixIssues(matrix, { minorChildren: 0 }).find((i) => i.kind === 'concentrated')
    if (!concentrated) return
    expect(concentrated.role).toBeNull()
    expect(concentrated.forParty).toBeNull()
  })
})
```

If the existing suite's fixture is not named `appointment()`, use whatever it is and say so
in your report. If `concentrated` cannot be produced by a single appointment, the second
test's early `return` makes it vacuous — **say so** rather than leaving a test that asserts
nothing, and build a fixture that does produce it.

- [ ] **Step 3: Run to verify they fail**

```bash
cd apps/workbench && npx vitest run tests/fiduciary-matrix.test.ts
```

Expected: FAIL — `MatrixIssue` has no `role` or `forParty`.

- [ ] **Step 4: Implement**

In `apps/workbench/lib/fiduciary/matrix.ts`, extend the interface:

```ts
export interface MatrixIssue {
  kind: IssueKind
  severity: IssueSeverity
  message: string
  /**
   * Which chain this issue is about, or `null` for an issue about a person
   * across every chain (`concentrated`).
   *
   * Carried out so an issue has an identity independent of its `message`,
   * which embeds names: `lib/fiduciary/tasks.ts` builds a task's `batch_tag`
   * from these, and a tag built from the message would change whenever a
   * contact was renamed — orphaning the task and creating a duplicate beside
   * it.
   */
  role: FiduciaryRole | null
  forParty: ForParty | null
}
```

Add `role: chain.role, forParty: chain.forParty` to the three chain-scoped pushes, and
`role: null, forParty: null` to the `concentrated` push. Import or reference the existing
`FiduciaryRole` and `ForParty` types — do not restate them as string unions.

- [ ] **Step 5: Verify**

```bash
cd apps/workbench && npm run typecheck && npx vitest run
```

Expected: PASS. The two page components spread `MatrixIssue` into their rendering; adding
fields cannot break them, but the compiler will say if either destructures exhaustively.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/fiduciary/matrix.ts apps/workbench/tests/fiduciary-matrix.test.ts
git commit -F - <<'MSG'
A matrix issue says which chain it is about

MatrixIssue was {kind, severity, message}, and the message embeds people's
names -- "Trustee for the client has no successor. If Jane Smith cannot
serve...". Nothing consumed it but two page renders, so that was enough.

It is not enough for a task. A batch_tag built from the message would change
the moment a contact was renamed: the old task orphaned, a duplicate created
beside it, and the attorney's place in it lost. role and forParty were already
in scope where each issue is built and simply not carried out.

Null for `concentrated`, which is about a person across every chain rather
than one chain. That issue also never becomes a task, so it never needs a tag
-- but the type has to admit it, and the emitter refuses to build a tag
without a role rather than writing one with `undefined` in it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: a task source the app can render

Two halves, and the second is the lesson of #417: `'prompt'` was added to the database's
`tasks_source_check` and never to the root app's `TASK_SOURCES`, so every task the field
audit created rendered as an **empty, unstyled chip** with no filter option — in the only
app that displays tasks. Do not repeat it.

**Files:**
- Create: `supabase/migrations/20261105000000_fiduciary_task_source.sql`
- Modify: `lib/tasks/types.ts` (root app)
- Test: `tests/task-pill-contrast.test.ts` (root app)

- [ ] **Step 1: Write the migration**

```sql
-- `tasks.source` learns 'fiduciary': a task the deterministic fiduciary matrix
-- created, not a prompt run and not a person.
--
-- The matrix has found these gaps since it was written -- 39 of 72 chains with
-- no successor, as measured on 2026-09-07 -- and rendered them on /fiduciary,
-- where somebody has to remember to look. This is what lets them reach the
-- queue instead.
--
-- A distinct source rather than reusing 'stage' or 'sla', because
-- lib/fiduciary/tasks.ts's withdrawal rule narrows on it: a tool may withdraw
-- its own suggestion and must never touch a task another source is tracking.
-- Reusing an existing value would make that rule unable to tell them apart.
--
-- Same shape as 20261029000000_prompt_task_source.sql, which added 'prompt'.

alter table public.tasks
  drop constraint if exists tasks_source_check;

alter table public.tasks
  add constraint tasks_source_check
  check (source in ('manual', 'stage', 'template', 'cadence', 'sla', 'prompt', 'fiduciary'));

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Write the failing root-app test**

In `tests/task-pill-contrast.test.ts`, inside the existing
`describe('every task source pill is readable', ...)`:

```ts
  it('knows about tasks the fiduciary matrix created', () => {
    expect(TASK_SOURCES).toContain('fiduciary')
  })
```

The file already has a totality assertion over `TASK_SOURCE_LABEL` and `TASK_SOURCE_PILL`,
and the parameterised contrast cases iterate `TASK_SOURCES` — so adding the member brings
the new pill under both automatically. Check that both are still present; if the totality
test is missing, add it.

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run tests/task-pill-contrast.test.ts
```

Expected: FAIL on the new case.

- [ ] **Step 4: Implement in `lib/tasks/types.ts`**

Add `'fiduciary'` to `TASK_SOURCES`, extending the existing comment about `'prompt'` to
cover it. Then:

```ts
  fiduciary: 'Fiduciary',
```

in `TASK_SOURCE_LABEL`, and in `TASK_SOURCE_PILL`:

```ts
  // 7.60:1 light, 6.26:1 dark, measured with lib/theme/contrast.ts against the
  // theme tokens rather than picked by eye. Unused by the other source pills,
  // and these are gaps in a plan rather than suggestions — `--red-strong` was
  // the first choice and fails AA in light at 3.95:1, which is why the pair is
  // measured and not assumed.
  fiduciary: 'bg-red-bg text-red',
```

- [ ] **Step 5: Verify**

```bash
npx vitest run tests/task-pill-contrast.test.ts
```

```bash
npm run typecheck && npx vitest run
```

Expected: PASS, with two new parameterised contrast cases (`light: fiduciary`,
`dark: fiduciary`) both clearing 4.5. `TaskSource` gaining a member can surface exhaustive
`switch`es or `Record<TaskSource, …>` maps — the compiler names each; fill them in properly
rather than widening a type or adding a fallback.

- [ ] **Step 6: Apply the migration**

The pooler is the only route from a worktree. Copy the env in only for the operation, never
print the password, and delete the copy immediately — including on failure.

```bash
cp /Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.env.local .env.local.tmp
PW=$(grep -m1 '^SUPABASE_DB_PASSWORD=' .env.local.tmp | cut -d= -f2- | tr -d '"')
ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$PW")
DBURL="postgresql://postgres.qifunlovuwaryzsyfbnh:${ENC}@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
psql "$DBURL" -f supabase/migrations/20261105000000_fiduciary_task_source.sql
rm -f .env.local.tmp
```

- [ ] **Step 7: Verify the constraint took, in the database rather than the history**

Rebuild `DBURL` as above, then:

```bash
psql "$DBURL" -At -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'tasks_source_check';"
rm -f .env.local.tmp
```

Expected: a definition containing `'fiduciary'`. Do not trust
`supabase_migrations.schema_migrations` — this project has had phantom rows.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261105000000_fiduciary_task_source.sql lib/tasks/types.ts tests/task-pill-contrast.test.ts
git commit -F - <<'MSG'
A task the fiduciary matrix created says so

tasks.source learns 'fiduciary', in the database constraint and in the root
app's union, label and pill in the same commit. Both halves, because #417
shipped only the first for 'prompt': every task the field audit created
rendered as an empty unstyled chip with no filter option, in the only app that
displays tasks.

A distinct source rather than reusing 'stage' or 'sla', because the withdrawal
rule narrows on it -- a tool may withdraw its own suggestion and must never
touch a task another source is tracking, and a reused value would make that
rule unable to tell them apart.

The pill is measured, not chosen: 7.60:1 light and 6.26:1 dark. --red-strong
was the first pick and fails AA in light at 3.95:1, which is the reason the
contrast test iterates TASK_SOURCES rather than trusting a list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: the pure emitter

Two functions, no database. Mirrors `planEmit`'s discipline deliberately without sharing its
code — see the design note on why two instances do not justify the abstraction.

**Files:**
- Create: `apps/workbench/lib/fiduciary/tasks.ts`
- Test: `apps/workbench/tests/fiduciary-tasks.test.ts`

- [ ] **Step 1: Write the failing tests, skip-on-unknown first**

Create `apps/workbench/tests/fiduciary-tasks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  FIDUCIARY_TASK_SOURCE,
  fiduciaryTaskRows,
  planFiduciaryEmit,
  type ExistingFiduciaryTask,
} from '@/lib/fiduciary/tasks'
import type { MatrixIssue } from '@/lib/fiduciary/matrix'

const MATTER = 'matter-1'

function issue(over: Partial<MatrixIssue> = {}): MatrixIssue {
  return {
    kind: 'no_successor',
    severity: 'gap',
    message: 'Trustee for the client has no successor.',
    role: 'trustee',
    forParty: 'client',
    ...over,
  }
}

function existing(over: Partial<ExistingFiduciaryTask> = {}): ExistingFiduciaryTask {
  return {
    id: 'task-1',
    source: FIDUCIARY_TASK_SOURCE,
    batchTag: `fiduciary:${MATTER}#no_successor:trustee:client`,
    status: 'open',
    assigneeId: null,
    title: 'Trustee for the client has no successor.',
    priority: 'normal',
    ...over,
  }
}

describe('fiduciaryTaskRows', () => {
  it('makes one row per gap, tagged by kind, role and party', () => {
    const rows = fiduciaryTaskRows(MATTER, [issue()])
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe(FIDUCIARY_TASK_SOURCE)
    expect(rows[0].batch_tag).toBe(`fiduciary:${MATTER}#no_successor:trustee:client`)
    expect(rows[0].task_type).toBe('single')
    expect(rows[0].auto).toBe(true)
  })

  /**
   * The matrix's own comment is explicit about why `note` exists: "a spouse
   * holding every office is the normal design of a plan, and calling it a
   * fault would teach the reader to ignore this list". A note that became a
   * task would do exactly that, and cost the queue its credibility.
   */
  it('never makes a task from a note', () => {
    expect(fiduciaryTaskRows(MATTER, [issue({ kind: 'concentrated', severity: 'note', role: null, forParty: null })])).toEqual([])
  })

  /**
   * The same refusal, with severity as the *only* possible cause of it.
   *
   * The test above passes the real shape the matrix builds — `concentrated`
   * with no role — and that issue is rejected by the role guard before the
   * severity gate is ever consulted. So on its own it proves the role guard
   * twice and the gate not at all: letting `note` through leaves it green.
   * Measured, not supposed — adding `note` to the priority table failed
   * nothing until this case existed.
   *
   * No note carries a role today. But `concentrated` is about a person, and
   * naming the office they hold would be an unremarkable change — and on that
   * day this gate is the only thing between a normal plan and a task calling
   * it a fault.
   */
  it('never makes a task from a note even when the note has a role and a party', () => {
    expect(
      fiduciaryTaskRows(MATTER, [issue({ severity: 'note', role: 'trustee', forParty: 'client' })]),
    ).toEqual([])
  })

  it('makes tasks from both error and gap', () => {
    const rows = fiduciaryTaskRows(MATTER, [
      issue({ severity: 'gap' }),
      issue({ kind: 'duplicate', severity: 'error', role: 'personal_rep' }),
    ])
    expect(rows).toHaveLength(2)
  })

  it('gives an error high priority and a gap normal', () => {
    // An error is a contradiction that is wrong now; a gap is a hole that
    // shows itself when someone cannot serve.
    expect(fiduciaryTaskRows(MATTER, [issue({ kind: 'duplicate', severity: 'error' })])[0].priority).toBe('high')
    expect(fiduciaryTaskRows(MATTER, [issue({ severity: 'gap' })])[0].priority).toBe('normal')
  })

  /** A tag with `undefined` in it is not an identity. */
  it('refuses to build a row for an issue with no role', () => {
    expect(fiduciaryTaskRows(MATTER, [issue({ role: null })])).toEqual([])
  })

  /**
   * But a null party is not a failure. `no_guardian` is built outside the
   * chain loop and has no party — minor children belong to the couple, and a
   * guardian named by either spouse satisfies it — yet it is a `gap` and must
   * become a task. Requiring both fields would have dropped the
   * highest-consequence gap on the screen with nothing failing to say so.
   */
  it('tags an issue with no party as covering both', () => {
    const rows = fiduciaryTaskRows(MATTER, [
      issue({ kind: 'no_guardian', severity: 'gap', role: 'guardian', forParty: null }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].batch_tag).toBe(`fiduciary:${MATTER}#no_guardian:guardian:both`)
  })

  /**
   * The tag must not move when a person is renamed — that is the whole reason
   * `role` and `forParty` were carried out of the matrix.
   */
  it('keeps the tag stable when only the message changes', () => {
    const before = fiduciaryTaskRows(MATTER, [issue({ message: 'If Jane cannot serve…' })])[0]
    const after = fiduciaryTaskRows(MATTER, [issue({ message: 'If Janet cannot serve…' })])[0]
    expect(after.batch_tag).toBe(before.batch_tag)
  })
})

describe('planFiduciaryEmit', () => {
  it('inserts a gap that has no task yet', () => {
    const plan = planFiduciaryEmit([], fiduciaryTaskRows(MATTER, [issue()]))
    expect(plan.insert).toHaveLength(1)
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual([])
  })

  /** A gap that persists keeps its task, so the attorney's place in it
   *  survives every sweep — id and created_at intact. */
  it('keeps a task whose gap still stands', () => {
    const plan = planFiduciaryEmit([existing()], fiduciaryTaskRows(MATTER, [issue()]))
    expect(plan.insert).toEqual([])
    expect(plan.keep).toEqual(['task-1'])
    expect(plan.supersede).toEqual([])
  })

  it('retires a task whose gap has been filled', () => {
    const plan = planFiduciaryEmit([existing()], [])
    expect(plan.supersede).toEqual(['task-1'])
  })

  it('replaces a task whose message changed under the same tag', () => {
    const plan = planFiduciaryEmit([existing({ title: 'Older wording.' })], fiduciaryTaskRows(MATTER, [issue()]))
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['task-1'])
    expect(plan.insert).toHaveLength(1)
  })

  it('never touches a task someone made, holds, or has moved on', () => {
    const plan = planFiduciaryEmit(
      [
        existing({ id: 'manual', source: 'manual' }),
        existing({ id: 'assigned', assigneeId: 'user-1' }),
        existing({ id: 'done', status: 'done' }),
        existing({ id: 'in-progress', status: 'in_progress' }),
      ],
      [],
    )
    expect(plan.supersede).toEqual([])
  })

  it('never touches a task tagged for another matter', () => {
    const theirs = existing({ id: 'theirs', batchTag: 'fiduciary:matter-2#no_successor:trustee:client' })
    expect(planFiduciaryEmit([theirs], []).supersede).toEqual([])
  })

  /** A tag this module did not write is nobody's to retire. */
  it('never touches a task whose tag it cannot parse', () => {
    expect(planFiduciaryEmit([existing({ id: 'foreign', batchTag: 'something-else' })], []).supersede).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/workbench && npx vitest run tests/fiduciary-tasks.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `apps/workbench/lib/fiduciary/tasks.ts`:

```ts
import type { ForParty, FiduciaryRole, MatrixIssue } from './matrix'

/**
 * The `tasks.source` value a fiduciary gap's task carries.
 *
 * `tasks_source_check` allows it (see
 * 20261105000000_fiduciary_task_source.sql). `planFiduciaryEmit` narrows on
 * it, and that has to be a fact the database enforces on every row rather
 * than a convention this module assumes of every caller: the rule's whole job
 * is to withdraw this tool's own suggestions and nothing else.
 */
export const FIDUCIARY_TASK_SOURCE = 'fiduciary'

export interface FiduciaryTaskRow {
  matter_id: string
  source: string
  task_type: string
  auto: boolean
  batch_tag: string
  title: string
  priority: string
}

export interface ExistingFiduciaryTask {
  id: string
  source: string
  batchTag: string | null
  status: string
  assigneeId: string | null
  title: string
  priority: string
}

export interface FiduciaryEmitPlan {
  insert: FiduciaryTaskRow[]
  keep: string[]
  supersede: string[]
}

/** An error is a contradiction that is wrong now; a gap is a hole that shows
 *  itself only when someone cannot serve. A note is neither — see below. */
const PRIORITY_BY_SEVERITY: Record<string, string> = { error: 'high', gap: 'normal' }

function tagFor(matterId: string, issue: MatrixIssue): string | null {
  // A `role` is required; a null `forParty` is not a failure.
  //
  // This asymmetry matters. Two issues are built outside the chain loop:
  // `concentrated`, which has neither field and never becomes a task anyway,
  // and `no_guardian`, which has no chain either but *is* a `gap` and must
  // become one. Requiring both fields would drop the highest-consequence
  // finding on the screen with nothing failing to say so, which is exactly
  // the kind of silence this feature exists to remove. So `no_guardian`
  // carries `role: 'guardian'` and no party — minor children belong to the
  // couple, and a guardian named by either spouse satisfies it, so it is one
  // gap per matter rather than one per party.
  //
  // `both` rather than an omitted segment, so the tag is always three
  // segments and stays parseable — and so the string `null` never reaches
  // stored data.
  if (!issue.role) return null
  return `fiduciary:${matterId}#${issue.kind}:${issue.role}:${issue.forParty ?? 'both'}`
}

/**
 * One task per gap worth acting on.
 *
 * The gate is severity, and it is the same shape as `actionableFindings` for
 * prompts: the one place that decides whether a finding may act. Only `error`
 * and `gap` do. `note` never does, and the matrix says why in its own comment
 * — "a spouse holding every office is the normal design of a plan, and calling
 * it a fault would teach the reader to ignore this list". A note that became a
 * task would teach exactly that, and the cost is not the note, it is the
 * credibility of everything else in the queue.
 *
 * The title is the issue's message, which is written to be read by a person.
 * The `batch_tag` is *not* built from it: see `tagFor`.
 */
export function fiduciaryTaskRows(matterId: string, issues: MatrixIssue[]): FiduciaryTaskRow[] {
  return issues.flatMap((issue) => {
    const priority = PRIORITY_BY_SEVERITY[issue.severity]
    if (!priority) return []
    const batchTag = tagFor(matterId, issue)
    if (!batchTag) return []
    return [
      {
        matter_id: matterId,
        source: FIDUCIARY_TASK_SOURCE,
        task_type: 'single',
        auto: true,
        batch_tag: batchTag,
        title: issue.message,
        priority,
      },
    ]
  })
}

/**
 * What this matter's fiduciary tasks should be, against what they are.
 *
 * Deliberately not `planEmit` from `lib/fieldAudit/tasks.ts`, which answers
 * the same shape of question for prompts. Two instances do not justify one
 * abstraction, and that function has just absorbed three separate corrections
 * — a retry duplicating instead of replacing, an uncitable finding retiring a
 * cited one, and one prompt erasing another's tasks. Putting both callers
 * behind a seam nobody has run twice would risk all of that to save a few
 * lines. If a third emitter appears, extract then, with three real cases to
 * design against.
 *
 * The narrowing is the same on every axis, and for the same reasons: this
 * source only, `open` only, unassigned only. A task someone has picked up is
 * real work being done, and no sweep may close it.
 */
export function planFiduciaryEmit(
  matterId: string,
  existing: ExistingFiduciaryTask[],
  desired: FiduciaryTaskRow[],
): FiduciaryEmitPlan {

  const candidates = existing.filter(
    (task) =>
      task.source === FIDUCIARY_TASK_SOURCE &&
      task.status === 'open' &&
      task.assigneeId === null &&
      // This matter's own tags only. The caller passes one matter's tasks, but
      // the rule should not depend on it having filtered correctly — and a tag
      // this module did not write is nobody's to retire.
      task.batchTag !== null &&
      // This matter's own tags only, and exact: the `#` makes the matter
      // segment a whole match rather than a prefix one, so `matter-1` cannot
      // reach `matter-10`'s tasks. Derived from the same `tagPrefix` helper
      // `tagFor` uses, so the emitter and the withdrawal rule cannot disagree
      // about the tag shape — if they did, every task this module created
      // would sit beyond its own reach, and nothing would say so.
      task.batchTag.startsWith(`${tagPrefix(matterId)}#`),
  )

  const byTag = new Map(candidates.map((task) => [task.batchTag as string, task]))
  const keep: string[] = []
  const insert: FiduciaryTaskRow[] = []
  const matched = new Set<string>()

  for (const row of desired) {
    const twin = byTag.get(row.batch_tag)
    // Same tag *and* same content: the gap is unchanged, so the row stays
    // exactly as it is and keeps its id and `created_at`. Same tag with
    // different wording is a replacement, not a keep.
    if (twin && twin.title === row.title && twin.priority === row.priority) {
      matched.add(twin.id)
      keep.push(twin.id)
    } else {
      insert.push(row)
    }
  }

  const supersede = candidates.filter((task) => !matched.has(task.id)).map((task) => task.id)
  return { insert, keep, supersede }
}
```

**Why the matter id is a parameter.** An earlier draft derived the matter prefix from
`desired[0].batch_tag`, with a fallback when `desired` was empty — and empty `desired` is
exactly the call that retires tasks, so the one call that withdraws work would have been the
one call with no matter scope. Passing it removes the fallback and the doubt: there is no
code path where the matter filter is skipped.

Use one `tagPrefix(matterId)` helper for both `tagFor` and the candidate filter. If the two
ever disagreed about the tag's shape, every task this module created would sit outside its
own reach — no keep, no retire, a fresh duplicate every sweep — and nothing would fail.

- [ ] **Step 4: Run to verify they pass**

```bash
cd apps/workbench && npx vitest run tests/fiduciary-tasks.test.ts
```

Expected: PASS, with every `planFiduciaryEmit` call passing the matter id first.

- [ ] **Step 5: Prove the guards bite**

Break each and confirm exactly which tests fail, then restore:

1. Let `note` through (add `note: 'normal'` to `PRIORITY_BY_SEVERITY`).
2. Build the tag from `issue.message` instead of role and party.
3. Drop `task.assigneeId === null` from the candidate filter.

Report the failing test names and counts for each. If any produces no failure, say so.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/fiduciary/tasks.ts apps/workbench/tests/fiduciary-tasks.test.ts
git commit -F - <<'MSG'
One task per fiduciary gap worth acting on

The gate is severity, and it is the same shape as actionableFindings for
prompts: one place decides whether a finding may act. error and gap do; note
never does. The matrix says why in its own comment -- a spouse holding every
office is the normal design of a plan, and calling it a fault would teach the
reader to ignore the list. What a note would cost is not the note, it is the
credibility of everything else in the queue.

The tag is built from kind, role and party, never from the message. The
message embeds names, so a tag built from it would move whenever a contact was
renamed -- orphaning the task and creating a duplicate beside it. An issue with
no role gets no row at all rather than a tag with undefined in it.

Not planEmit, deliberately. That function answers the same shape of question
for prompts and has just absorbed three corrections -- a retry duplicating
instead of replacing, an uncitable finding retiring a cited one, and one prompt
erasing another's. Putting both callers behind a seam nobody has run twice
would risk all of it to save a few lines. Two instances do not justify the
abstraction; a third would.

The three narrowing axes are the same, for the same reasons: this source only,
open only, unassigned only. A task someone has picked up is real work being
done and no sweep may close it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: the sweep

**Files:**
- Create: `apps/workbench/lib/fiduciary/sweep.ts`
- Test: `apps/workbench/tests/fiduciary-sweep.test.ts`

- [ ] **Step 1: Read what `loadFiduciaries` returns**

```bash
sed -n '1,120p' apps/workbench/lib/fiduciary/repository.ts
```

You need its exact return shape — the matter id, `appointments`, and `minorChildren` — and
whether it throws or returns empty on a query failure. **That distinction decides the whole
task**, so read it rather than assuming.

- [ ] **Step 2: Write the failing tests**

Create `apps/workbench/tests/fiduciary-sweep.test.ts`. The first test is the one that
matters most:

```ts
/**
 * The #418 lesson, re-asserted against a different data source. If the
 * appointments cannot be loaded, that is not "this matter has no gaps", it is
 * "we could not tell" — and retiring a task on it would repeat exactly the
 * defect that made a four-times-verified blocker vanish from a live matter.
 */
it('writes nothing at all when the appointments cannot be loaded', async () => {
  // …a client whose fiduciary load rejects, and a matter with an existing
  // open fiduciary task. Assert no insert and no update.
})
```

Then: a matter with a gap and no task gets one; a matter whose gap persists keeps its task
and writes nothing; a matter whose gap is filled has its task retired; and a matter with
only `note` issues gets nothing.

Build the fake client on whatever shape `loadFiduciaries` actually queries — Step 1 tells
you. Follow `apps/workbench/tests/field-audit-tasks.test.ts`'s `fakeClient` for the
insert/update recording idiom.

- [ ] **Step 3: Run to verify they fail, then implement**

```bash
cd apps/workbench && npx vitest run tests/fiduciary-sweep.test.ts
```

Create `apps/workbench/lib/fiduciary/sweep.ts` exporting
`sweepFiduciaryTasks(client): Promise<{ mattersConsidered: number; created: number; kept: number; superseded: number; skipped: number }>`.

For each matter `loadFiduciaries` returns: build the matrix, take `matrixIssues`, build the
desired rows, read that matter's existing `source = 'fiduciary'` tasks, plan, insert, then
withdraw — **in that order**, so a failed insert cannot close a task whose replacement was
never written. Reuse the archived + `skipped_at` + `closeout_reason` convention that
`lib/fieldAudit/tasks.ts` uses; the reason value should say a fiduciary sweep did it, and
must be one `tasks_closeout_reason_check` allows — **check the constraint before choosing
one**, and if no suitable value exists, add it in the Task 2 migration and say so.

A matter that throws while loading is counted in `skipped` and otherwise untouched.

- [ ] **Step 4: Wire it into the tick**

In `apps/workbench/app/api/cron/tick/route.ts`, run the sweep each tick and include its
counts in the response. **A failing sweep must not fail the tick** — the queue's own work is
more important than this, and a sweep that throws should be caught, reported in the payload,
and left for the next minute. Add a comment saying so.

- [ ] **Step 5: Verify, prove it bites, commit**

```bash
cd apps/workbench && npm run typecheck && npx vitest run
```

Break: make the sweep treat a load failure as "no issues" and confirm the first test fails.
Restore.

Write the commit message yourself, explaining why the sweep is unqueued (it costs four
queries regardless of matter count and makes no model call, so the machinery to avoid one
would cost more than the sweep) and why a failing sweep cannot fail the tick.

---

### Task 5: verify

- [ ] **Step 1: Both projects**

```bash
npm run typecheck && npx vitest run
```

```bash
cd apps/workbench && npm run typecheck && npx vitest run
```

If the root suite reports `Failed to start forks worker`, non-deterministic counts, or
collection errors, that is this machine's memory pressure — say so and let CI arbitrate
rather than chasing it.

- [ ] **Step 2: The live column check**

The sweep reads `contact_roles`, `matter_contacts`, `contacts` and `matters` through
`loadFiduciaries`, and writes `tasks`. Verify against the real database:

```bash
cd apps/workbench && npx vitest run tests/query-columns.test.ts
```

```bash
cp /Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.env.local .env.local.tmp
set -a && . ./.env.local.tmp && set +a
node scripts/checkDbColumns.mjs
rm -f .env.local.tmp
```

Expected: both PASS. A column reported absent that `information_schema` shows exists is
PostgREST's stale cache — `notify pgrst, 'reload schema'` and wait.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin claude/fiduciary-tasks
```

`gh pr create`, stating what the sweep will create on deploy (measured: 72 chains, 39
without a successor, 11 of 19 matters affected), that only `error` and `gap` become tasks
and why `note` does not, and that a matter whose appointments cannot be loaded is skipped
rather than cleared. Include the
`🤖 Generated with [Claude Code](https://claude.com/claude-code)` trailer.

---

### Task 6: the real sweep, reported

**Do not merge without showing the owner these numbers first.** Merging starts the sweep
automatically, and it writes to a queue they work from every day.

- [ ] **Step 1: After merge and deploy, report what happened**

- how many matters were considered, and how many skipped
- how many tasks created, kept and superseded on the first tick
- **one matter's tasks named by kind and role** — not by fiduciary name
- the second tick's counts, which must be `created: 0, superseded: 0` for an unchanged
  database. That is the idempotence check, and it is the one that would catch a sweep
  churning the queue every minute
- the pill rendering as **Fiduciary** in the root app's task list

- [ ] **Step 2: Confirm nothing else moved**

The 1,460 `sla`, 9 `manual` and 1 `prompt` tasks must be untouched. Report their counts
before and after. A sweep that touched another source's task would be the #419 defect in a
new place, and the narrowing is what prevents it — so it should be verified rather than
assumed.

---

## Out of scope, named

**A second task-emitting prompt.** Still unbuilt, so #419's cross-prompt property remains
proven by tests only. The candidate identified while investigating this slice is whether the
attorney's own `drafting_notes` contradict the structured decisions recorded beside them —
free text against structure, so genuinely not a deterministic check.

**Unifying the two task emitters.** Deferred with reasons in the design note.

**Whether a fiduciary is the right choice.** This asks only what happens when one cannot
serve.
