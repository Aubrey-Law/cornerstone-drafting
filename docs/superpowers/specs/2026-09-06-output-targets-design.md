# Output targets — phase 4, fifth slice

**Date:** 2026-09-06
**Phase:** 4 of `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, fifth sub-project
**Follows:** `2026-09-06-stage-triggered-runs-design.md`
**Status:** design approved by the owner 2026-09-06

## What exists, and what does not

`output_target` appears nowhere in the codebase — not as a column, not in the body schema.
The field audit creates tasks because `emitTasks` is called unconditionally for a
`field_audit` run; nothing declares that as a choice. So this slice introduces the concept,
not merely another target.

The plan names five values: `chat | draft_doc | checklist | task_set | email_draft`.

**Two of them the workbench cannot do, and the owner scoped them out.**
`apps/workbench/lib/storage/r2.ts` imports `GetObjectCommand` only — the workbench's R2
client is read-only, and the app writes nothing to `matter_documents` or
`document_versions`. There is no email surface in it at all. Building `draft_doc` would
mean granting write access to the bucket holding every client's documents and either
duplicating or coupling to the root app's drafting engine.

And the safety model does not transfer. Everything trustworthy in this feature rests on one
rule: **a claim is verified against its source or it does not act.** A finding cites a
design-sheet field and the verifier checks it. Generated prose has no source to check
against, so `draft_doc` and `email_draft` would put unverified output on a client-facing
path in a feature built on the opposite principle. They need their own slice, where the
verifier question is decided deliberately rather than in passing.

**This slice: `chat`, `task_set`, `checklist`.**

## Where `output_target` lives, and why it is not a column

In the version **body**, as a field of the `field_audit` arm — not on `prompts` alongside
`fires_on_stage_entry`.

The reason is provenance. A run records `prompt_version_id` and nothing else about what the
prompt said. If the target were a mutable column, a run from last week would be
indistinguishable from one that produced something else entirely — you could not tell from
the record whether it made six tasks or one checklist. In the body it is pinned to the
version, and the per-check `taskTemplate` already lives there for the same reason.

The rule that falls out: **content changes make a version; configuration does not.**
`fires_on_stage_entry` decides *when* a prompt runs and is a column. `output_target` decides
*what a run produces* and is content.

So switching the design-sheet audit to `checklist` is **version 4**, and versions 1 to 3
stay interpretable against exactly what they produced.

## The three targets

**`chat`** — the run produces no objects. The run page is the output, and it already renders
each finding's rationale, so this formalises what happens rather than adding to it. What it
changes is that a prompt can *say* it produces nothing, instead of task creation being an
unconditional consequence of being a field audit.

**`task_set`** — one task per actionable finding. Today's behaviour, now declared.

**`checklist`** — **one** task for the run, `task_type: 'checklist'`, carrying one item per
actionable finding. `tasks.checklist` is `[{done: boolean, text: string}]` — verified
against live rows, which hold 6 and 10 items — and `lib/stage-engine/stageTaskTemplates.ts`
already distinguishes `type: 'single' | 'checklist'`. This follows that convention rather
than inventing one.

The schema admits only these three. A target the schema accepts but nothing implements would
let someone publish a prompt that silently produces nothing, and "silently produces nothing"
is the failure this project keeps finding. Adding `draft_doc` later is a schema change and an
implementation together, in that order.

## Why the audit switches to `checklist`

The owner's decision, and it settles something left open on 2026-09-06. Checks 1 and 2 both
flag one guardian gap from different angles, producing two blocker tasks for one omission.
Removing that overlap would need a post-pass over findings — a finding that suppresses
another — which was judged a poor trade for a six-check prompt and deliberately not built.

As a checklist those two become **two items on one task**. The same information takes one
line in the task list instead of two, without any new concept. It does not remove the
duplication, and it is not pretending to: what it removes is the duplication's cost.

There is a second reason. Building `checklist` and leaving it unused would ship an
unexercised path, and every unexercised path on this branch has turned out to contain a bug
— the `"null"` document id, the advisory that could never be cleared, the dead `revalidate`.
A target nothing declares is a target nothing has run.

## The gate is unchanged

Items come from `actionableFindings` — the same severity, disposition and verified-reference
gate. A `checklist` run whose findings all failed verification creates **no task at all**,
not an empty checklist: a task with nothing in it says work is needed and then names none.

## Superseding has to learn a second shape — and is currently broken

This is the interaction worth naming, because it is where a careless change would break
something that already works. Except that on checking, it does not currently work.

Tasks carry `batch_tag` as `prompt:<runId>#<unitId>` — the unit suffix added in #411 so a
retry could replace one unit's task without touching another's. A `checklist` run produces
**one task for the whole run**, so there is no single unit it belongs to. Its tag is
`prompt:<runId>` with no suffix, and superseding it is per-run rather than per-unit.

`parseBatchTag` already handles both: its regex `^prompt:([^#]+)(?:#(.+))?$` makes the
suffix optional and returns a null `unitId` without one. It is module-private rather than
exported, which was the only thing that looked like it needed settling.

### The retry path lost its wiring in #412

`emitTasks` takes a `unitIds` argument that selects `tasksToSupersedeForUnits` over
`tasksToSupersede` — the whole mechanism #411 built so a retry replaces its own unit's task
and leaves the others alone. **Nothing passes it.** `git log -S` shows
`unitIds: retryUnitIds` in `retry.ts` until #412 moved `emitTasks` out of retry and into the
tick, where it was never reinstated. So `tasksToSupersedeForUnits` is dead code, and a
retried run reaching `done` a second time inserts a task for *every* actionable finding
again — including the units that never failed, whose task from the first pass survives
because `tasksToSupersede` excludes this run's own id. Duplicate tasks, one per unit that
succeeded first time. There is no unique index on `batch_tag` to stop it.

