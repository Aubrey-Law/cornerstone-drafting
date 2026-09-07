# Fiduciary gaps become tasks — phase 4, eighth slice

**Date:** 2026-09-07
**Phase:** 4 of `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, eighth sub-project
**Follows:** `2026-09-06-prompt-scoping-design.md`
**Status:** direction approved by the owner 2026-09-07

## What this is, and what it replaced

The owner asked for a second task-emitting prompt. Investigating the subject found that
four of the five checks proposed for it **already exist deterministically** —
`matrixIssues` in `lib/fiduciary/matrix.ts` emits `no_successor`, `no_guardian`,
`concentrated` and `duplicate` — and that the design-sheet audit's own seed migration had
already excluded exactly those, on a principle worth quoting:

> The fiduciary matrix already finds a fiduciary appointment with no successor
> deterministically — and found 14 of 33 chains in live data doing exactly that — so this
> prompt has no check for it: two sources of truth for one question is worse than one.
> […] coding six of those here would prove only that a model can do `if`, while paying
> model prices for the privilege.

So the prompt was the wrong build. What the same investigation found is the right one:
**those findings never become tasks.** `matrixIssues` is called in two places, both page
renders, and there is no task write anywhere in `lib/fiduciary/`. A recorded 14 of 33
chains with no successor sit on a screen someone has to remember to open, rather than in
the queue they work from.

This slice does not exercise the #419 cross-prompt property, which stays proven by tests
alone. That was the prompt's secondary motive and it does not survive the change of
direction — stated here so nobody later reads this as having covered it.

## An issue needs an identity before it can be a task

`MatrixIssue` is `{kind, severity, message}`, and the message embeds people's names —
*"Trustee for the client has no successor. If Jane Smith cannot serve…"*. Keyed off that,
renaming a contact would read as a new issue: the old task orphaned, a duplicate created,
and the attorney's place in it lost.

`role` and `forParty` are already in scope where each issue is built and simply not carried
out. So `MatrixIssue` gains both, and the task's `batch_tag` becomes
`fiduciary:<matterId>#<kind>:<role>:<forParty>` — stable across a rename, and one task per
gap rather than per phrasing of it.

`concentrated` carries no role, being about a person rather than a chain. It is also the one
issue that never becomes a task, so it never needs a tag — but the type must still admit it,
so `role` and `forParty` are nullable and the emitter refuses to build a tag without them.

## Only `error` and `gap` become tasks

The three severities exist for a reason the matrix states plainly: `error` is a
contradiction in the record, `gap` is a real hole that shows itself when someone cannot
serve, and `note` is a shape worth seeing that is not wrong at all — *"a spouse holding
every office is the normal design of a plan, and calling it a fault would teach the reader
to ignore this list."*

A `note` that became a task would do precisely that, at the cost of the attorney's trust in
the whole queue. So the gate is severity, and it is the same shape as `actionableFindings`:
the thing that decides whether a finding may act, expressed once.

## Withdrawal, and the one way this differs from a prompt

An issue absent from the current matrix means the gap is filled, so its task retires. That
is straightforward here in a way it was not for prompts: the matrix is deterministic, so
there is no third state — no finding it "sees but cannot cite", which is what made #418
necessary.

**But there is still a way to be wrong, and it is the same shape.** If the appointments
cannot be loaded — a query fails, or `contact_roles` returns nothing for a matter that has
appointments — that is not "no gaps", it is "could not tell". Retiring on it would repeat
#418's defect against a different data source. So a matter whose appointments fail to load
is skipped entirely: no insert, no withdrawal.

Withdrawal is scoped to `source = 'fiduciary'` and to the matter, and it inherits the three
narrowing axes unchanged — only open, unassigned, tool-created tasks are ever touched. A
task someone has picked up is theirs.

## A new task source, and the lesson from last time

`tasks.source` gains `'fiduciary'`: a migration for the check constraint, **and** the root
app's `TASK_SOURCES`, `TASK_SOURCE_LABEL` and `TASK_SOURCE_PILL`.

That second half is the whole lesson of #417. `'prompt'` was added to the database
constraint and never to the TypeScript union, so every task the field audit ever created
rendered as an empty, unstyled chip with no filter option — in the only app that displays
tasks. The pill colour is measured against the theme tokens rather than picked, because
`tests/task-pill-contrast.test.ts` iterates `TASK_SOURCES` and will hold the new entry to
AA in both themes.

## When it runs

In the cron tick, sweeping every matter with appointments, each tick.

No queue table and no trigger, unlike `prompt_stage_triggers` — and the reason is that this
costs nothing a queue would save. `loadFiduciaries` is four queries regardless of how many
matters there are, `matrixIssues` is pure, and there is no model call anywhere in this
slice. Against 44 sheets and 33 chains a full sweep is cheaper than the machinery to avoid
one, and it self-heals within a minute: a gap filled at 10:00 has its task retired by 10:01
without anyone triggering anything.

Writes stay rare because the plan is computed by content identity first — an unchanged
matter produces no insert and no update at all.

## Not shared with the prompt emitter, deliberately

`planEmit` and this share a shape: content identity, the three narrowing axes,
keep/insert/supersede. They are not being unified.

Two instances do not justify the abstraction, and `planEmit` in particular has just
absorbed three separate bug fixes across #417, #418 and #419 — the retry duplicate, the
uncitable-finding withdrawal, and the cross-prompt erasure. Generalising code that recently
needed that much correction would put both callers behind one seam nobody has run twice.
If a third emitter appears, extract then, with three real cases to design against instead
of two.

## Testing

- Pure: only `error` and `gap` become rows; a `note` never does; the tag is stable across a
  rename; an issue with no role is refused rather than tagged with `undefined`.
- A matter whose appointments fail to load is skipped — no insert **and** no withdrawal.
  This is #418's lesson re-asserted against a different source, and it is the test to write
  first.
- A gap that has been filled retires its task; a gap that persists keeps it, id and
  `created_at` intact, so the attorney's place in it survives every sweep.
- The three narrowing axes, asserted directly: assigned, non-open, and other-source tasks
  are never touched.
- **The new pill is labelled and AA-contrast in both themes**, plus the totality assertion
  over the maps — the check that would have caught `'prompt'` shipping blank.
- A real sweep against production, reporting how many matters have gaps, how many tasks were
  created, and one matter's tasks named by kind and role.

## Out of scope, named

**A second task-emitting prompt.** Still unbuilt, so #419's coexistence property is still
proven by tests only. A model-shaped subject was identified while investigating — whether
the attorney's own `drafting_notes` contradict the structured decisions recorded beside
them, which is free text against structure and so genuinely not a deterministic check — and
it is the obvious candidate when that slice is wanted.

**Unifying the two task emitters.** Deferred with reasons, above.

**The verification drift** on the design-sheet audit. Unrelated to this slice and still
unexplained after four runs.
