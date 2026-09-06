# Withdrawal Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A prompt run may withdraw an earlier task only where it actually answered — so a finding that fails the verification gate can no longer retire a standing blocker.

**Architecture:** Three per-check states (`cleared`, `actionable`, `inconclusive`) are defined once in `packages/citations` beside the gate they share a definition with. `planEmit` receives the run's answers and consults them before retiring anything; `emitTasks` computes them from *all* the findings plus the run's step statuses, which is why it must stop receiving only the gated ones. See `docs/superpowers/specs/2026-09-06-withdrawal-scoping-design.md`.

**Tech Stack:** TypeScript, zod, vitest, Next.js 16 App Router, Supabase Postgres.

---

## Read this first

**Worktree.** Every command runs from
`/Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.claude/worktrees/workbench-app-improvements-e03851`.
Never `cd` to the repository root — different checkout. Never `git stash` — the stash stack
is shared with other worktrees; use a temporary commit instead. Branch is
`claude/withdrawal-scoping`.

**Running tests.** Root and workbench are separate vitest *and* typecheck projects:

| What | Command |
| --- | --- |
| One workbench file | `cd apps/workbench && npx vitest run tests/<name>.test.ts` |
| Whole workbench suite | `cd apps/workbench && npx vitest run` |
| Workbench typecheck | `cd apps/workbench && npm run typecheck` |
| Root suite | `npx vitest run` |
| Root typecheck | `npm run typecheck` — **excludes `apps/`** |

`npx vitest run apps/workbench/tests/x.test.ts` from the repo root **matches no files and
exits 0**. Always read the reported file and test counts. `packages/citations` has **no test
runner of its own** — its tests live in `apps/workbench/tests/`.

Baselines on this branch: root 459 files / 4870 passing / 1 skipped; workbench 83 files /
1025 passing; both typechecks clean.

**Client data is privileged.** Print counts, check numbers, field keys and paths. Never paste
a client's field values into the conversation or a commit message.

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/citations/src/fieldAudit/runFieldAudit.ts` | Modify: `isActionable` extracted, plus `CheckAnswer`, `answerForFinding`, `runAnswers`. |
| `apps/workbench/tests/field-audit-answers.test.ts` | Create: the three states and run authority. |
| `apps/workbench/lib/fieldAudit/tasks.ts` | Modify: `parseBatchTag` reinstated (private), `mayRetire`, `planEmit` takes the run's answers, `emitTasks` gates internally. |
| `apps/workbench/tests/field-audit-tasks.test.ts` | Modify: `planEmit` calls gain the answers argument; new retirement suite. |
| `apps/workbench/app/api/cron/tick/route.ts` | Modify: pass all findings plus the failed units; drop its own gate call. |
| `apps/workbench/tests/tick-route.test.ts` | Modify: assert the tick hands over all findings, not the gated subset. |

---

### Task 1: the three states, defined once

`actionableFindings` and the withdrawal rule are the same policy question from two sides. If
each carried its own copy of "what the gate means", a finding could be actionable in one and
inconclusive in the other — so the predicate is extracted and both use it.

**Files:**
- Modify: `packages/citations/src/fieldAudit/runFieldAudit.ts`
- Test: `apps/workbench/tests/field-audit-answers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/workbench/tests/field-audit-answers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { answerForFinding, isActionable, runAnswers } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import type { FieldAuditFinding } from '@aubrey-law/citations/fieldAudit/types'

function finding(over: Partial<FieldAuditFinding> = {}): FieldAuditFinding {
  return {
    checkNumber: '1',
    outcome: 'deviation',
    severity: 'blocker',
    rationale: 'The residuary never answers the stated concern.',
    references: [
      {
        fieldKey: 'concerns',
        claimedValue: 'worried about the stepchildren',
        actualValue: 'worried about the stepchildren',
        matchedPath: null,
        verification: 'verified',
      },
    ],
    ...over,
  }
}

describe('isActionable', () => {
  it('is true for a deviation with a verified reference', () => {
    expect(isActionable(finding())).toBe(true)
  })

  it('is true for an absent with a verified reference', () => {
    expect(isActionable(finding({ outcome: 'absent' }))).toBe(true)
  })

  it('is false when no reference verified', () => {
    expect(isActionable(finding({ references: [] }))).toBe(false)
    expect(
      isActionable(finding({ references: [{ ...finding().references[0], verification: 'unverified' }] })),
    ).toBe(false)
  })

  it('is false for compliant and not_applicable however well referenced', () => {
    expect(isActionable(finding({ outcome: 'compliant' }))).toBe(false)
    expect(isActionable(finding({ outcome: 'not_applicable' }))).toBe(false)
  })
})

