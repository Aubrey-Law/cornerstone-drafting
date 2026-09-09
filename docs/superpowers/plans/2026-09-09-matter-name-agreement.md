# Matter Name Agreement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface, as a `high` task, any matter whose own name disagrees with the client and spouse names on the design sheet it drafts from.

**Architecture:** A deterministic checker, not a prompt. Four small pure modules — name comparison, issue derivation, task planning, and a sweep — mirroring `lib/fiduciary/*`, which is the existing precedent for a code-computed finding that becomes a task. No model call, no run, no prompt version.

**Tech Stack:** TypeScript, Supabase Postgres, vitest 4. Tests live in `apps/workbench/tests/`.

**Spec:** `docs/superpowers/specs/2026-09-09-matter-name-agreement-design.md`

---

## Worktree

Work only inside **`/Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.claude/worktrees/workbench-app-improvements-e03851`**. Do not `cd` to the repository root. **Never use `git stash`** — the stash stack is shared with the main checkout.

## How to run tests

```bash
npm run test --workspace apps/workbench -- tests/name-agreement.test.ts
```

A bare `npx vitest run apps/workbench/tests/x.test.ts` from the repo root **matches no files and exits 0**, which looks exactly like a pass. Never use it.

Typecheck both projects: `npm run typecheck --workspace apps/workbench && npm run typecheck`

## Why this is not a seventh audit check

The answer is a string comparison. A prompt would buy a model call, per-run variance, and a differently-worded finding each time for a question with one right answer. `lib/fiduciary/matrix.ts` is the precedent: issues computed in code, emitted as tasks under their own `tasks.source`.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/workbench/lib/identity/names.ts` | **new.** `personPartOf`, `normaliseName`, `namesAgree`. Pure; no database, no types from Supabase. |
| `apps/workbench/lib/identity/matrix.ts` | **new.** `IdentityIssue`, `nameIssueFor(matter, sheet)` → issue or null. Pure. |
| `apps/workbench/lib/identity/tasks.ts` | **new.** `IDENTITY_TASK_SOURCE`, `IdentityTaskRow`, `identityTaskRowFor`, `planIdentityEmit`. Pure. |
| `apps/workbench/lib/identity/sweep.ts` | **new.** `loadNameCandidates`, `sweepNameAgreement(client)`. The only file that touches the database. |
| `apps/workbench/app/api/cron/tick/route.ts` | calls the sweep beside `sweepFiduciaryTasks`. |
| `supabase/migrations/<ts>_identity_task_source.sql` | **new.** Extends `tasks_source_check` and `tasks_closeout_reason_check`. |
| `lib/tasks/types.ts` (root app) | `TASK_SOURCES`, the label map, the pill map. |

---

### Task 1: Comparing two names

**Files:**
- Create: `apps/workbench/lib/identity/names.ts`
- Create: `apps/workbench/tests/name-agreement.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/workbench/tests/name-agreement.test.ts`. **Every case below is a real matter measured on 2026-09-09** — the four refinements each exist because the simpler rule flagged a real person wrongly.

```ts
import { describe, expect, it } from 'vitest'
import { namesAgree, normaliseName, personPartOf } from '@/lib/identity/names'

describe('personPartOf', () => {
  /** Matter names are `<person> — <what the matter is>`. */
  it('takes the person part before an em dash', () => {
    expect(personPartOf('Can Cheng — Estate Planning')).toBe('Can Cheng')
  })

  it('accepts an en dash or a hyphen as the separator', () => {
    expect(personPartOf('Karen Wong – Estate Planning')).toBe('Karen Wong')
    expect(personPartOf('Sam Ensslin - Trust Review')).toBe('Sam Ensslin')
  })

  /** Most matter names carry no separator at all. */
  it('returns the whole name when there is no separator', () => {
    expect(personPartOf('Leslie Lewis')).toBe('Leslie Lewis')
  })

  it('is null for nothing usable', () => {
    expect(personPartOf(null)).toBeNull()
    expect(personPartOf('   ')).toBeNull()
    expect(personPartOf('— Estate Planning')).toBeNull()
  })
})

describe('normaliseName', () => {
  it('lowercases and drops punctuation, keeping hyphens in surnames', () => {
    expect(normaliseName('Richard G. Goss')).toEqual(['richard', 'g', 'goss'])
    expect(normaliseName('Alexandra Purdue-Smithe')).toEqual(['alexandra', 'purdue-smithe'])
  })

  /** Measured: `Frank Lombardi` vs `Frank J. Lombardi Jr.` is one man. */
  it('drops generational and professional suffixes', () => {
    expect(normaliseName('Frank J. Lombardi Jr.')).toEqual(['frank', 'j', 'lombardi'])
    expect(normaliseName('Ada Byron III, Esq.')).toEqual(['ada', 'byron'])
  })

  it('is empty for nothing usable', () => {
    expect(normaliseName(null)).toEqual([])
    expect(normaliseName('Jr.')).toEqual([])
  })
})

