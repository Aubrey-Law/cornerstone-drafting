# Prompt-scoped withdrawal — phase 4, seventh slice

**Date:** 2026-09-06
**Phase:** 4 of `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, seventh sub-project
**Follows:** `2026-09-06-withdrawal-scoping-design.md`
**Status:** design approved by the owner 2026-09-06

## What is wrong

`emitTasks` loads every task on the matter with `source = 'prompt'`, and `planEmit` may
retire any of them. Nothing anywhere asks **which prompt** a candidate came from.

So two prompts that both emit tasks on one matter would each withdraw the other's on every
run. The design audit's checklist would vanish the moment a funding-review prompt ran, and
the funding review's would vanish the moment the audit ran next.

**Invisible today, and only by accident.** Two prompts exist; the review playbook produces
findings on a page and emits no tasks, so exactly one prompt writes to `tasks`. The
40-prompt library the queue was built for makes this certain rather than likely, and it
fails in the same direction as the last two defects: work disappearing without anybody
choosing to remove it.

## The fix is a relationship, not a third tag shape

The obvious move is to put the prompt into the `batch_tag` — `prompt:<slug>:<runId>#<unit>`.
That is rejected.

`batch_tag` has already changed shape twice: `prompt:<runId>` gained a `#<unitId>` suffix in
#411, and #417 added a run-level form that deliberately has no suffix. Two shapes are already
parsed in one place, and each change has cost rows already written, a parser, and a migration
of understanding for whoever reads a tag next.

The relationship the scoping needs **already exists and is authoritative**:
`workflow_runs.prompt_version_id` → `prompt_versions.prompt_id`. A run knows its prompt. The
tag is provenance a person can read; the database is what the decision should turn on.

So `emitTasks` resolves each candidate task's run to its prompt, and considers only the
candidates belonging to the prompt this run is for. No new tag shape, no backfill, and no
legacy form to special-case.

### Scoped by prompt, not by prompt version

Version 4 of the design-sheet audit **should** retire version 3's tasks: same prompt, newer
answer to the same question. Scoping to the version would strand every task the moment a
prompt is republished, which is the failure this exists to prevent, aimed at a different
target.

### A candidate whose prompt cannot be resolved stands

A task whose run no longer exists, or whose tag does not parse, resolves to no prompt. It is
then **not** this run's to retire, and it stands.

That is the same discipline as the previous slice — withdraw only where you actually know —
and it fails in the safe direction. The cost is a task that can never be automatically
retired; the alternative is retiring rows we cannot account for, which is how a blocker went
missing last time.

## What it costs

Two extra plain queries per emit: the candidates' runs, and those runs' versions. Plain
selects rather than a PostgREST embedded select, because `scripts/lib/queryReferences.mjs`
cannot check columns through an embedded form — the same trade `loadPublishedPrompt` and
`lib/review/history.ts` already make deliberately.

Both are `in (…)` lookups over the ids of one matter's prompt tasks, which is a handful of
rows. The alternative — carrying the prompt in the tag — trades those queries for a third
tag shape, and this codebase has more appetite for a query than for another parse.

## Testing

- Pure: a candidate from another prompt is never retired, and never counted as a twin.
- A candidate from **the same prompt but an earlier version** *is* retired, which is what
  distinguishes prompt-scoping from version-scoping.
- A candidate whose run cannot be resolved stands, and a run's own freshly written rows are
  unaffected.
- **The whole point, asserted end to end:** two prompts emitting on one matter, run
  alternately, each keep their own task and neither touches the other's. Without the scoping
  this is the test that fails.
- Every guarantee of the previous two slices still holds: the three narrowing axes, content
  identity, the self-heal, and each clause of the retirement rule.

## Out of scope, named

**Why the model cites a check on one run and not the next.** Unrelated to scoping, still
unexplained, and still wanting more evidence than the three runs measured so far.

**Any change to `batch_tag`.** Named here so the next person can see it was considered and
declined rather than missed.