describe('answerForFinding', () => {
  /**
   * The distinction the whole slice exists for. Both of these produce no task
   * row, and until now both were read as grounds for withdrawing an earlier
   * one — but `compliant` is evidence of absence and an uncitable deviation is
   * absence of evidence.
   */
  it('separates a cleared check from an uncitable one', () => {
    expect(answerForFinding(finding({ outcome: 'compliant' }), true)).toBe('cleared')
    expect(answerForFinding(finding({ outcome: 'not_applicable' }), true)).toBe('cleared')
    expect(answerForFinding(finding({ references: [] }), true)).toBe('inconclusive')
  })

  it('calls a gated deviation actionable', () => {
    expect(answerForFinding(finding(), true)).toBe('actionable')
  })

  /**
   * A unit whose step failed never answered, so it cannot retire its own
   * task. Measured on the real run this slice comes from: the model reached
   * the same conclusion twice and emitted references only once.
   */
  it('is inconclusive when the unit did not succeed, whatever the finding says', () => {
    expect(answerForFinding(finding({ outcome: 'compliant' }), false)).toBe('inconclusive')
    expect(answerForFinding(finding(), false)).toBe('inconclusive')
  })

  it('is inconclusive when there is no finding at all', () => {
    expect(answerForFinding(undefined, true)).toBe('inconclusive')
  })
})

