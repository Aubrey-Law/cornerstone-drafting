# Prompt-Scoped Withdrawal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A run may only withdraw tasks belonging to its own prompt, so two task-emitting prompts on one matter stop erasing each other.

**Architecture:** The scoping turns on the relationship that already exists — `workflow_runs.prompt_version_id` → `prompt_versions.prompt_id` — rather than on a third `batch_tag` shape. `emitTasks` resolves each candidate task's run to its prompt; `planEmit` stays pure and simply ignores candidates that are not this prompt's. See `docs/superpowers/specs/2026-09-06-prompt-scoping-design.md`.

**Tech Stack:** TypeScript, vitest, Supabase Postgres, Next.js 16 App Router.

---

## Read this first

**Worktree.** Every command runs from
`/Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.claude/worktrees/workbench-app-improvements-e03851`.
Never `cd` to the repository root — a different checkout. Never `git stash` — the stash stack
is shared; use a temporary commit. Branch is `claude/prompt-scoping`.

**Running tests.** Root and workbench are separate vitest *and* typecheck projects:

| What | Command |
| --- | --- |
| One workbench file | `cd apps/workbench && npx vitest run tests/<name>.test.ts` |
| Whole workbench suite | `cd apps/workbench && npx vitest run` |
| Workbench typecheck | `cd apps/workbench && npm run typecheck` |
| Root suite | `npx vitest run` |
| Root typecheck | `npm run typecheck` — **excludes `apps/`** |

`npx vitest run apps/workbench/tests/x.test.ts` from the repo root **matches no files and
exits 0**. Always read the reported counts. `packages/citations` has no test runner of its
own; its tests live in `apps/workbench/tests/`.

Baselines on this branch: root 459 files / 4870 passing / 1 skipped; workbench 84 files /
1055 passing; both typechecks clean.

**Client data is privileged.** Print counts, check numbers, field keys and paths — never a
client's field values.

---

## File structure

| File | Responsibility |
| --- | --- |
| `apps/workbench/lib/prompts/repository.ts` | Modify: `PublishedPrompt` gains `promptId`; both loaders populate it. |
| `apps/workbench/tests/prompt-repository.test.ts` | Modify: assert `promptId` survives both load paths. |
| `apps/workbench/lib/fieldAudit/tasks.ts` | Modify: `ExistingPromptTask` gains `promptId`; `planEmit`'s third argument becomes a run object carrying `promptId` and `answers`; `emitTasks` resolves candidates' prompts. |
| `apps/workbench/tests/field-audit-tasks.test.ts` | Modify: call sites; new scoping suite. |
| `apps/workbench/app/api/cron/tick/route.ts` | Modify: pass `promptId`. |
| `apps/workbench/tests/tick-route.test.ts` | Modify: assert the prompt id is handed over. |

---

### Task 1: `PublishedPrompt` carries its prompt id

Both loaders already read it — `loadPublishedPrompt` has `promptRow.id`, `loadPromptVersionById`
has `versionRow.prompt_id` — and neither exposes it. Nothing else changes here.

**Files:**
- Modify: `apps/workbench/lib/prompts/repository.ts`
- Test: `apps/workbench/tests/prompt-repository.test.ts` (find the existing suite for
  `toPublishedPrompt`; if there is none, note that and put the assertions wherever this
  module is already covered)

- [ ] **Step 1: Find the existing coverage**

```bash
grep -rln "toPublishedPrompt\|loadPromptVersionById\|loadPublishedPrompt" apps/workbench/tests/
```

Read what you find. `toPublishedPrompt` is a pure function over a row shape and is the place
the new field is actually assembled, so it is where the assertion belongs.

- [ ] **Step 2: Write the failing test**

Add to that suite, matching its existing fixture style:

```ts
  /**
   * The withdrawal rule scopes candidates by prompt, and the only way it can
   * know this run's prompt is off the loaded version. `prompt_id` was always
   * read by both loaders and never exposed.
   */
  it('carries the prompt id, not only the version id', () => {
    const prompt = toPublishedPrompt({
      id: 'version-1',
      version_number: 4,
      body: { kind: 'field_audit', inputs: [], checks: [FIELD_AUDIT_CHECK], outputTarget: 'checklist' },
      prompt_id: 'prompt-1',
      prompts: { slug: 'ma-design-sheet-audit', title: 'MA design sheet audit', kind: 'field_audit' },
    })
    expect(prompt.promptId).toBe('prompt-1')
    expect(prompt.versionId).toBe('version-1')
  })
```