No live duplicates exist, because the prompt tasks were cleared by hand on 2026-09-06 for a
different reason. That is luck, not correctness.

**`checklist` inherits this exactly.** One task tagged `prompt:<runId>` would be inserted
twice by a retried run's second done-pass. So this is not a bug to note and route around; it
is a prerequisite.

### One decision instead of two functions

The fix is not to re-thread `unitIds`. `emitTasks` already reads the matter's existing
prompt tasks *before* inserting anything — that ordering was added deliberately, and it
means the snapshot can never contain rows the call itself just wrote. Given that, the
run-id exclusion in `tasksToSupersede` is guarding against a problem the read-ordering
already solved, and removing it lets one function answer the whole question:

> Of this tool's own open, unassigned tasks on this matter, which already say exactly what
> this run now wants to say? Keep those. Insert what is missing. Withdraw the rest.

Identity is by content — tag, title, description, priority, type and the checklist items'
**text**. A retried unit whose rationale changed is superseded and re-inserted; a unit the
retry never touched matches its existing task exactly and is left alone, keeping its id and
its `created_at`. A second done-pass over an unchanged run inserts nothing and withdraws
nothing. Both tag shapes fall out of this without either being special-cased, and
`tasksToSupersede` and `tasksToSupersedeForUnits` both collapse into it.

**An item's `done` flag is deliberately *not* part of that comparison, and the first draft
of this design had it backwards.** The argument for including it was that a ticked checklist
differs from the freshly-built one, so the tick should be "a withdrawal rather than a silent
rewrite of someone's progress". That is a false choice: `planEmit` has no rewrite branch —
it only inserts and archives. So including `done` means a partly-ticked checklist stops
matching, gets **archived**, and is replaced by a blank copy; the attorney's progress leaves
the working queue. Excluding it means the keys match, the task is **kept untouched**, and
the ticks survive with the row's id and `created_at`.

Nothing is lost by excluding it. If the findings genuinely changed, the rationales in the
description changed with them, so the key mismatches anyway and the task is superseded on
its merits. `done` only ever differs when a *person* changed it, which is precisely the case
that must not trigger a withdrawal. This is reachable, not theoretical: toggling one item
leaves the task `open` and unassigned (only all-items-done promotes it), so a partly-ticked
prompt checklist is a live candidate every time the tick re-emits.

It also self-heals: a duplicate pair left by the current bug has only one twin among the
desired rows, so the other is withdrawn.

### What this does not fix, named

Superseding is scoped to `source = 'prompt'` and the matter — **not to the prompt**. Two
prompts emitting tasks on one matter would each withdraw the other's on every run. That is
true of the code today and stays true after this change; it is invisible now only because
one prompt emits tasks and the review prompt does not. The 40-prompt library makes it
certain, and the fix means changing the tag shape a third time to carry the prompt, which
deserves its own decision rather than being folded in here.

## The tasks render as a blank pill in the app that shows them

The workbench never reads `tasks` — it only writes them. The root app is the only place an
attorney sees them, and there `TASK_SOURCES` in `lib/tasks/types.ts` is
`['manual', 'stage', 'template', 'cadence', 'sla']`. `'prompt'` was added to the database's
`tasks_source_check` in #410 and never to the TypeScript union.

So `TASK_SOURCE_LABEL['prompt']` and `TASK_SOURCE_PILL['prompt']` are both `undefined`, and
`TaskSourcePill` renders an **empty, unstyled chip**. The source filter has no Prompt
option. Every task this feature has ever created shows up unlabelled in the one place it is
read.

This belongs in this slice rather than a later one: a slice about what a run produces cannot
leave its output unreadable. Adding `'prompt'` to the union is enough — it is consumed only
by the two filter dropdowns and `tests/task-pill-contrast.test.ts`, which iterates
`TASK_SOURCES` and so covers the new pill automatically. Task creation in
`app/api/admin/tasks/route.ts` hard-codes `'template' | 'cadence' | 'manual'`, so this
cannot let anyone hand-create a prompt task.

`bg-amber-bg text-amber` measures 6.84:1 light and 8.48:1 dark — checked against the theme
tokens, not chosen by eye — and no other source pill uses amber.

## Testing

- Pure functions tested directly: the body schema accepting each target and refusing an unimplemented one; the checklist rows built from findings; superseding across both tag shapes.
- **A `chat` prompt creates no tasks**, asserted rather than assumed — this is the target whose whole content is an absence.
- **A `checklist` run with no actionable findings creates no task**, not an empty one.
- **A retried run's second done-pass creates no duplicate** — asserted for both a `task_set` run and a `checklist` run, since this is the regression the slice is built on top of. The reverse too: a retried unit whose rationale changed *is* replaced, and an untouched unit keeps its existing task id.
- **A checklist someone has partly ticked is kept, not archived and replaced.** The test asserts the ticks survive a re-emit — the behaviour the first draft of this design got backwards.
- **A duplicate pair left by the current bug is self-healed** rather than preserved.
- **A `'prompt'` task renders a labelled, AA-contrast pill** in both themes — the existing contrast test covers it once the union admits it, plus an assertion that the label and pill entries exist at all, which is the thing that was missing.
- A real run of version 4 against a real matter, reported before this is called done: one task, its items, and the previous run's tasks superseded correctly.

## Out of scope, named

`draft_doc` and `email_draft`, and with them the questions they carry: R2 write access for
the workbench, a document-creation path outside the root app's drafting engine, an email
surface, and above all what verifies generated prose when there is no source to check it
against. That last question is the reason they are not in this slice, and it should be
answered before either is built rather than during.