describe('runAnswers', () => {
  it('answers every check the prompt version declares', () => {
    const answers = runAnswers({
      checkNumbers: ['1', '2', '3'],
      findings: [finding({ checkNumber: '1' }), finding({ checkNumber: '2', outcome: 'compliant' })],
      failedCheckNumbers: [],
    })
    expect(answers.byCheck).toEqual({ '1': 'actionable', '2': 'cleared', '3': 'inconclusive' })
  })

  it('is authoritative only when nothing is inconclusive', () => {
    const complete = runAnswers({
      checkNumbers: ['1', '2'],
      findings: [finding({ checkNumber: '1' }), finding({ checkNumber: '2', outcome: 'not_applicable' })],
      failedCheckNumbers: [],
    })
    expect(complete.authoritative).toBe(true)

    const partial = runAnswers({
      checkNumbers: ['1', '2'],
      findings: [finding({ checkNumber: '1' }), finding({ checkNumber: '2', references: [] })],
      failedCheckNumbers: [],
    })
    expect(partial.authoritative).toBe(false)
  })

  it('is not authoritative when a unit failed', () => {
    const answers = runAnswers({
      checkNumbers: ['1'],
      findings: [finding({ checkNumber: '1' })],
      failedCheckNumbers: ['1'],
    })
    expect(answers.byCheck['1']).toBe('inconclusive')
    expect(answers.authoritative).toBe(false)
  })

  /** A prompt with no checks cannot be a complete answer to anything. */
  it('is not authoritative with no checks', () => {
    expect(runAnswers({ checkNumbers: [], findings: [], failedCheckNumbers: [] }).authoritative).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/workbench && npx vitest run tests/field-audit-answers.test.ts
```

Expected: FAIL — `isActionable`, `answerForFinding` and `runAnswers` are not exported.

- [ ] **Step 3: Implement**

In `packages/citations/src/fieldAudit/runFieldAudit.ts`, replace `actionableFindings` with:

```ts
/**
 * Whether one finding may act.
 *
 * Extracted from `actionableFindings` so the withdrawal rule in
 * `apps/workbench/lib/fieldAudit/tasks.ts` can ask the same question from the
 * other side without carrying its own copy of the answer. Two copies could
 * disagree, and the shape of that disagreement is a finding that is refused as
 * unverifiable *and* counted as grounds for withdrawing an earlier one — which
 * is the defect this slice exists to remove.
 */
export function isActionable(finding: FieldAuditFinding): boolean {
  return (
    (finding.outcome === 'deviation' || finding.outcome === 'absent') &&
    finding.references.some((reference) => reference.verification === 'verified')
  )
}

export function actionableFindings(result: FieldAuditResult): FieldAuditFinding[] {
  return result.findings.filter(isActionable)
}

/**
 * What a run concluded about one check.
 *
 * `cleared` and `inconclusive` both produce no task, which is exactly why they
 * need distinguishing: `cleared` is the run saying it looked and the check is
 * fine, and `inconclusive` is the run seeing a problem it cannot cite, or not
 * answering at all. Only the first is grounds for retiring someone's task.
 */
export type CheckAnswer = 'cleared' | 'actionable' | 'inconclusive'

export function answerForFinding(
  finding: FieldAuditFinding | undefined,
  unitSucceeded: boolean,
): CheckAnswer {
  // A unit that failed did not answer, whatever finding an earlier attempt
  // left behind — so it can retire nothing.
  if (!unitSucceeded) return 'inconclusive'
  if (!finding) return 'inconclusive'
  if (finding.outcome === 'compliant' || finding.outcome === 'not_applicable') return 'cleared'
  return isActionable(finding) ? 'actionable' : 'inconclusive'
}

export interface RunAnswers {
  /** Every check number the run's prompt version declares, mapped to its answer. */
  byCheck: Record<string, CheckAnswer>
  /**
   * Every check came back `cleared` or `actionable`. A complete answer may
   * retire prior work; a partial one may only add to it.
   */
  authoritative: boolean
}

export function runAnswers(input: {
  checkNumbers: string[]
  /** *All* of the run's findings, not `actionableFindings` — the withdrawal
   *  decision needs the outcomes the gate discards. */
  findings: FieldAuditFinding[]
  /** Units whose step did not succeed. */
  failedCheckNumbers: string[]
}): RunAnswers {
  const findingByCheck = new Map(input.findings.map((finding) => [finding.checkNumber, finding]))
  const failed = new Set(input.failedCheckNumbers)

  const byCheck: Record<string, CheckAnswer> = {}
  for (const checkNumber of input.checkNumbers) {
    byCheck[checkNumber] = answerForFinding(findingByCheck.get(checkNumber), !failed.has(checkNumber))
  }

  return {
    byCheck,
    // A prompt with no checks is not a complete answer to anything, and
    // `every` on an empty list would call it one.
    authoritative:
      input.checkNumbers.length > 0 &&
      input.checkNumbers.every((checkNumber) => byCheck[checkNumber] !== 'inconclusive'),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/workbench && npx vitest run tests/field-audit-answers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Confirm the extraction changed no behaviour**

```bash
cd apps/workbench && npx vitest run
```

```bash
npx vitest run && npm run typecheck
```

Expected: PASS, with the workbench count up by the new file's tests and no existing test
changed. `actionableFindings` is now `filter(isActionable)` — if any existing test fails, the
extraction is not faithful; fix the extraction rather than the test.

- [ ] **Step 6: Commit**

```bash
git add packages/citations/src/fieldAudit/runFieldAudit.ts apps/workbench/tests/field-audit-answers.test.ts
git commit -F - <<'MSG'
A run's answer to a check is one of three things, not two

actionableFindings answers "may this finding act". The withdrawal rule needs
"did this run answer at all", and the two must not be able to disagree about
what the gate means -- a finding refused as unverifiable while also counting as
grounds for withdrawing an earlier one is precisely the defect being removed.
So the predicate is extracted and both sides call it.

cleared is compliant or not_applicable: the run looked and says the check is
fine. actionable is a deviation or absent with a verified reference. everything
else is inconclusive -- a problem it cannot cite, a unit whose step failed, or
no finding at all. cleared and inconclusive both produce no task, which is why
they have to be told apart.

A run is authoritative when nothing is inconclusive. A complete answer may
retire prior work; a partial one may only add to it. A prompt with no checks is
not authoritative, since every on an empty list would otherwise call it one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: `planEmit` consults the answers before retiring anything

**Files:**
- Modify: `apps/workbench/lib/fieldAudit/tasks.ts`
- Test: `apps/workbench/tests/field-audit-tasks.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/workbench/tests/field-audit-tasks.test.ts`, add to the imports:

```ts
import { runAnswers, type RunAnswers } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
```

Every existing `planEmit(...)` call gains a third argument. Add this helper just inside the
`describe('planEmit', ...)` block and pass `authoritative()` to each existing call, so the
suite's existing guarantees are asserted against a run that *is* allowed to retire — which is
what they were implicitly assuming:

```ts
  /** A run that answered everything, so retirement is permitted and the
   *  existing guarantees below are unchanged by this slice. */
  function authoritative(): RunAnswers {
    return { byCheck: { '1': 'actionable' }, authoritative: true }
  }

  /** A run that saw a problem on check 1 and could not cite it. */
  function inconclusive(): RunAnswers {
    return { byCheck: { '1': 'inconclusive' }, authoritative: false }
  }
```

Then append a new suite:

```ts
describe('planEmit retirement scoping', () => {
  function checklistTask(over: Partial<ExistingPromptTask> = {}): ExistingPromptTask {
    return existingTask({
      id: 'list',
      batchTag: 'prompt:run-old',
      taskType: 'checklist',
      title: 'MA design sheet audit',
      description: 'One item to confirm.',
      checklist: [{ text: 'A stated concern is not answered by the plan', done: false }],
      ...over,
    })
  }

  function checklistRow(items: string[], over: Partial<TaskRow> = {}): TaskRow {
    return {
      matter_id: 'matter-1',
      source: PROMPT_TASK_SOURCE,
      task_type: 'checklist',
      auto: true,
      batch_tag: 'prompt:run-new',
      title: 'MA design sheet audit',
      description: 'Some items to confirm.',
      priority: 'high',
      checklist: items.map((text) => ({ text, done: false })),
      ...over,
    }
  }

  /**
   * The measured failure, replayed. Run `a2a4f300` produced a blocker with
   * four verified references and one checklist task; run `1c22acb5` reached
   * the same conclusion with zero references, so the gate refused it — and the
   * withdrawal step archived the first task anyway, leaving the matter with no
   * blocker at all. The task must now stand.
   */
  it('does not retire a task when the run could not cite the problem', () => {
    const plan = planEmit([checklistTask()], [], runAnswers({
      checkNumbers: ['1', '2'],
      findings: [],
      failedCheckNumbers: [],
    }))
    expect(plan.insert).toEqual([])
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual([])
  })

  /** The reverse: a run that answered everything and found nothing wrong. */
  it('retires the task when the run cleared every check', () => {
    const answers: RunAnswers = { byCheck: { '1': 'cleared', '2': 'cleared' }, authoritative: true }
    const plan = planEmit([checklistTask()], [], answers)
    expect(plan.supersede).toEqual(['list'])
  })

  /**
   * A run still reporting the same check says everything the old task said —
   * item text is the check's template title, fixed by the prompt version — so
   * the old one goes rather than standing beside the new one. Without this the
   * conservative rule would leave two checklists on the matter.
   */
  it('retires an older checklist whose items the new one repeats, even when inconclusive elsewhere', () => {
    const answers: RunAnswers = { byCheck: { '1': 'actionable', '3': 'inconclusive' }, authoritative: false }
    const plan = planEmit(
      [checklistTask()],
      [checklistRow(['A stated concern is not answered by the plan'])],
      answers,
    )
    expect(plan.supersede).toEqual(['list'])
    expect(plan.insert).toHaveLength(1)
  })

  it('keeps an older checklist that says something the new one does not', () => {
    const answers: RunAnswers = { byCheck: { '1': 'inconclusive' }, authoritative: false }
    const plan = planEmit(
      [checklistTask({ checklist: [
        { text: 'A stated concern is not answered by the plan', done: false },
        { text: 'A person named in the notes is missing from the plan', done: false },
      ] })],
      [checklistRow(['A stated concern is not answered by the plan'])],
      answers,
    )
    expect(plan.supersede).toEqual([])
    expect(plan.insert).toHaveLength(1)
  })

  /**
   * Clause 0. A retry rewrites its own answer under the same tag — it is not
   * retiring anything on the strength of silence — and this is the only thing
   * stopping it inserting a second task beside the one it replaces while the
   * run is inconclusive elsewhere.
   */
  it('replaces its own task by exact tag even when not authoritative', () => {
    const answers: RunAnswers = { byCheck: { '1': 'actionable', '2': 'inconclusive' }, authoritative: false }
    const plan = planEmit(
      [checklistTask({ id: 'mine', batchTag: 'prompt:run-new', description: 'Older wording.' })],
      [checklistRow(['A stated concern is not answered by the plan'])],
      answers,
    )
    expect(plan.supersede).toEqual(['mine'])
    expect(plan.insert).toHaveLength(1)
    expect(plan.keep).toEqual([])
  })

  it('replaces its own unit-tagged task by exact tag even when not authoritative', () => {
    const answers: RunAnswers = { byCheck: { '1': 'actionable' }, authoritative: false }
    const mine = existingTask({ id: 'unit', batchTag: 'prompt:run-new#1', description: 'Older wording.' })
    const row: TaskRow = {
      matter_id: 'matter-1', source: PROMPT_TASK_SOURCE, task_type: 'single', auto: true,
      batch_tag: 'prompt:run-new#1', title: 'A stated concern is not answered by the plan',
      description: 'Newer wording.', priority: 'high', checklist: [],
    }
    const plan = planEmit([mine], [row], answers)
    expect(plan.supersede).toEqual(['unit'])
    expect(plan.insert).toHaveLength(1)
  })

  describe('unit-suffixed tags', () => {
    const oldUnit = () => existingTask({ id: 'u7', batchTag: 'prompt:run-old#7' })

    it('retires it when this run cleared that check', () => {
      const answers: RunAnswers = { byCheck: { '7': 'cleared' }, authoritative: false }
      expect(planEmit([oldUnit()], [], answers).supersede).toEqual(['u7'])
    })

    it('keeps it when this run was inconclusive on that check', () => {
      const answers: RunAnswers = { byCheck: { '7': 'inconclusive' }, authoritative: false }
      expect(planEmit([oldUnit()], [], answers).supersede).toEqual([])
    })

    it('retires it when this run re-reports the same check under a new run id', () => {
      const answers: RunAnswers = { byCheck: { '7': 'actionable' }, authoritative: false }
      const row: TaskRow = {
        matter_id: 'matter-1', source: PROMPT_TASK_SOURCE, task_type: 'single', auto: true,
        batch_tag: 'prompt:run-new#7', title: 'Something', description: 'Anything',
        priority: 'high', checklist: [],
      }
      expect(planEmit([oldUnit()], [row], answers).supersede).toEqual(['u7'])
    })
  })

  /**
   * A tag with no unit suffix and no items carries no per-check signal at all,
   * so it stands unless the run is a complete answer or replacing it outright.
   * Fails safe rather than falling back to the old behaviour.
   */
  it('keeps a suffix-less task with no items unless the run is authoritative', () => {
    const legacy = existingTask({ id: 'legacy', batchTag: 'prompt:run-old', checklist: [] })
    const answers: RunAnswers = { byCheck: { '1': 'inconclusive' }, authoritative: false }
    expect(planEmit([legacy], [], answers).supersede).toEqual([])
    expect(planEmit([legacy], [], { byCheck: { '1': 'cleared' }, authoritative: true }).supersede).toEqual(['legacy'])
  })

  /** A tag this module did not write is never this run's to retire. */
  it('never retires a task whose tag it cannot parse', () => {
    const foreign = existingTask({ id: 'foreign', batchTag: 'something-else' })
    expect(planEmit([foreign], [], { byCheck: {}, authoritative: true }).supersede).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/workbench && npx vitest run tests/field-audit-tasks.test.ts
```

Expected: FAIL — `planEmit` takes two arguments, and the retirement suite's expectations do
not hold.

- [ ] **Step 3: Implement**

In `apps/workbench/lib/fieldAudit/tasks.ts`, add to the imports:

```ts
import type { RunAnswers } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
```

Immediately above `planEmit`, add:

```ts
/**
 * Pulls the run id and, if present, the unit id out of a `batch_tag`.
 *
 * Deleted when `planEmit` replaced the two superseding functions, because
 * comparing whole tags made both shapes work with no second code path.
 * Reinstated because the withdrawal rule genuinely needs the unit: "did this
 * run clear check 7" cannot be asked of a tag that has not been taken apart.
 * Returns `null` for a tag that fits neither shape — such a tag was not
 * written by this module, and is never this run's to retire.
 */
function parseBatchTag(tag: string | null): { runId: string; unitId: string | null } | null {
  if (!tag) return null
  const match = /^prompt:([^#]+)(?:#(.+))?$/.exec(tag)
  if (!match) return null
  return { runId: match[1], unitId: match[2] ?? null }
}

/**
 * Whether this run is entitled to withdraw one earlier task.
 *
 * The rule the design note states, in order. Everything not covered here
 * stands, which is the change: a run used to retire anything it did not
 * re-state, and a finding refused by the verification gate looks exactly like
 * a check the run cleared. One is evidence of absence, the other absence of
 * evidence, and only the first is grounds for closing someone's work.
 */
function mayRetire(
  task: ExistingPromptTask,
  answers: RunAnswers,
  desiredTags: Set<string>,
  desiredUnits: Set<string>,
  desiredItemText: Set<string>,
): boolean {
  // 0. Replacement. A desired row carries this exact tag, so the run is
  //    rewriting its own answer rather than retiring one on the strength of
  //    silence. First because it is what stops a retry inserting a second task
  //    beside the one it means to replace.
  if (task.batchTag !== null && desiredTags.has(task.batchTag)) return true

  // A complete answer may retire prior work.
  if (answers.authoritative) return true

  const parsed = parseBatchTag(task.batchTag)
  if (parsed === null) return false

  if (parsed.unitId !== null) {
    // This run either says that check is fine, or is re-reporting it — in
    // which case the new row replaces the old one in substance even though
    // the run ids differ.
    return answers.byCheck[parsed.unitId] === 'cleared' || desiredUnits.has(parsed.unitId)
  }

  // A run-level (checklist) tag names no single check, so its *items* are the
  // only per-check signal available: if this run's items repeat all of them,
  // the new task already says everything the old one said. Item text is the
  // check's `taskTemplate.title`, fixed by the prompt version, so it is stable
  // across runs and this comparison means something.
  //
  // No items means no signal at all — a suffix-less tag from before the unit
  // suffix existed, or a task built some other way — so it stands rather than
  // falling back to the old behaviour.
  if (task.checklist.length === 0) return false
  return task.checklist.every((item) => desiredItemText.has(item.text))
}
```

Then change `planEmit`'s signature and its final `supersede` computation. The signature
becomes:

```ts
export function planEmit(
  existing: ExistingPromptTask[],
  desired: TaskRow[],
  answers: RunAnswers,
): EmitPlan {
```

and replace the single `const supersede = ...` line at the end with:

```ts
  const desiredTags = new Set(desired.map((row) => row.batch_tag))
  const desiredUnits = new Set(
    desired.flatMap((row) => {
      const parsed = parseBatchTag(row.batch_tag)
      return parsed?.unitId ? [parsed.unitId] : []
    }),
  )
  const desiredItemText = new Set(desired.flatMap((row) => row.checklist.map((item) => item.text)))

  const supersede = candidates
    .filter((task) => !matched.has(task.id))
    .filter((task) => mayRetire(task, answers, desiredTags, desiredUnits, desiredItemText))
    .map((task) => task.id)
  return { insert, keep, supersede }
}
```

Finally, extend `planEmit`'s doc comment with a paragraph naming the new constraint:

```ts
 * What it may **not** do, which is the point of the `answers` argument: retire
 * a task on the strength of having said nothing about it. A finding the
 * verification gate refused produces no row, exactly like a check the run
 * cleared — and until that distinction existed, an uncitable blocker retired a
 * cited one. See `mayRetire` above and the design note.
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/workbench && npx vitest run tests/field-audit-tasks.test.ts
```

Expected: PASS, including every pre-existing `planEmit` guarantee now passing
`authoritative()`.

- [ ] **Step 5: Prove the guard bites**

Comment out the two lines in `mayRetire` that make it selective — the `parsed.unitId` branch's
condition and the `task.checklist.every(...)` return, replacing both with `return true` — and
confirm the replayed-failure test fails. Restore.

Then reintroduce the original defect directly: make `planEmit` skip `mayRetire` entirely, as
it did before this slice. Confirm `does not retire a task when the run could not cite the
problem` and the two "keeps" tests fail. Restore and re-confirm green.

Report what each break caught. If any break produces **no** failure, say so — that is a real
finding about the tests.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/fieldAudit/tasks.ts apps/workbench/tests/field-audit-tasks.test.ts
git commit -F - <<'MSG'
A run retires a task only where it actually answered

planEmit retired anything it did not re-state, and a finding the verification
gate refused produces no row exactly like a check the run cleared. So an
uncitable blocker retired a cited one: measured on two runs of v4 against one
unchanged sheet, where check 1 came back blocker/deviation with four verified
references and then with none, and the second run archived the first's task and
left the matter with nothing.

Now a task stands unless this run replaced it by exact tag, cleared the check
it came from, re-reported that check, already says everything it said, or
answered every check in the prompt version. parseBatchTag comes back for it --
deleted when comparing whole tags made both shapes work without it, needed
again because "did this run clear check 7" cannot be asked of a tag nobody has
taken apart.

The superset clause on checklist items is what keeps the conservative rule from
leaving two checklists standing when a run still reports the same check. It is
meaningful rather than incidental because item text is the check's template
title, fixed by the prompt version.

A suffix-less tag with no items carries no per-check signal, so it stands
unless the run is authoritative or replacing it outright -- failing safe rather
than falling back to the old behaviour.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: `emitTasks` and the tick hand over every finding

The withdrawal decision needs the outcomes the gate discards, so `emitTasks` must receive
**all** the findings and apply the gate itself. That also removes the tick's own
`actionableFindings` call, which had to assemble a half-empty `FieldAuditResult` to make it.

**Files:**
- Modify: `apps/workbench/lib/fieldAudit/tasks.ts`, `apps/workbench/app/api/cron/tick/route.ts`
- Test: `apps/workbench/tests/field-audit-tasks.test.ts`, `apps/workbench/tests/tick-route.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/workbench/tests/field-audit-tasks.test.ts`, the `emitTasks` suite's calls gain
`failedCheckNumbers: []` and their `findings` become *all* findings rather than a pre-gated
list. Add these cases to that suite:

```ts
  /**
   * The end-to-end shape of the bug. `emitTasks` is handed a blocker with no
   * verified reference — which is what the model actually returned on the
   * second real run — and must create nothing *and* withdraw nothing.
   */
  it('creates nothing and withdraws nothing from an uncitable finding', async () => {
    const { client, inserted, updatedIds } = fakeClient([
      {
        id: 'standing',
        source: PROMPT_TASK_SOURCE,
        batch_tag: 'prompt:run-old',
        status: 'open',
        assignee_id: null,
        title: 'MA design sheet audit',
        description: 'One item to confirm.',
        priority: 'high',
        task_type: 'checklist',
        checklist: [{ text: CHECK_1_TITLE, done: false }],
      },
    ])

    const result = await emitTasks(client, {
      matterId: 'matter-1',
      runId: 'run-new',
      checks: CHECKS,
      findings: [finding({ checkNumber: '1', references: [] })],
      failedCheckNumbers: [],
      outputTarget: 'checklist',
      promptTitle: 'MA design sheet audit',
    })

    expect(result).toEqual({ created: 0, kept: 0, superseded: 0 })
    expect(inserted).toEqual([])
    expect(updatedIds).toEqual([])
  })

  it('applies the gate itself, so a compliant finding makes no task', async () => {
    const { client, inserted } = fakeClient([])
    const result = await emitTasks(client, {
      matterId: 'matter-1',
      runId: 'run-new',
      checks: CHECKS,
      findings: [finding({ checkNumber: '1', outcome: 'compliant' }), finding({ checkNumber: '2', outcome: 'compliant' })],
      failedCheckNumbers: [],
      outputTarget: 'checklist',
      promptTitle: 'MA design sheet audit',
    })
    expect(result.created).toBe(0)
    expect(inserted).toEqual([])
  })
```

Declare `const CHECK_1_TITLE = check({ number: '1' }).taskTemplate.title` near the other
fixtures so the checklist item text matches what `taskRowsFor` would build — if it did not,
the superset clause would be tested against a string it can never match.

In `apps/workbench/tests/tick-route.test.ts`, extend the field-audit test to assert the tick
hands over the unfiltered findings and the failed units:

```ts
  /**
   * The tick must pass *all* the findings, not `actionableFindings`. The
   * withdrawal rule needs the outcomes the gate discards — a `compliant` check
   * is what entitles a run to retire an earlier task, and it never survives
   * the gate.
   */
  it('hands emitTasks every finding, and the units that failed', async () => {
    // ... arrange a field_audit context whose stored findings include one
    // compliant check and one gated deviation, and one failed step ...
    expect(emitTasks).toHaveBeenCalledTimes(1)
    const passed = vi.mocked(emitTasks).mock.calls[0][1]
    expect(passed.findings).toHaveLength(2)
    expect(passed.findings.map((f) => f.outcome)).toContain('compliant')
    expect(passed.failedCheckNumbers).toEqual(['2'])
  })
```

Fill in the arrangement following the conventions already in that file — it mocks
`@/lib/runs/context`, `@/lib/runs/worker`, `@/lib/runs/record`, `@/lib/fieldAudit/history`,
`@/lib/fieldAudit/tasks` and `@/lib/anthropic`, and controls `claim_workflow_run` through a
`vi.hoisted` state object. The steps reload goes through the admin mock's `from()`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/workbench && npx vitest run tests/field-audit-tasks.test.ts tests/tick-route.test.ts
```

Expected: FAIL — `EmitTasksInput` has no `failedCheckNumbers`, and the tick still pre-filters.

- [ ] **Step 3: Implement in `tasks.ts`**

Add to the imports:

```ts
import { isActionable, runAnswers } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
```

Replace `EmitTasksInput`'s `findings` field and add the new one:

```ts
  /**
   * *All* of the run's findings, not the gated subset. `emitTasks` applies
   * the gate itself, because the withdrawal rule needs the outcomes the gate
   * discards: a `compliant` check is what entitles this run to retire an
   * earlier task, and it never survives `isActionable`.
   */
  findings: FieldAuditFinding[]
  /** Units whose step did not succeed — they answered nothing, so they retire nothing. */
  failedCheckNumbers: string[]
```

In `emitTasks`, replace the `desired`/`plan` lines with:

```ts
  const answers = runAnswers({
    checkNumbers: input.checks.map((check) => check.number),
    findings: input.findings,
    failedCheckNumbers: input.failedCheckNumbers,
  })

  const desired = taskRowsFor(
    input.matterId,
    input.runId,
    input.checks,
    input.findings.filter(isActionable),
    input.outputTarget,
    input.promptTitle,
  )

  const plan = planEmit(existing, desired, answers)
```

Update `taskRowsFor`'s doc comment, which currently says its `findings` are expected to be
already gated: it still is, but the gate is now applied by `emitTasks` immediately above
rather than by the caller — say so, and say why (one source of truth for what may act).

- [ ] **Step 4: Implement in the tick route**

In `apps/workbench/app/api/cron/tick/route.ts`, remove the `actionableFindings` import and
replace the `field_audit` block's body with:

```ts
    if (context.kind === 'field_audit') {
      const body = context.prompt.body as FieldAuditBody
      const stored = await loadFieldAuditFindings(admin, runId)
      await emitTasks(admin, {
        matterId: String(context.run.matter_id),
        runId,
        checks: body.checks,
        // Every finding, not the gated subset: `emitTasks` applies the gate,
        // and the withdrawal rule needs the outcomes it discards. A run that
        // cleared a check is what entitles it to retire an earlier task, and
        // a `compliant` finding never survives the gate.
        findings: stored,
        // A unit that did not succeed answered nothing, so it retires nothing.
        failedCheckNumbers: steps.filter((step) => step.status !== 'succeeded').map((step) => step.unitId),
        // The target from the version this run pinned, never the published
        // one: a prompt republished as `chat` since must not retroactively
        // decide that a `task_set` run mid-flight produces nothing.
        outputTarget: body.outputTarget,
        promptTitle: context.prompt.title,
      })
    }
```

`steps` is already in scope from the `toRunSteps` call above.

- [ ] **Step 5: Verify**

```bash
cd apps/workbench && npm run typecheck && npx vitest run
```

```bash
npx vitest run && npm run typecheck
```

Expected: both PASS, workbench count up by the new tests.

- [ ] **Step 6: Prove the wiring bites**

Change the tick to pass `stored.filter(isActionable)` — the old behaviour — and confirm the
new tick test fails. Then set `failedCheckNumbers: []` unconditionally and confirm the same
test fails. Restore and re-confirm green. Report both results.

- [ ] **Step 7: Commit**

```bash
git add apps/workbench/lib/fieldAudit/tasks.ts apps/workbench/app/api/cron/tick/route.ts apps/workbench/tests/field-audit-tasks.test.ts apps/workbench/tests/tick-route.test.ts
git commit -F - <<'MSG'
The tick hands over every finding, and emitTasks applies the gate

The withdrawal rule needs the outcomes the gate discards. A run that came back
compliant on a check is what entitles it to retire an earlier task for that
check, and a compliant finding never survives isActionable -- so passing the
gated subset threw away exactly the evidence the decision runs on.

So emitTasks now takes all of the run's findings and applies the gate itself,
which also means one source of truth for what may act rather than a caller
that could filter differently. The tick stops assembling a half-empty
FieldAuditResult just to call actionableFindings, and passes the units whose
step did not succeed -- a unit that answered nothing retires nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: verify, ship, and prove it on the run that found the bug

- [ ] **Step 1: Everything, in both projects**

```bash
npm run typecheck && npx vitest run
```

```bash
cd apps/workbench && npm run typecheck && npx vitest run
```

Expected: both PASS. Baselines before this branch were root 459 files / 4870 / 1 skipped and
workbench 83 files / 1025.

- [ ] **Step 2: The live column check**

Nothing new is queried by this slice, but run it — `emitTasks` was edited and the check is
cheap. Copy the env in only for the operation and delete it immediately; never print the
password.

```bash
cp /Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.env.local .env.local.tmp
set -a && . ./.env.local.tmp && set +a
node scripts/checkDbColumns.mjs
rm -f .env.local.tmp
```

Expected: PASS. A column reported absent that `information_schema` shows exists is
PostgREST's stale schema cache — `notify pgrst, 'reload schema'` and wait, rather than
chasing a migration.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin claude/withdrawal-scoping
```

Then `gh pr create`, with a body that states the measured failure, the rule, and the cost
(an inconclusive run withdraws less, so a stale task can linger). Include the
`🤖 Generated with [Claude Code](https://claude.com/claude-code)` trailer.

- [ ] **Step 4: After merge, replay the exact failure against production**

The one that matters. Matter `e10908ee` currently holds the restored checklist task from run
`a2a4f300`, tagged `prompt:a2a4f300-1f6b-44dc-89b9-fa5da4c34e36`, one item, `open`,
unassigned. Queue a fresh trigger and watch what happens to it:

```sql
insert into prompt_stage_triggers (matter_id, prompt_id, to_stage, stage_entered_at, status)
select 'e10908ee-9337-4e61-9a42-537d06bb5e10', p.id, 'drafting', now(), 'pending'
from prompts p where p.slug = 'ma-design-sheet-audit';
```

Report, before calling this done:

- the new run's per-check outcomes and reference counts, so the run's answer is on the record
- **whether the restored task survived** — and which clause of the rule decided it
- if the new run *was* authoritative and cleared check 1, the task is correctly retired; say
  so plainly rather than treating retirement as failure. The fix is not "never withdraw", it
  is "withdraw only where you answered"
- if the new run reported check 1 again, exactly one checklist should stand, by the superset
  clause

The verification drift makes the outcome genuinely uncertain, which is the point: report what
happened rather than what was hoped for.

---

## Out of scope, named

**Prompt-scoping the `batch_tag`.** Withdrawal is still scoped to the matter rather than the
prompt, so two task-emitting prompts on one matter would each withdraw the other's. Invisible
today because only one prompt emits tasks; certain once the 40-prompt library lands. It means
changing the tag shape a third time.

**Why the model cites a check on one run and not the next.** This slice makes the consequence
safe. It does not explain the drift, which wants more evidence than two runs.