`FIELD_AUDIT_CHECK` should be whatever minimal valid check the surrounding suite already
uses — reuse its fixture rather than declaring a new one. If the suite has no such fixture,
build one satisfying `fieldAuditCheckSchema` (`number`, `statement`, `risk`, `reads` with at
least one entry that an input declares, `taskTemplate`).

- [ ] **Step 3: Run it to verify it fails**

```bash
cd apps/workbench && npx vitest run tests/prompt-repository.test.ts
```

Expected: FAIL — `toPublishedPrompt` takes no `prompt_id` and returns no `promptId`.

- [ ] **Step 4: Implement**

In `apps/workbench/lib/prompts/repository.ts`, add to `PublishedPrompt`:

```ts
export interface PublishedPrompt {
  versionId: string
  /**
   * The *prompt*, not the version. The withdrawal rule in
   * `lib/fieldAudit/tasks.ts` scopes a run's candidates to its own prompt, and
   * scoping by version instead would strand every task the moment a prompt is
   * republished — version 4 must still retire version 3's tasks, because it is
   * a newer answer to the same question.
   */
  promptId: string
  versionNumber: number
  slug: string
  title: string
  body: PromptBody
}
```

Give `toPublishedPrompt`'s row parameter a `prompt_id: string` field, return
`promptId: row.prompt_id`, and pass it from all three call sites:

- `loadPublishedPrompt` — `prompt_id: promptRow.id`
- `loadPromptVersionById` — `prompt_id: String(versionRow.prompt_id)`
- `loadPublishedPrompts` — `prompt_id: String(publication.prompt_id)`

The compiler will name any site you miss.

- [ ] **Step 5: Verify**

```bash
cd apps/workbench && npm run typecheck && npx vitest run
```

Expected: PASS, count up by one.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/prompts/repository.ts apps/workbench/tests/prompt-repository.test.ts
git commit -F - <<'MSG'
A loaded prompt says which prompt it is, not only which version

Both loaders already read prompt_id and neither exposed it. The withdrawal rule
needs it: a run may only retire tasks belonging to its own prompt, and the only
place it can learn its own prompt is the version it loaded.

The prompt rather than the version, deliberately. Version 4 must still retire
version 3's tasks -- same prompt, newer answer to the same question -- and
scoping by version would strand every task the moment a prompt is republished.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: `planEmit` ignores candidates from another prompt

`planEmit`'s third argument becomes an object describing the run, because it now carries two
things about it and a fourth positional argument would read worse — and because the next
addition should not churn every call site again.

**Files:**
- Modify: `apps/workbench/lib/fieldAudit/tasks.ts`
- Test: `apps/workbench/tests/field-audit-tasks.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/workbench/tests/field-audit-tasks.test.ts`, the `authoritative()` helper becomes:

```ts
  /** A run that answered everything, so retirement is permitted. */
  function authoritative(): PlanEmitRun {
    return { promptId: PROMPT_ID, answers: { byCheck: { '1': 'actionable' }, authoritative: true } }
  }
```

with `const PROMPT_ID = 'prompt-1'` declared near the other fixtures, and `existingTask`
defaulting `promptId: PROMPT_ID` so every pre-existing case keeps meaning what it meant.
Every `planEmit(existing, desired, X)` call where `X` is a bare `RunAnswers` object becomes
`planEmit(existing, desired, { promptId: PROMPT_ID, answers: X })`.

Then append:

