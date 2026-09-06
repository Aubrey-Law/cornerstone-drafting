# Run steps and retry — phase 4, second slice

**Date:** 2026-09-05
**Phase:** 4 of `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, second sub-project
**Follows:** `2026-09-05-prompt-engine-field-audit-design.md`
**Status:** design approved by the owner 2026-09-05

## Why this slice, and what it deliberately does not build

The plan names "run/step/finding tables with per-step fail-soft, tick route, reaper,
Realtime progress" as one piece. Measured against what exists, most of that is not yet
earning its place.

A unit of work — one rule against a document, one check against a matter — takes roughly
ten seconds including verification. `maxDuration` is 300 seconds on both the review route
and the prompts page, so about thirty units fit in one invocation. Today's playbook is
three rules and the audit is six checks. **Runs fit, comfortably.** A forty-prompt library
will not, and that is a real future constraint — but a queue whose failure modes nothing
exercises is infrastructure that cannot be verified until the load exists.

What is costly *today* is different, and it is not timeouts. A run that loses one unit of
forty currently has one remedy: run all forty again. That re-pays for thirty-nine
successful model calls to fix one failure, and it discards work that was correct.

So this slice records what each unit did, and makes retry surgical. The steps table is
also precisely what a queue would later drive, so async becomes a wiring job rather than a
rewrite.

**Not built here:** the queue, the tick route, the reaper, Realtime progress, and automatic
retry. **Retry is manual only** — owner's decision, 2026-09-05. A failed unit usually means
a model or network problem worth a person seeing, and a tool that quietly retries hides
the rate this project measures itself by.

## Schema

### `workflow_run_steps`

One row per unit, which is what makes retry surgical rather than wholesale.

- `id`, `run_id uuid not null references workflow_runs(id) on delete cascade`
- `unit_id text not null` — the rule number or check number, matching `workflow_findings.rule_number`
- `sequence integer not null` — the order the unit ran in, so a run reads in playbook order rather than completion order
- `status text not null check (status in ('pending','running','succeeded','failed'))`
- `attempts integer not null default 0`
- `last_error text`
- `started_at timestamptz`, `finished_at timestamptz`
- `finding_id uuid references workflow_findings(id) on delete set null` — what this step produced
- `unique (run_id, unit_id)`

### `workflow_runs.resolved_inputs jsonb`

The evidence a field-audit run saw, pinned.

The review path already does this and has from the start: `text_layer_id` fixes the exact
extracted text, so a citation's character offsets always index the text they were measured
against. A field audit has had no equivalent — it read `design_sheets` live.

That gap only becomes visible with retry. Retrying a step an hour later, against a sheet
the attorney has since edited, would produce a run holding check 1 judged on one version of
the matter and check 3 on another, with nothing on either finding saying so. Findings
sitting side by side would be answers to different questions.

So the resolved values are stored on the run, and **retry replays from this column and
never re-reads `design_sheets`**. A fresh run is how you audit the current sheet.

## Status derives from the steps

`runStatusFor` (review) and `runStatusForAudit` (field audit) already disagree: given zero
findings and zero failures, the first returns `failed` and the second `completed`. Neither
is reachable today, which is exactly why the divergence went unnoticed — two functions
computing the same thing differently, and nothing making them agree.

With steps there is one obvious source: `completed` when every step succeeded, `partial`
when some succeeded and some failed, `failed` when none succeeded. One function over the
step rows replaces both, and the existing
`workflow_runs_status_matches_failures` constraint continues to hold it honest at the
database.

## The engine

`RunPromptDependencies` gains one optional member:

```
onUnitSettled?: (unitId: string, outcome: { ok: true } | { ok: false; reason: string }) => Promise<void>
```

`runPrompt` calls it as each unit resolves. Persistence stays out of `packages/citations`
— the package still knows nothing about Supabase — while a run that dies halfway leaves a
record of how far it got instead of vanishing.

Retry needs no engine change at all. The caller passes only the failed units, which is
what the seam already accepts.

Both kinds get steps, because the engine is shared. The review's pinned evidence is its
`text_layer_id`; the audit's is `resolved_inputs`.

### The run row has to exist before the engine starts

Today both paths run the engine to completion and *then* insert everything — run,
findings, citations — in one pass at the end. A step written as its unit settles has no
`run_id` to reference under that order, so the order has to change:

1. Insert the run as `running`, with its pinned evidence and its `prompt_version_id`.
2. Run the engine, writing each step as it settles.
3. Store the findings, link each to its step, and finalise the run's status and counts.

This is better independently of retry. A run that dies mid-flight currently leaves nothing
at all — the work is lost and so is any evidence of why. Under this order it leaves a
`running` row with the steps that got as far as settling, which is the difference between
a failure you can look at and one you can only infer.

`finding_id` on a step is therefore linked in the third phase, not the second. A step is
recorded when its outcome is known; what it produced is attached when the findings are
written.

## Retry

`retryFailedSteps(client, runId)`:

1. Load the run, its `prompt_version_id`, its pinned evidence, and its steps.
2. Take the `failed` steps' `unit_id`s. If none, return unchanged rather than re-running anything.
3. Rebuild the prompt body from **the same `prompt_version_id`** — never the currently published version, which may have been edited since. A retry finishes the run it belongs to; it does not silently upgrade it.
4. Run only those units, against the pinned evidence.
5. Replace each retried step's previous finding, update the step, recompute the run's status and counts.

**Succeeded steps are never touched and never re-paid for.** That is the whole point.

### The destructive part, named

`workflow_findings` has `unique (run_id, rule_number)`. A retried unit that now produces a
finding would collide with the one its earlier attempt left behind, so retry **deletes the
step's previous finding** (cascading its citations and field references) before inserting
the new one.

This is a real delete of real rows. It is correct — the old finding is a superseded answer
to the same question, from the same run, and keeping both would make `unique` a lie — but
it is worth naming rather than discovering. It is scoped to the one unit being retried and
never touches another unit's work.

## Surfacing

The run page lists steps in `sequence` order with status, attempt count and `last_error`.

The retry control names what it will spend: *"Retry 3 failed checks"*, not "Retry". A
retry calls the model again and costs money, and a button that does not say so invites
being pressed without that being a decision.

Retry is disabled when no step is `failed`.

## Testing

- Pure functions tested directly: status from steps, which units a retry selects, the merge
  of retried results into an existing run.
- **Retry is proven not to re-run successful units** — the strongest property here, asserted
  against a scripted model caller that counts calls per unit.
- **Retry is proven to replay against pinned evidence**, by changing the underlying design
  sheet between the run and the retry and asserting the retried step saw the original
  values.
- Every new column checked against the live database by `scripts/checkDbColumns.mjs` and
  against the generated types by `query-columns.test.ts`.
- A real run with an induced failure, retried against the real database, reported before
  this is called done — the discipline the last slice's real run established.

## Out of scope, named so it is not silently dropped

The queue, the tick route, the reaper, Realtime progress, automatic retry, and any change
to `maxDuration`. When a playbook approaches thirty units, the steps table is the thing a
queue drives — that is the next conversation, and it should be had with a playbook that
actually needs it.
