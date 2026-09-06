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

## Superseding has to learn a second shape

This is the interaction worth naming, because it is where a careless change would break
something that already works.

Tasks carry `batch_tag` as `prompt:<runId>#<unitId>` — the unit suffix added in #411 so a
retry could replace one unit's task without touching another's. A `checklist` run produces
**one task for the whole run**, so there is no single unit it belongs to. Its tag is
`prompt:<runId>` with no suffix, and superseding it is per-run rather than per-unit.

Both shapes must work at once, because a prompt's target can change between versions and
runs of both kinds will coexist on a matter.

Checked rather than assumed, and the groundwork is further along than it looked:
`parseBatchTag` already exists in `lib/fieldAudit/tasks.ts`, and its regex —
`^prompt:([^#]+)(?:#(.+))?$` — **already makes the suffix optional**, returning a null
`unitId` for a tag without one. So the discriminator is there; it is private to the module
rather than exported, which is the only thing to settle.

`tasks.task_type` was the other claim worth checking, because assuming a CHECK constraint
admits a value is a mistake already made once on this branch — `status: 'skipped'` turned
out not to be allowed on the unified `tasks` table. Here it holds:
`20260729132012_unified_tasks.sql` declares `check (task_type in ('single', 'checklist'))`,
so `checklist` needs no migration.

The protections do not change: a task that is assigned, or whose status is not `open`, is
never touched.

## Testing

- Pure functions tested directly: the body schema accepting each target and refusing an unimplemented one; the checklist rows built from findings; superseding across both tag shapes.
- **A `chat` prompt creates no tasks**, asserted rather than assumed — this is the target whose whole content is an absence.
- **A `checklist` run with no actionable findings creates no task**, not an empty one.
- **A retry of a `task_set` run still replaces only its own unit's task** while a `checklist` run's task is superseded per run — the two shapes proven not to interfere.
- A real run of version 4 against a real matter, reported before this is called done: one task, its items, and the previous run's tasks superseded correctly.

## Out of scope, named

`draft_doc` and `email_draft`, and with them the questions they carry: R2 write access for
the workbench, a document-creation path outside the root app's drafting engine, an email
surface, and above all what verifies generated prose when there is no source to check it
against. That last question is the reason they are not in this slice, and it should be
answered before either is built rather than during.