```ts
describe('planEmit prompt scoping', () => {
  const OTHER_PROMPT = 'prompt-2'

  function run(answers: RunAnswers, promptId = PROMPT_ID): PlanEmitRun {
    return { promptId, answers }
  }

  /**
   * The failure this exists to prevent. Two prompts emitting on one matter
   * would each withdraw the other's on every run — invisible today only
   * because the review playbook emits no tasks, and certain once the
   * 40-prompt library lands.
   */
  it('never retires a task belonging to another prompt', () => {
    const theirs = existingTask({ id: 'theirs', promptId: OTHER_PROMPT, batchTag: 'prompt:their-run#1' })
    const plan = planEmit([theirs], [], run({ byCheck: { '1': 'cleared' }, authoritative: true }))
    expect(plan.supersede).toEqual([])
    expect(plan.keep).toEqual([])
  })

  /** Not a twin either — otherwise an identical task from another prompt
   *  would suppress this run's own insert. */
  it('never counts another prompt’s task as a twin', () => {
    const theirs = existingTask({ id: 'theirs', promptId: OTHER_PROMPT, batchTag: 'prompt:run-new#1' })
    const row: TaskRow = {
      matter_id: 'matter-1', source: PROMPT_TASK_SOURCE, task_type: 'single', auto: true,
      batch_tag: 'prompt:run-new#1', title: theirs.title, description: theirs.description,
      priority: theirs.priority, checklist: [],
    }
    const plan = planEmit([theirs], [row], run({ byCheck: { '1': 'actionable' }, authoritative: true }))
    expect(plan.keep).toEqual([])
    expect(plan.insert).toHaveLength(1)
    expect(plan.supersede).toEqual([])
  })

  /**
   * What distinguishes prompt-scoping from version-scoping: an older *version*
   * of the same prompt is still this run's to retire, because it is a newer
   * answer to the same question.
   */
  it('retires a task from an earlier version of the same prompt', () => {
    const older = existingTask({ id: 'older', promptId: PROMPT_ID, batchTag: 'prompt:v3-run#1' })
    const plan = planEmit([older], [], run({ byCheck: { '1': 'cleared' }, authoritative: true }))
    expect(plan.supersede).toEqual(['older'])
  })

  /** A candidate whose run could not be resolved has no prompt, so it is not
   *  this run's to retire — the same "withdraw only where you know" rule. */
  it('keeps a task whose prompt could not be resolved', () => {
    const unknown = existingTask({ id: 'unknown', promptId: null, batchTag: 'prompt:gone#1' })
    const plan = planEmit([unknown], [], run({ byCheck: { '1': 'cleared' }, authoritative: true }))
    expect(plan.supersede).toEqual([])
  })

  /**
   * The whole point, end to end as a pure decision: two prompts alternating on
   * one matter each keep their own and touch nothing of the other's.
   */
  it('lets two prompts coexist on one matter', () => {
    const mine = existingTask({ id: 'mine', promptId: PROMPT_ID, batchTag: 'prompt:my-old#1' })
    const theirs = existingTask({ id: 'theirs', promptId: OTHER_PROMPT, batchTag: 'prompt:their-run#1' })

    const mineRuns = planEmit([mine, theirs], [], run({ byCheck: { '1': 'cleared' }, authoritative: true }))
    expect(mineRuns.supersede).toEqual(['mine'])

    const theirsRuns = planEmit(
      [mine, theirs],
      [],
      run({ byCheck: { '1': 'cleared' }, authoritative: true }, OTHER_PROMPT),
    )
    expect(theirsRuns.supersede).toEqual(['theirs'])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/workbench && npx vitest run tests/field-audit-tasks.test.ts
```

Expected: FAIL — `PlanEmitRun` does not exist and `ExistingPromptTask` has no `promptId`.

- [ ] **Step 3: Implement**

In `apps/workbench/lib/fieldAudit/tasks.ts`, add to `ExistingPromptTask`:

```ts
  /**
   * The prompt this task's run belonged to, resolved by `emitTasks` through
   * `workflow_runs.prompt_version_id` → `prompt_versions.prompt_id`. `null`
   * when the run no longer exists or the tag does not parse — in which case
   * the task is nobody's to retire and stands.
   */
  promptId: string | null
```

Add above `planEmit`:

```ts
/**
 * The run `planEmit` is deciding for: which prompt it belongs to, and what it
 * concluded.
 *
 * An object rather than two positional arguments because both describe the
 * same thing and a fourth positional would read as noise at every call site —
 * and because the next thing this decision needs should not churn them all
 * again.
 */
export interface PlanEmitRun {
  /** Only this prompt's tasks are this run's to touch. */
  promptId: string
  answers: RunAnswers
}
```