describe('namesAgree', () => {
  /** Measured: `Richard G. Goss` is the matter, `Richard Goss` the sheet. */
  it('ignores middle names and initials', () => {
    expect(namesAgree('Richard G. Goss', 'Richard Goss')).toBe(true)
  })

  /** Measured: `Frank Lombardi` vs `Frank J. Lombardi Jr.` */
  it('ignores a generational suffix', () => {
    expect(namesAgree('Frank Lombardi', 'Frank J. Lombardi Jr.')).toBe(true)
  })

  /** Measured: `Alexandra Purdue` vs `Alexandra Purdue-Smithe`. A hyphenated
   *  surname is the ordinary case, not a discrepancy. */
  it('accepts a surname that is a component of the other', () => {
    expect(namesAgree('Alexandra Purdue', 'Alexandra Purdue-Smithe')).toBe(true)
    expect(namesAgree('Alexandra Purdue-Smithe', 'Alexandra Purdue')).toBe(true)
  })

  /** The measured discrepancy this whole feature exists for. */
  it('does not agree when the given name differs', () => {
    expect(namesAgree('Can Cheng', 'Jie Cheng')).toBe(false)
    expect(namesAgree('Laura Coakley', 'Kayleigh Marie Coakley')).toBe(false)
  })

  it('does not agree when the names are unrelated', () => {
    expect(namesAgree('Veronica Pace', 'Matteo Lorenzo Neretti')).toBe(false)
  })

  /**
   * A surname component match must not become a substring free-for-all.
   *
   * **Constructed, not measured.** Checked 2026-09-09: no matter in the
   * practice has one surname as a non-component substring of the other, so
   * nothing real distinguishes the two rules yet. The rule is still right — a
   * substring match would agree "Ann" with "Annette", because
   * `'annette'.includes('ann')` is true — and that is the pair that proves it.
   *
   * `Ann` vs `Anderson` cannot fail either way: Anderson contains "and", not
   * "ann". A test that passes under a rule and its opposite guards nothing.
   */
  it('does not treat a substring surname as a component', () => {
    expect(namesAgree('Mary Ann', 'Mary Annette')).toBe(false)
    expect(namesAgree('Mary Ann', 'Mary Anderson')).toBe(false)
  })

  it('cannot agree with nothing', () => {
    expect(namesAgree('Can Cheng', null)).toBe(false)
    expect(namesAgree(null, 'Jie Cheng')).toBe(false)
    expect(namesAgree('Cher', 'Cher')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npm run test --workspace apps/workbench -- tests/name-agreement.test.ts
```

Expected: FAIL — `Cannot find package '@/lib/identity/names'` (vitest 4 words it "package", not "module").

- [ ] **Step 3: Write the implementation**

Create `apps/workbench/lib/identity/names.ts`:

```ts
/**
 * Comparing the name a matter is filed under with the name its design sheet
 * drafts for.
 *
 * Every rule here exists because the simpler rule flagged a real person
 * wrongly, measured across all 39 matters that had both on 2026-09-09. The
 * cases are in tests/name-agreement.test.ts by the name that falsified them.
 *
 * Deliberately no database and no Supabase types: this is a string question,
 * and keeping it pure is what lets the awkward cases be tested by name rather
 * than by fixture.
 */

/** Suffixes that say nothing about who someone is. */
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'md', 'esq', 'phd'])

/**
 * The person a matter is named for.
 *
 * Matter names are `<person> — <what the matter is>`: "Can Cheng — Estate
 * Planning". Most carry no separator at all, and those are already just a name.
 * Em dash, en dash and hyphen all appear in the data.
 */
export function personPartOf(matterName: string | null | undefined): string | null {
  if (!matterName) return null
  const [first] = matterName.replace(/[—–]/g, '-').split('-')
  const trimmed = first.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * A name as comparable tokens: lowercased, punctuation dropped, suffixes
 * removed. Hyphens survive, because a hyphenated surname is one surname.
 */
export function normaliseName(name: string | null | undefined): string[] {
  if (!name) return []
  return name
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !SUFFIXES.has(token))
}

/** Whether one surname is a hyphen-delimited component of the other. */
function surnamesAgree(a: string, b: string): boolean {
  if (a === b) return true
  // Only a whole component counts, never a substring. "Ann" would agree with
  // "Annette" under a substring rule, and they are different surnames.
  //
  // No matter in the practice distinguishes the two rules today — checked
  // 2026-09-09 — so unlike every other rule in this file, this one is
  // prophylactic rather than measured, and its test says so.
  return a.split('-').includes(b) || b.split('-').includes(a)
}

/**
 * Whether two names plausibly name one person.
 *
 * First token and surname, and nothing in between — a middle name or initial
 * appears on one record and not the other constantly, and is never the
 * discrepancy worth an attorney's time.
 */
export function namesAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normaliseName(a)
  const right = normaliseName(b)
  if (left.length === 0 || right.length === 0) return false
  if (left[0] !== right[0]) return false
  return surnamesAgree(left[left.length - 1], right[right.length - 1])
}
```

- [ ] **Step 4: Run the tests, typecheck, commit**

```bash
npm run test --workspace apps/workbench -- tests/name-agreement.test.ts
npm run typecheck --workspace apps/workbench && npm run typecheck
git add apps/workbench/lib/identity/names.ts apps/workbench/tests/name-agreement.test.ts
git commit -m "Comparing the name a matter is filed under with the name it drafts for

Four rules, each because the simpler one flagged a real person wrongly across
all 39 matters that had both a name and a client_name: first token and surname
rather than the whole string (Richard G. Goss), suffixes dropped (Frank J.
Lombardi Jr.), a hyphen-delimited surname component accepted (Alexandra
Purdue-Smithe), and a component rather than a substring, since Ann and
Anderson are two surnames.

Pure on purpose -- no database, no Supabase types -- so every awkward case can
be a test named after the person who falsified the simpler rule.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Deriving the issue

**Files:**
- Create: `apps/workbench/lib/identity/matrix.ts`
- Modify: `apps/workbench/tests/name-agreement.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/workbench/tests/name-agreement.test.ts`:

```ts
import { nameIssueFor } from '@/lib/identity/matrix'

const sheet = (overrides: Partial<{ clientName: string | null; spouseName: string | null }> = {}) => ({
  clientName: 'Jie Cheng',
  spouseName: null,
  ...overrides,
})

describe('nameIssueFor', () => {
  it('is null when the matter name agrees with the client', () => {
    expect(nameIssueFor({ id: 'm1', name: 'Jie Cheng — Estate Planning' }, sheet())).toBeNull()
  })

  /** Measured: a couples matter named for the spouse. `Siobhan Creedon` is the
   *  `spouse_name` on a sheet whose client is `Kevin McGurgan`. */
  it('is null when the matter name agrees with the spouse', () => {
    expect(
      nameIssueFor(
        { id: 'm1', name: 'Siobhan Creedon — Estate Planning' },
        sheet({ clientName: 'Kevin McGurgan', spouseName: 'Siobhan Creedon' }),
      ),
    ).toBeNull()
  })

  /** The measured discrepancy: filed as Can Cheng, drafts for Jie Cheng. */
  it('reports the disagreement, carrying both names', () => {
    const issue = nameIssueFor({ id: 'm1', name: 'Can Cheng — Estate Planning' }, sheet())
    expect(issue).toEqual({
      matterId: 'm1',
      kind: 'name_disagreement',
      matterPerson: 'Can Cheng',
      sheetClientName: 'Jie Cheng',
      sheetSpouseName: null,
    })
  })

  /**
   * Nothing to compare is not a disagreement. A matter with no usable name, or
   * a sheet with no client name, says nothing either way — and reporting it
   * would put a task on every half-filled sheet in the practice.
   */
  it('is null when either side has nothing to compare', () => {
    expect(nameIssueFor({ id: 'm1', name: null }, sheet())).toBeNull()
    expect(nameIssueFor({ id: 'm1', name: 'Can Cheng' }, sheet({ clientName: null }))).toBeNull()
    expect(nameIssueFor({ id: 'm1', name: 'Can Cheng' }, sheet({ clientName: '   ' }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — `Cannot find package '@/lib/identity/matrix'`.

- [ ] **Step 3: Write the implementation**

Create `apps/workbench/lib/identity/matrix.ts`:

```ts
import { namesAgree, personPartOf } from './names'

/**
 * One matter's name disagreeing with the sheet it drafts from.
 *
 * Found 2026-09-09: a matter filed as "Can Cheng — Estate Planning" whose
 * sheet drafts for "Jie Cheng", with the sheet's own `concerns` field calling
 * it an unresolved identity discrepancy. A document generated from
 * `client_name` would carry the wrong name, and nothing noticed. The
 * design-sheet audit cannot notice: "these two names may be one person" is not
 * one of check 2's outcomes, and two runs answered it two different ways.
 *
 * One kind, one severity. Unlike `lib/fiduciary/matrix.ts`, which grades
 * `error`/`gap`/`note` and drops `note` before it becomes a task, every issue
 * here is worth the same attention — the owner's ruling, 2026-09-09 — so there
 * is no severity field and no map with a single key.
 */
export interface IdentityIssue {
  matterId: string
  kind: 'name_disagreement'
  /** The person the matter is filed under. */
  matterPerson: string
  sheetClientName: string
  sheetSpouseName: string | null
}

export interface NameCandidateMatter {
  id: string
  name: string | null
}

export interface NameCandidateSheet {
  clientName: string | null
  spouseName: string | null
}

/**
 * The issue for one matter, or null.
 *
 * Agreeing with *either* the client or the spouse is agreement: a couples
 * matter named for one spouse is ordinary, and the measurement found one.
 *
 * Nothing to compare returns null rather than an issue. A matter with no
 * usable name, or a sheet with no client name, says nothing either way, and
 * reporting it would put a task on every half-filled sheet in the practice —
 * twelve of nineteen `client_review` sheets have an empty `concerns` field
 * alone, so incompleteness is normal here and is not this checker's subject.
 */
export function nameIssueFor(
  matter: NameCandidateMatter,
  sheet: NameCandidateSheet,
): IdentityIssue | null {
  const matterPerson = personPartOf(matter.name)
  const clientName = sheet.clientName?.trim() ?? ''
  if (!matterPerson || clientName.length === 0) return null

  if (namesAgree(matterPerson, clientName)) return null
  if (namesAgree(matterPerson, sheet.spouseName)) return null

  return {
    matterId: matter.id,
    kind: 'name_disagreement',
    matterPerson,
    sheetClientName: clientName,
    sheetSpouseName: sheet.spouseName?.trim() || null,
  }
}
```

- [ ] **Step 4: Run, typecheck, commit**

```bash
npm run test --workspace apps/workbench -- tests/name-agreement.test.ts
npm run typecheck --workspace apps/workbench && npm run typecheck
git add apps/workbench/lib/identity/matrix.ts apps/workbench/tests/name-agreement.test.ts
git commit -m "One matter's name disagreeing with the sheet it drafts from

Agreeing with either the client or the spouse is agreement, because a couples
matter named for one spouse is ordinary and the measurement found one.

Nothing to compare returns null rather than an issue: a matter with no usable
name, or a sheet with no client name, says nothing either way, and reporting it
would put a task on every half-filled sheet -- incompleteness is normal on
these sheets and is not this checker's subject.

One kind and one severity, so unlike the fiduciary matrix there is no grade to
map and no lookup with a single key.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The task, and what withdraws it

**Files:**
- Create: `apps/workbench/lib/identity/tasks.ts`
- Modify: `apps/workbench/tests/name-agreement.test.ts`

- [ ] **Step 1: Write the failing tests**

Append:

```ts
import {
  IDENTITY_TASK_SOURCE,
  identityTaskRowFor,
  planIdentityEmit,
  type ExistingIdentityTask,
  type IdentityTaskRow,
} from '@/lib/identity/tasks'

const ISSUE = {
  matterId: 'm1',
  kind: 'name_disagreement' as const,
  matterPerson: 'Can Cheng',
  sheetClientName: 'Jie Cheng',
  sheetSpouseName: null,
}

const existing = (overrides: Partial<ExistingIdentityTask> = {}): ExistingIdentityTask => ({
  id: 'task-1',
  source: IDENTITY_TASK_SOURCE,
  batchTag: 'identity:m1#name',
  status: 'open',
  assigneeId: null,
  title: identityTaskRowFor(ISSUE).title,
  priority: 'high',
  ...overrides,
})

describe('identityTaskRowFor', () => {
  it('names both names in the title, because the point is the comparison', () => {
    const row = identityTaskRowFor(ISSUE)
    expect(row.title).toContain('Can Cheng')
    expect(row.title).toContain('Jie Cheng')
    expect(row.priority).toBe('high')
    expect(row.source).toBe(IDENTITY_TASK_SOURCE)
    expect(row.task_type).toBe('single')
    expect(row.auto).toBe(true)
  })

  /**
   * The tag carries the matter and the kind, never a name and never a run id.
   * A run-keyed tag is what made the prompt path churn every task on every run
   * and discard attorneys' ticks until #433 and #434; a name in the tag would
   * put privileged content in a column read for grouping.
   */
  it('tags by matter and kind, so a re-sweep matches itself', () => {
    expect(identityTaskRowFor(ISSUE).batch_tag).toBe('identity:m1#name')
    expect(identityTaskRowFor(ISSUE).batch_tag).not.toContain('Cheng')
  })
})

describe('planIdentityEmit', () => {
  it('inserts when the matter has no task yet', () => {
    const plan = planIdentityEmit('m1', [], [identityTaskRowFor(ISSUE)])
    expect(plan.insert).toHaveLength(1)
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual([])
  })

  /** Idempotent, which is the whole reason the tag is stable. */
  it('keeps an unchanged task, touching nothing', () => {
    const plan = planIdentityEmit('m1', [existing()], [identityTaskRowFor(ISSUE)])
    expect(plan).toEqual({ insert: [], keep: ['task-1'], supersede: [] })
  })

  /** The names changed, so the wording did: replace it. */
  it('replaces a task whose title no longer matches', () => {
    const plan = planIdentityEmit('m1', [existing({ title: 'Something older' })], [identityTaskRowFor(ISSUE)])
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['task-1'])
    expect(plan.insert).toHaveLength(1)
  })

  /** Resolved: the names now agree, so no row is desired and the task retires. */
  it('withdraws the task when the disagreement is gone', () => {
    const plan = planIdentityEmit('m1', [existing()], [])
    expect(plan.supersede).toEqual(['task-1'])
    expect(plan.insert).toEqual([])
  })

  /**
   * The three narrowings the fiduciary path already learned, and for the same
   * reasons: a tool may withdraw its own suggestion, never a person's work.
   */
  it('never touches a task someone made, holds, or has picked up', () => {
    const manual = existing({ id: 'manual', source: 'manual' })
    const done = existing({ id: 'done', status: 'done' })
    const mine = existing({ id: 'mine', assigneeId: 'user-1' })
    const plan = planIdentityEmit('m1', [manual, done, mine], [])
    expect(plan.supersede).toEqual([])
  })

  /** Another matter's tag is not this sweep's to retire. */
  it('never touches another matter’s task', () => {
    const other = existing({ id: 'other', batchTag: 'identity:m2#name' })
    expect(planIdentityEmit('m1', [other], []).supersede).toEqual([])
  })

  /** A tag this module did not write is nobody's to retire. */
  it('never touches a tag it cannot recognise', () => {
    const foreign = existing({ id: 'foreign', batchTag: 'something-else' })
    expect(planIdentityEmit('m1', [foreign], []).supersede).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — `Cannot find package '@/lib/identity/tasks'`.

- [ ] **Step 3: Write the implementation**

Create `apps/workbench/lib/identity/tasks.ts`:

```ts
import type { IdentityIssue } from './matrix'

/** `tasks.source` for this checker, added by the identity-source migration. */
export const IDENTITY_TASK_SOURCE = 'identity'

export interface IdentityTaskRow {
  matter_id: string
  source: string
  task_type: string
  auto: boolean
  batch_tag: string
  title: string
  priority: string
}

export interface ExistingIdentityTask {
  id: string
  source: string
  batchTag: string | null
  status: string
  assigneeId: string | null
  title: string
  priority: string
}

export interface IdentityEmitPlan {
  insert: IdentityTaskRow[]
  keep: string[]
  supersede: string[]
}

function tagPrefix(matterId: string): string {
  return `${IDENTITY_TASK_SOURCE}:${matterId}`
}

/**
 * The task one issue becomes.
 *
 * The tag is the matter and the kind — never a run id, and never a name. A
 * run-keyed tag is what made the prompt path archive and re-insert every task
 * on every run, discarding attorneys' checklist ticks until #433 and #434; the
 * fiduciary path builds its tag from the matter on purpose and its sweep is
 * idempotent because of it. And a name in a `batch_tag` would put privileged
 * content in a column read for grouping and filtering.
 *
 * The title carries both names, because the comparison *is* the finding — an
 * attorney reading "the matter name disagrees with the sheet" and having to
 * open two records to learn how has been told almost nothing.
 */
export function identityTaskRowFor(issue: IdentityIssue): IdentityTaskRow {
  return {
    matter_id: issue.matterId,
    source: IDENTITY_TASK_SOURCE,
    task_type: 'single',
    auto: true,
    batch_tag: `${tagPrefix(issue.matterId)}#name`,
    title: `Matter is filed as “${issue.matterPerson}” but the design sheet drafts for “${issue.sheetClientName}”`,
    priority: 'high',
  }
}

/**
 * What this sweep should create, keep and withdraw for one matter.
 *
 * Narrow on the same axes the fiduciary sweep is, for the same reasons: a tool
 * may withdraw its own suggestion, and must never touch a task a person
 * created, completed, or picked up.
 */
export function planIdentityEmit(
  matterId: string,
  existing: ExistingIdentityTask[],
  desired: IdentityTaskRow[],
): IdentityEmitPlan {
  const prefix = `${tagPrefix(matterId)}#`

  const candidates = existing.filter(
    (task) =>
      task.source === IDENTITY_TASK_SOURCE &&
      task.status === 'open' &&
      task.assigneeId === null &&
      // This matter's own tags only. The `#` terminator makes the matter
      // segment an exact match rather than a prefix one, so `m1` never claims
      // a task belonging to `m10`.
      task.batchTag !== null &&
      task.batchTag.startsWith(prefix),
  )

  const byTag = new Map<string, ExistingIdentityTask>()
  for (const task of candidates) {
    if (task.batchTag !== null) byTag.set(task.batchTag, task)
  }

  const keep: string[] = []
  const insert: IdentityTaskRow[] = []
  const matched = new Set<string>()

  for (const row of desired) {
    const twin = byTag.get(row.batch_tag)
    // Same tag and same wording: unchanged, so the row keeps its id and its
    // `created_at`. Same tag, different wording: the names moved, so replace.
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

- [ ] **Step 4: Run, typecheck, commit**

```bash
npm run test --workspace apps/workbench -- tests/name-agreement.test.ts
npm run typecheck --workspace apps/workbench && npm run typecheck
git add apps/workbench/lib/identity/tasks.ts apps/workbench/tests/name-agreement.test.ts
git commit -m "A name disagreement becomes one high task per matter

Tagged by matter and kind, never by a run id and never by a name. A run-keyed
tag is what made the prompt path archive and re-insert every task on every run,
discarding attorneys' ticks until #433 and #434, and a name in a batch_tag
would put privileged content in a column read for grouping.

The title carries both names, because the comparison is the finding: an
attorney told only that two records disagree, and left to open both to learn
how, has been told almost nothing.

Narrow on the fiduciary sweep's axes for the fiduciary sweep's reasons -- a tool
withdraws its own suggestion and never a person's work -- and idempotent, which
is what the stable tag buys.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The sweep

**Files:**
- Create: `apps/workbench/lib/identity/sweep.ts`
- Modify: `apps/workbench/tests/name-agreement.test.ts`

- [ ] **Step 1: Write the failing test**

Append. The fake client is the shared helper the fiduciary and trigger tests use.

```ts
import { sweepNameAgreement } from '@/lib/identity/sweep'
import { makeFakeClient } from './helpers/fakeSupabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'

describe('sweepNameAgreement', () => {
  /**
   * `makeFakeClient` returns the client itself — not `{ client, … }`, which is
   * the shape of the *local* helper in `tests/field-audit-tasks.test.ts`. It
   * carries `tableRows` and `failTable` on the same object, and an `insert`
   * lands in the table's own rows, so `tableRows('tasks')` sees what was
   * written.
   */
  function client(rows: {
    matters?: Array<Record<string, unknown>>
    design_sheets?: Array<Record<string, unknown>>
    tasks?: Array<Record<string, unknown>>
  }) {
    return makeFakeClient({
      matters: rows.matters ?? [],
      design_sheets: rows.design_sheets ?? [],
      tasks: rows.tasks ?? [],
    })
  }

  it('creates one task for a disagreement and none for agreement', async () => {
    const fake = client({
      matters: [
        { id: 'm1', name: 'Can Cheng — Estate Planning', relationship_status: 'hired' },
        { id: 'm2', name: 'Jie Cheng — Estate Planning', relationship_status: 'hired' },
      ],
      design_sheets: [
        { matter_id: 'm1', version: 1, client_name: 'Jie Cheng', spouse_name: null },
        { matter_id: 'm2', version: 1, client_name: 'Jie Cheng', spouse_name: null },
      ],
    })

    const result = await sweepNameAgreement(fake as unknown as SupabaseClient<WorkbenchDatabase>)

    expect(result.created).toBe(1)
    expect(result.mattersConsidered).toBe(2)
    const inserted = (fake.tableRows('tasks') as Array<Record<string, unknown>>)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].matter_id).toBe('m1')
    expect(inserted[0].priority).toBe('high')
  })

  /**
   * The failure that matters. `loadNameCandidates` throws on a query error
   * rather than returning what it managed to read, because an empty candidate
   * list from a failed query is indistinguishable from "every name agrees" —
   * and this sweep withdraws tasks when nothing is desired. Absorbing the
   * error would retire every identity task in the practice on one bad query.
   */
  it('throws rather than reporting an all-clear when a query fails', async () => {
    const fake = client({
      matters: [{ id: 'm1', name: 'Can Cheng — Estate Planning', relationship_status: 'hired' }],
      design_sheets: [{ matter_id: 'm1', version: 1, client_name: 'Jie Cheng', spouse_name: null }],
    })
    fake.failTable('design_sheets', 'connection reset by peer')

    await expect(
      sweepNameAgreement(fake as unknown as SupabaseClient<WorkbenchDatabase>),
    ).rejects.toThrow(/design sheet/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — `Cannot find package '@/lib/identity/sweep'`.

- [ ] **Step 3: Write the implementation**

Create `apps/workbench/lib/identity/sweep.ts`. `MATTER_SELECT` and `SHEET_SELECT` are same-file string constants so `tests/query-columns.test.ts` and `scripts/checkDbColumns.mjs` can see them — the same reason `lib/prompts/designSheet.ts` does it.

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { nameIssueFor, type IdentityIssue } from './matrix'
import {
  IDENTITY_TASK_SOURCE,
  identityTaskRowFor,
  planIdentityEmit,
  type ExistingIdentityTask,
} from './tasks'

const MATTER_SELECT = 'id, name'
const SHEET_SELECT = 'matter_id, version, client_name, spouse_name'

export interface IdentitySweepResult {
  mattersConsidered: number
  created: number
  kept: number
  superseded: number
}

interface Candidate {
  matter: { id: string; name: string | null }
  sheet: { clientName: string | null; spouseName: string | null }
}

/**
 * Every hired matter that has a design sheet, with the sheet's names.
 *
 * Throws on a query error rather than returning what it managed to read. An
 * empty list from a failed query looks exactly like "every name agrees", and
 * this sweep withdraws tasks when nothing is desired — so absorbing the error
 * would retire every identity task in the practice on one bad query. That is
 * the same conflation that once let an uncitable finding retire a cited one.
 *
 * `hired` only. A name disagreement on a lead is not yet drafting anything.
 */
export async function loadNameCandidates(
  client: SupabaseClient<WorkbenchDatabase>,
): Promise<Candidate[]> {
  const sb = client

  const { data: matters, error: matterError } = await sb
    .from('matters')
    .select(MATTER_SELECT)
    .eq('relationship_status', 'hired')
  if (matterError) throw new Error(`Could not load matters for the name check: ${matterError.message}`)

  const { data: sheets, error: sheetError } = await sb
    .from('design_sheets')
    .select(SHEET_SELECT)
  if (sheetError) throw new Error(`Could not load the design sheets for the name check: ${sheetError.message}`)

  // The highest version on file is the current sheet — the ordering
  // `loadSourceRows` and `loadGateContext` already use.
  const latestByMatter = new Map<string, Record<string, unknown>>()
  for (const row of (sheets ?? []) as Array<Record<string, unknown>>) {
    const matterId = String(row.matter_id)
    const current = latestByMatter.get(matterId)
    const version = Number(row.version ?? 0)
    if (!current || version >= Number(current.version ?? 0)) latestByMatter.set(matterId, row)
  }

  const candidates: Candidate[] = []
  for (const matter of (matters ?? []) as Array<Record<string, unknown>>) {
    const sheet = latestByMatter.get(String(matter.id))
    if (!sheet) continue
    candidates.push({
      matter: { id: String(matter.id), name: (matter.name as string | null) ?? null },
      sheet: {
        clientName: (sheet.client_name as string | null) ?? null,
        spouseName: (sheet.spouse_name as string | null) ?? null,
      },
    })
  }
  return candidates
}

/**
 * Makes every hired matter's identity task say what its records say.
 *
 * Unqueued and run on every tick, the same trade `sweepFiduciaryTasks`
 * documents: the machinery to schedule and claim one sweep would cost more than
 * the sweep does, and it is a handful of string comparisons over a few dozen
 * rows.
 */
export async function sweepNameAgreement(
  client: SupabaseClient<WorkbenchDatabase>,
): Promise<IdentitySweepResult> {
  const sb = client
  const candidates = await loadNameCandidates(sb)

  const result: IdentitySweepResult = {
    mattersConsidered: candidates.length,
    created: 0,
    kept: 0,
    superseded: 0,
  }

  for (const candidate of candidates) {
    const issue: IdentityIssue | null = nameIssueFor(candidate.matter, candidate.sheet)
    const desired = issue ? [identityTaskRowFor(issue)] : []

    const { data: taskRows, error: taskError } = await sb
      .from('tasks')
      .select('id, source, batch_tag, status, assignee_id, title, priority')
      .eq('matter_id', candidate.matter.id)
      .eq('source', IDENTITY_TASK_SOURCE)
    if (taskError) {
      throw new Error(`Could not load identity tasks for ${candidate.matter.id}: ${taskError.message}`)
    }

    const existing: ExistingIdentityTask[] = ((taskRows ?? []) as Array<Record<string, unknown>>).map(
      (row) => ({
        id: String(row.id),
        source: String(row.source),
        batchTag: (row.batch_tag as string | null) ?? null,
        status: String(row.status),
        assigneeId: (row.assignee_id as string | null) ?? null,
        title: String(row.title ?? ''),
        priority: String(row.priority ?? ''),
      }),
    )

    const plan = planIdentityEmit(candidate.matter.id, existing, desired)

    if (plan.insert.length > 0) {
      const { error } = await sb.from('tasks').insert(plan.insert)
      if (error) throw new Error(`Could not create the identity task for ${candidate.matter.id}: ${error.message}`)
    }
    if (plan.supersede.length > 0) {
      const { error } = await sb
        .from('tasks')
        .update({
          status: 'archived',
          skipped_at: new Date().toISOString(),
          closeout_reason: 'identity_resolved',
        })
        .in('id', plan.supersede)
      if (error) throw new Error(`Could not withdraw identity tasks for ${candidate.matter.id}: ${error.message}`)
    }

    result.created += plan.insert.length
    result.kept += plan.keep.length
    result.superseded += plan.supersede.length
  }

  return result
}
```

- [ ] **Step 4: Prove the failure path bites**

Remove the `if (sheetError) throw` line, run the tests, and confirm `throws rather than reporting an all-clear when a query fails` goes red. Restore it.

- [ ] **Step 5: Run, typecheck, commit**

```bash
npm run test --workspace apps/workbench -- tests/name-agreement.test.ts
npm run test --workspace apps/workbench
npm run typecheck --workspace apps/workbench && npm run typecheck
git add apps/workbench/lib/identity/sweep.ts apps/workbench/tests/name-agreement.test.ts
git commit -m "Sweep every hired matter's name against its sheet

Throws on a query error rather than returning what it read. An empty candidate
list from a failed query looks exactly like every name agreeing, and this sweep
withdraws tasks when nothing is desired -- so absorbing the error would retire
every identity task in the practice on one bad query. That conflation is what
once let an uncitable finding retire a cited one.

Hired matters only: a name disagreement on a lead is not drafting anything yet.
Unqueued on every tick, the same trade sweepFiduciaryTasks documents.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The source, the closeout reason, and the chip *(migration step is controller-only)*

**Files:**
- Create: `supabase/migrations/20261117000000_identity_task_source.sql`
- Modify: `lib/tasks/types.ts` (root app)

- [ ] **Step 1: Write the migration**

```sql
-- A fourth automatic task source: the name check.
--
-- `tasks_source_check` enumerates its values, so a new source is rejected by
-- the database until it is named here. Same shape as
-- 20261105000000_fiduciary_task_source.sql, which added 'fiduciary', and
-- 20261029000000, which added 'prompt'.
--
-- Superseding needs its own closeout reason for the same reason 'fiduciary'
-- did: 'prompt_superseded' says a prompt run withdrew the finding, and no
-- prompt run ever created an identity task. Reusing it would put a claim in the
-- record that is untrue, and `closeout_reason` is read by the reopen and
-- conversion paths as well as by a person asking why a task closed.
-- 'identity_resolved' says what actually happened: the two names now agree.

alter table public.tasks
  drop constraint if exists tasks_source_check;

alter table public.tasks
  add constraint tasks_source_check
  check (source in ('manual', 'stage', 'template', 'cadence', 'sla', 'prompt', 'fiduciary', 'identity'));

alter table public.tasks
  drop constraint if exists tasks_closeout_reason_check;

alter table public.tasks
  add constraint tasks_closeout_reason_check
  check (closeout_reason is null or closeout_reason in (
    'matter_closed',
    'lead_lost',
    'lead_declined',
    'not_engaged',
    'prompt_superseded',
    'fiduciary_superseded',
    'identity_resolved'
  ));

comment on column public.tasks.source is
  'What created this task: a person (manual), the stage engine (stage), a '
  'template or cadence, the SLA plan (sla), a prompt run (prompt), the '
  'fiduciary matrix (fiduciary), or the matter-name check (identity).';

comment on column public.tasks.closeout_reason is
  'Set when a task was archived automatically: its matter closed, its lead '
  'went lost/declined, it is post-engagement work on a lead that has not '
  'converted (not_engaged), a newer prompt run superseded the finding that '
  'created it (prompt_superseded), the fiduciary sweep found the gap it '
  'reported was filled (fiduciary_superseded), or the name check found the '
  'two names now agree (identity_resolved).';

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Teach the display app the source — this is not optional**

`lib/tasks/types.ts` in the **root** app. It is the only thing that renders tasks, and a source it does not know renders as an **empty, unstyled chip**. That shipped once: `'prompt'` was a legal source for weeks and every audit task rendered blank.

```ts
export const TASK_SOURCES = ['manual', 'stage', 'template', 'cadence', 'sla', 'prompt', 'fiduciary', 'identity'] as const
```

Add to the label map beside `fiduciary: 'Fiduciary'`:

```ts
  identity: 'Identity',
```

And to the pill map beside `fiduciary: 'bg-red-bg text-red'`. Pick a token that is not already used by another source and that meets contrast against its background — the existing entries record their measured ratios, so measure the new one the same way rather than guessing.

- [ ] **Step 3: Apply the migration *(controller-only — not for a subagent)*

The session owner applies this; no subagent gets the connection string, and nothing here may print it. Use `supabase db push --db-url "$DB_URL"` (dry-run first) — **not `psql`**, which applies the SQL and records nothing in `supabase_migrations.schema_migrations`, failing the migration-history check on a migration that genuinely ran. `--db-url` needs the string percent-encoded.

Then verify **from the catalog**, never from `schema_migrations`, which has carried phantom rows here:

```sql
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.tasks'::regclass
   and conname in ('tasks_source_check', 'tasks_closeout_reason_check');
```

Expected: both definitions contain `'identity'` and `'identity_resolved'` respectively.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261117000000_identity_task_source.sql lib/tasks/types.ts
git commit -m "A fourth automatic task source, and a chip that renders

tasks_source_check enumerates its values, so the database rejects a new source
until it is named. Its own closeout reason too: prompt_superseded says a prompt
run withdrew the finding, and no prompt run ever created an identity task.

TASK_SOURCES in the root app learns it in the same commit. That app is the only
thing that renders tasks, and a source it does not know renders as an empty
unstyled chip -- which shipped once, when 'prompt' was legal for weeks and every
audit task rendered blank.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Run it from the tick, and measure

**Files:**
- Modify: `apps/workbench/app/api/cron/tick/route.ts`

- [ ] **Step 1: Call the sweep beside the fiduciary one**

Mirror the existing block exactly — including its `try/catch` into a union, so a sweep failure reports itself in the response instead of taking the whole tick down and stranding whatever it was about to claim. That failure mode cost five matters an audit today.

```ts
import { type IdentitySweepResult, sweepNameAgreement } from '@/lib/identity/sweep'
```

```ts
  let identity: IdentitySweepResult | { error: string }
  try {
    identity = await sweepNameAgreement(admin)
  } catch (error) {
    identity = { error: error instanceof Error ? error.message : String(error) }
  }
```

Add `identity` to every `NextResponse.json({ … })` in the route that already carries `fiduciary`.

- [ ] **Step 2: Run the whole suite and both typechecks**

```bash
npm run test --workspace apps/workbench
npm run typecheck --workspace apps/workbench && npm run typecheck
npm run lint --workspace apps/workbench
npm test
```

If the root suite reports `Failed to start forks worker` or runs implausibly long, check `uptime` — this machine has hit load average 246, and that failure is the machine rather than the code.

- [ ] **Step 3: Measure against the real database, before trusting the spec's number**

The spec's **3 of 39** was measured *without* the `hired` filter this sweep applies. Re-measure with it, because the number decides whether this is signal or noise:

```sql
select count(*) as considered
  from public.matters m
  join public.design_sheets d on d.matter_id = m.id
 where m.relationship_status = 'hired'
   and coalesce(btrim(d.client_name), '') <> ''
   and m.name is not null;
```

Then, after one tick has run, read what it created:

```sql
select left(matter_id::text, 8), priority, title
  from public.tasks
 where source = 'identity' and closeout_reason is null
 order by created_at;
```

**Report the count and every title.** If it is far above three, the rule is wrong for this data and the right response is to narrow it and re-measure — not to ship it and let the queue fill. If it is zero, check the `hired` filter before concluding the check does nothing.

- [ ] **Step 4: Prove the sweep is idempotent against the real database**

Note each task's `id` and `created_at`, wait for a second tick, and read them again. They must be **identical** — same ids, `created_at` untouched, nothing archived. That is what the stable tag buys, and it is the property the prompt path lacked for a day while it discarded attorneys' ticks.

- [ ] **Step 5: Commit and push**

```bash
git add apps/workbench/app/api/cron/tick/route.ts
git commit -m "The tick sweeps names beside fiduciary gaps

Wrapped in the same try/catch into a union that the fiduciary sweep uses: a
sweep that throws reports itself in the response instead of taking the tick
down and stranding whatever it was about to claim. That exact failure cost five
matters an audit today.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin claude/name-agreement
```

---

## Verification against the spec

| Spec requirement | Task |
| --- | --- |
| first+last comparison, middle names ignored | 1 |
| suffixes stripped (`Frank J. Lombardi Jr.`) | 1 |
| hyphenated surname component (`Purdue-Smithe`) | 1 |
| component, not substring (`Ann` ≠ `Annette`, constructed) | 1 |
| person part of the matter name | 1 |
| client **or** spouse counts (`Siobhan Creedon`) | 2 |
| nothing to compare is not a disagreement | 2 |
| one kind, one severity, no ladder | 2 |
| `high` priority (owner's ruling) | 3 |
| stable tag, keyed to matter not run | 3 |
| no name in the tag | 3 |
| withdraws only its own open unassigned tasks | 3 |
| a failed load never reads as an all-clear | 4 |
| `hired` matters only | 4 |
| latest sheet version wins | 4 |
| `'identity'` source + `'identity_resolved'` closeout | 5 |
| root app renders the chip | 5 |
| runs from the tick, failure reported not fatal | 6 |
| re-measured with the `hired` filter | 6 |
| idempotent against the real database | 6 |
