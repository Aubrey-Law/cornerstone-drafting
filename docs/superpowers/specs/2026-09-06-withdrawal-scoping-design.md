# Withdrawal scoping — phase 4, sixth slice

**Date:** 2026-09-06
**Phase:** 4 of `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, sixth sub-project
**Follows:** `2026-09-06-output-targets-design.md`
**Status:** design approved by the owner 2026-09-06

## The failure this exists to fix, measured

Two back-to-back runs of `ma-design-sheet-audit` v4 against matter `e10908ee`, same prompt
version, unchanged design sheet:

| | check 1 outcome | field references | result |
| --- | --- | --- | --- |
| run `a2a4f300` | `blocker` / `deviation` | **4 verified** | one checklist task created |
| run `1c22acb5` | `blocker` / `deviation` | **0** | no task — and run 1's task archived |

Run 2 reached the *same* conclusion. Its rationale names the same empty fields in prose. It
simply emitted no structured references, so `actionableFindings` refused it — correctly; an
unverifiable claim must not act. But the withdrawal step ran anyway, archived run 1's task
as `prompt_superseded`, and left the matter with **zero** open prompt tasks. A blocker
verified against four design-sheet fields became invisible.

**Not caused by `planEmit` (#417).** The `tasksToSupersede` it replaced would have done the
same: run 2 has a different run id, so run 1's open unassigned task was fair game —
`created = 0, superseded = 1`. Pre-existing, and only a real run against real data exposed
it.

It also puts a number on the verification drift that has been unexplained since this feature
began: **4 references, then 0**, same check, same sheet, same prompt version. That drift used
to mean a finding quietly failed to appear. With tasks in play it means a finding that
already appeared quietly disappears, which is strictly worse.

## The error is that two different silences look identical

Per check, a run lands in one of three states. `FieldAuditOutcome` is
`compliant | deviation | absent | not_applicable`, and the gate is `(deviation | absent)`
with at least one verified reference.

- **cleared** — `compliant` or `not_applicable`. The run looked and says the check is fine.
- **actionable** — `deviation` or `absent` with a verified reference. It acts.
- **inconclusive** — `deviation` or `absent` with **no** verified reference, or the unit's
  step failed or never ran. The run sees a problem it cannot cite, or did not answer.

Today `inconclusive` is treated exactly like `cleared`, because both simply produce no task
row. But *cleared* is evidence of absence and *inconclusive* is absence of evidence, and only
the first is grounds for withdrawing someone's work.

That is the whole defect, and it is the one place in this feature where **not acting is
itself destructive**. Everywhere else the discipline "a claim is verified against its source
or it does not act" fails safe. Here, failing to act on a finding retires a standing one.

## The rule

A run may withdraw an earlier prompt task only in these cases. Otherwise the task stands.

**0. Replacement — either tag shape.** A desired row carries the candidate's exact
`batch_tag`. The run is not retiring the task on the strength of silence; it is rewriting its
own answer, which is what a retry does. Listed first because it is what stops a retry
inserting a second task beside the one it means to replace.

**Unit-suffixed tags** (`prompt:<runId>#<checkNumber>`, a `task_set` task):

1. This run answered that check **cleared**.
2. This run produced a desired row for that check under any run id — it is re-reporting the
   same problem, so the new row replaces the old one in substance.
3. This run is **authoritative** (below). This is what retires a task for a check the prompt
   version no longer contains.

**Run-level tags** (`prompt:<runId>`, a `checklist` task):

1. The desired items' text is a **superset** of the candidate's items' text — the new task
   already says everything the old one said. Item text is the check's `taskTemplate.title`,
   which is fixed by the prompt version, so it is stable across runs and this comparison is
   meaningful rather than incidental.
2. This run is **authoritative**.

**Authoritative** means every check in the run's own prompt version came back `cleared` or
`actionable` — no inconclusive check anywhere. A complete answer may retire prior work; a
partial one may only add to it.

### What this costs, stated plainly

An inconclusive run withdraws less, so a stale task can linger until some later run is a
complete answer. Given the measured drift that will happen. A stale task an attorney can
close is a far better failure than a real blocker nobody can see, and the superset clause
keeps the common case — a run that still reports the same check — from leaving two tasks
standing.

## Where the three states are computed

Beside `actionableFindings` in `packages/citations/src/fieldAudit/runFieldAudit.ts`, not in
the workbench. It is the same policy question from the other side — what a finding *licenses*
— and the two must not be able to disagree about what the gate means. A finding is actionable
there and inconclusive here for exactly one reason, expressed once.

`planEmit` gains the run's answers as an argument rather than deriving them, so it stays a
pure decision over data it is handed. `emitTasks` computes them from the findings and the
run's step statuses, and therefore has to receive **all** the findings rather than only the
actionable ones — which is the point: the withdrawal decision needs the outcomes the gate
throws away.

## Testing

- The three states asserted directly, including the two that currently collapse: a
  `deviation` with no verified reference is `inconclusive`, a `compliant` is `cleared`.
- A unit whose step failed is `inconclusive`, so a lost unit cannot retire its own task.
- **The measured failure, replayed as a test:** an existing checklist task with one item, a
  run whose only finding is a `deviation` with no verified reference — the task must stand.
  This is the regression test for the bug that motivated the slice, built from the real run's
  actual shape.
- The reverse: the same existing task against an authoritative all-cleared run — retired.
- A retry replacing its own task by exact tag inserts one row and leaves none behind, for
  both shapes, **while the run is inconclusive** — the case where clause 0 is the only thing
  preventing a duplicate.
- A run re-reporting the same check retires the older checklist by the superset clause rather
  than standing beside it.
- Every existing `planEmit` guarantee still holds: the three narrowing axes, content
  identity, and the duplicate self-heal.

## Out of scope, named

**Prompt-scoping the `batch_tag`.** Withdrawal is still scoped to the matter rather than the
prompt, so two task-emitting prompts on one matter would each withdraw the other's. Untouched
here and invisible today because only one prompt emits tasks; certain once the 40-prompt
library lands. It means changing the tag shape a third time and deserves its own decision.

**Why the model emits references for a check on one run and not the next.** This slice makes
the consequence safe. It does not explain the drift, and the drift is a prompting question
that wants more evidence than two runs.