Change the signature to `planEmit(existing, desired, run: PlanEmitRun)`, replace
`answers.` with `run.answers.` throughout (including in `mayRetire`'s call), and extend the
candidate filter with the prompt scope:

```ts
  const candidates = existing.filter(
    (task) =>
      task.source === PROMPT_TASK_SOURCE &&
      task.status === 'open' &&
      task.assigneeId === null &&
      // Another prompt's tasks are not this run's to touch — not to retire,
      // and not to claim as a twin either, since an identical row from another
      // prompt would otherwise suppress this run's own insert. A `null`
      // `promptId` never matches, which is the intended fail-safe.
      task.promptId === run.promptId,
  )
```

Add a sentence to `planEmit`'s doc comment recording that the scope is the prompt rather
than the matter, and that a candidate whose prompt is unknown stands.

- [ ] **Step 4: Run to verify they pass**

```bash
cd apps/workbench && npx vitest run tests/field-audit-tasks.test.ts
```

Expected: PASS. `emitTasks` in the same file will not compile yet — it still calls `planEmit`
with the old shape and builds `ExistingPromptTask` without `promptId`. That is Task 3.

- [ ] **Step 5: Prove the scope bites**

Delete the `task.promptId === run.promptId` line and confirm the scoping suite fails —
report which cases and how many. Restore. Then set the filter to `task.promptId !== null`
(scoping to "resolvable" rather than "mine") and confirm `never retires a task belonging to
another prompt` still fails, which is what shows the test is about *whose* prompt rather than
merely about resolvability. Restore.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/fieldAudit/tasks.ts apps/workbench/tests/field-audit-tasks.test.ts
git commit -F - <<'MSG'
A run only touches its own prompt's tasks

planEmit considered every prompt-sourced task on the matter, so two prompts
emitting on one matter would each withdraw the other's on every run. Invisible
only because the review playbook emits no tasks and exactly one prompt writes
to the table; the 40-prompt library makes it certain.

The scope is the prompt, not the version: version 4 still retires version 3's
tasks, because it is a newer answer to the same question, and scoping by
version would strand every task the moment a prompt is republished.

Another prompt's task is excluded from the candidates entirely rather than
merely from retirement -- otherwise an identical row from another prompt would
be claimed as a twin and suppress this run's own insert. A null promptId never
matches, so a task whose run cannot be resolved is nobody's to retire and
stands, which is the same rule as the last slice.

The third argument becomes an object describing the run. Two things about one
subject read better named than as a third and fourth positional, and the next
addition now costs no churn at the call sites.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: `emitTasks` resolves each candidate's prompt

**Files:**
- Modify: `apps/workbench/lib/fieldAudit/tasks.ts`, `apps/workbench/app/api/cron/tick/route.ts`
- Test: `apps/workbench/tests/field-audit-tasks.test.ts`, `apps/workbench/tests/tick-route.test.ts`

- [ ] **Step 1: Write the failing tests**

The `emitTasks` suite's calls gain `promptId: PROMPT_ID`, and its fake client needs to answer
two further queries. Extend that suite's `fakeClient` helper so `from('workflow_runs')` and
`from('prompt_versions')` return rows it is given, rather than only handling `tasks` — follow
whatever shape the existing helper already uses, and keep `tasks` behaving as before.

Add:

```ts
  it('leaves another prompt’s task alone on the same matter', async () => {
    const { client, inserted, updatedIds } = fakeClient(
      [
        {
          id: 'theirs', source: PROMPT_TASK_SOURCE, batch_tag: 'prompt:their-run',
          status: 'open', assignee_id: null, title: 'Funding review',
          description: 'Something else entirely.', priority: 'high',
          task_type: 'checklist', checklist: [{ text: 'Not our item', done: false }],
        },
      ],
      { runs: [{ id: 'their-run', prompt_version_id: 'their-version' }], versions: [{ id: 'their-version', prompt_id: 'prompt-2' }] },
    )

    const result = await emitTasks(client, {
      matterId: 'matter-1', runId: 'run-new', promptId: PROMPT_ID, checks: CHECKS,
      findings: [finding({ checkNumber: '1', outcome: 'compliant' }), finding({ checkNumber: '2', outcome: 'compliant' })],
      failedCheckNumbers: [], outputTarget: 'checklist', promptTitle: 'MA design sheet audit',
    })

    // Authoritative and all-clear, so it would have retired the row under the
    // old matter-wide scope.
    expect(result).toEqual({ created: 0, kept: 0, superseded: 0 })
    expect(updatedIds).toEqual([])
    expect(inserted).toEqual([])
  })

  it('still retires its own prompt’s task from an earlier run', async () => {
    const { client, updatedIds } = fakeClient(
      [
        {
          id: 'mine', source: PROMPT_TASK_SOURCE, batch_tag: 'prompt:my-old-run',
          status: 'open', assignee_id: null, title: 'MA design sheet audit',
          description: 'Older wording.', priority: 'high',
          task_type: 'checklist', checklist: [{ text: CHECK_1_TITLE, done: false }],
        },
      ],
      { runs: [{ id: 'my-old-run', prompt_version_id: 'v3' }], versions: [{ id: 'v3', prompt_id: PROMPT_ID }] },
    )

    const result = await emitTasks(client, {
      matterId: 'matter-1', runId: 'run-new', promptId: PROMPT_ID, checks: CHECKS,
      findings: [finding({ checkNumber: '1', outcome: 'compliant' }), finding({ checkNumber: '2', outcome: 'compliant' })],
      failedCheckNumbers: [], outputTarget: 'checklist', promptTitle: 'MA design sheet audit',
    })

    expect(result.superseded).toBe(1)
    expect(updatedIds).toEqual([['mine']])
  })
```

In `tests/tick-route.test.ts`, extend the field-audit assertion to include
`expect(passed.promptId).toBe(<the context prompt's promptId>)`, using whatever the mocked
context sets.

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/workbench && npx vitest run tests/field-audit-tasks.test.ts tests/tick-route.test.ts
```

Expected: FAIL — `EmitTasksInput` has no `promptId`.

- [ ] **Step 3: Implement in `tasks.ts`**

Add `promptId: string` to `EmitTasksInput`, documented as "the prompt this run belongs to —
only its own tasks are this run's to touch".

After the existing-tasks select and before building `existing`, resolve each candidate's
prompt. Two plain selects, not a PostgREST embedded select — `scripts/lib/queryReferences.mjs`
cannot check columns through an embedded form, the same trade `loadPublishedPrompt` makes:

```ts
  // Which prompt each of these tasks came from. The tag carries the run id and
  // the run carries the version, so the prompt is two hops away — and it is
  // the database rather than the tag that is authoritative about it, which is
  // why the tag was not given a third shape. A task whose run has gone
  // resolves to nothing and is therefore nobody's to retire.
  const candidateRunIds = [
    ...new Set(
      (existingRows ?? []).flatMap((row) => {
        const parsed = parseBatchTag((row.batch_tag as string | null) ?? null)
        return parsed ? [parsed.runId] : []
      }),
    ),
  ]

  const promptByRunId = new Map<string, string>()
  if (candidateRunIds.length > 0) {
    const { data: runRows, error: runsError } = await sb
      .from('workflow_runs')
      .select('id, prompt_version_id')
      .in('id', candidateRunIds)
    if (runsError) throw new Error(`Could not resolve the runs behind this matter's prompt tasks: ${runsError.message}`)

    const versionIds = [
      ...new Set((runRows ?? []).flatMap((row) => (row.prompt_version_id ? [String(row.prompt_version_id)] : []))),
    ]

    if (versionIds.length > 0) {
      const { data: versionRows, error: versionsError } = await sb
        .from('prompt_versions')
        .select('id, prompt_id')
        .in('id', versionIds)
      if (versionsError) {
        throw new Error(`Could not resolve the prompts behind this matter's prompt tasks: ${versionsError.message}`)
      }

      const promptByVersionId = new Map(
        (versionRows ?? []).map((row) => [String(row.id), String(row.prompt_id)]),
      )
      for (const row of runRows ?? []) {
        const promptId = row.prompt_version_id ? promptByVersionId.get(String(row.prompt_version_id)) : undefined
        if (promptId) promptByRunId.set(String(row.id), promptId)
      }
    }
  }
```

Then in the `existing` mapping, add:

```ts
    promptId: (() => {
      const parsed = parseBatchTag((row.batch_tag as string | null) ?? null)
      return parsed ? promptByRunId.get(parsed.runId) ?? null : null
    })(),
```

and change the `planEmit` call to
`planEmit(existing, desired, { promptId: input.promptId, answers })`.

- [ ] **Step 4: Implement in the tick route**

Add `promptId: context.prompt.promptId,` to the `emitTasks` call, with a brief comment that
only this prompt's tasks are this run's to touch.

- [ ] **Step 5: Verify**

```bash
cd apps/workbench && npm run typecheck && npx vitest run
```

```bash
npx vitest run && npm run typecheck
```

Expected: all PASS.

- [ ] **Step 6: Prove the wiring bites**

Hardcode `promptId: 'anything-else'` in the tick and confirm the tick test fails. Then make
`emitTasks` skip the resolution and set every `promptId` to `input.promptId` — the old
matter-wide behaviour — and confirm `leaves another prompt's task alone on the same matter`
fails. Restore both and re-verify. Report each result.

- [ ] **Step 7: Commit**

```bash
git add apps/workbench/lib/fieldAudit/tasks.ts apps/workbench/app/api/cron/tick/route.ts apps/workbench/tests/field-audit-tasks.test.ts apps/workbench/tests/tick-route.test.ts
git commit -F - <<'MSG'
emitTasks resolves which prompt each candidate task came from

The tag carries a run id and the run carries a version, so a task's prompt is
two hops away in the database. That relationship is authoritative and already
exists, which is why the batch_tag was not given a third shape to carry it --
it has changed twice already, two forms are parsed in one place, and the tag is
provenance a person reads rather than what the decision should turn on.

Two plain selects rather than an embedded one, because queryReferences.mjs
cannot check columns through an embedded form. Both are `in (...)` lookups over
one matter's prompt tasks, which is a handful of rows.

A task whose run has been deleted resolves to no prompt and stands. That is the
same discipline as withdrawal scoping: act only where you actually know. The
cost is a row that can never be retired automatically; the alternative is
retiring rows we cannot account for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: verify and ship

- [ ] **Step 1: Both projects**

```bash
npm run typecheck && npx vitest run
```

```bash
cd apps/workbench && npm run typecheck && npx vitest run
```

Expected: both PASS. Baselines were root 459 / 4870 / 1 skipped and workbench 84 / 1055.

- [ ] **Step 2: The live column check**

`emitTasks` now reads `workflow_runs.id`, `workflow_runs.prompt_version_id`,
`prompt_versions.id` and `prompt_versions.prompt_id`. Verify them against the real database:

```bash
cd apps/workbench && npx vitest run tests/query-columns.test.ts
```

```bash
cp /Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.env.local .env.local.tmp
set -a && . ./.env.local.tmp && set +a
node scripts/checkDbColumns.mjs
rm -f .env.local.tmp
```

Expected: both PASS, with the column count higher than the previous 471 across 24 tables.
Never print the password; delete the copy immediately.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin claude/prompt-scoping
```

Then `gh pr create`, with a body stating the failure prevented, why the fix is a relationship
rather than a third tag shape, and what it costs. Include the
`🤖 Generated with [Claude Code](https://claude.com/claude-code)` trailer.

- [ ] **Step 4: After merge, confirm the one live task still stands**

Matter `e10908ee` holds exactly one open prompt task, `3aaeb284`, tagged
`prompt:8d79795b-e82c-4363-8123-cb0281aa6598` — the design-sheet audit's own. Its run still
exists, so it must resolve to that prompt and behave exactly as before.

Queue one trigger and report: the new run's per-check outcomes and reference counts, whether
the standing task was kept, replaced or retired, and which clause decided. A second
task-emitting prompt does not exist yet, so this confirms the change is inert for the single
prompt case rather than demonstrating coexistence — **say that plainly** rather than
presenting it as proof of the fix. The coexistence property is proven by the tests.

---

## Out of scope, named

**Any change to `batch_tag`.** Considered and declined; see the design note.

**Why the model cites a check on one run and not the next.** Three data points so far on the
same check and sheet — 4, 0, 5 verified references — and still unexplained.
