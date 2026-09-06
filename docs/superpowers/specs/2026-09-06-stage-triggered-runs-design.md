# Stage-triggered runs — phase 4, fourth slice

**Date:** 2026-09-06
**Phase:** 4 of `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, fourth sub-project
**Follows:** `2026-09-06-run-queue-and-tick-design.md`
**Status:** design approved by the owner 2026-09-06

## What this is for

The plan's phrase is "stage transitions fire them". A prompt that only runs when someone
remembers to open `/prompts` and pick a matter is a prompt that runs on the matters someone
already suspected. Firing on a stage transition is what makes a forty-prompt library
something the firm's process applies rather than something an attorney has to think of.

## The trigger hangs off the data, not a route

A Postgres trigger on `matters`, `after update of stage`, inserting one row per prompt that
declares it fires on the stage being entered.

The alternative was extending `transition_matter_stage_with_jobs` or the root app's
`PATCH /api/admin/matters/[id]/stage`. Both work today and both couple the workbench to the
app **phase 15 deletes**. A trigger on the column fires whichever app wrote it, and keeps
firing when only one app is left.

It has to be a *signal* rather than a run. Creating a run means resolving a prompt's
declared inputs against the allow-list and writing a `pending` step per unit — app logic
with a zod schema behind it, not something to reimplement in plpgsql. So the trigger
records the intention and the tick turns it into a run.

### `prompt_stage_triggers`

- `matter_id`, `prompt_id`, `to_stage`, `stage_entered_at`
- `status ∈ (pending|claimed|done|skipped)`, `run_id`, `last_error`, timestamps
- `unique (matter_id, prompt_id, stage_entered_at)`

The uniqueness is the de-duplication: two writes of the same stage in the same transition
cannot fire twice, while a matter genuinely re-entering `drafting` a week later has a new
`stage_entered_at` and does re-audit. That is the behaviour worth having — a sheet that has
changed deserves a fresh look.

### Why it must be an AFTER trigger

The de-duplication key includes `stage_entered_at`, so the trigger has to see the *new*
timestamp. That value is not written by the caller: `trg_matters_stage_entered_at`
(migration `20260711000000`) is a **BEFORE UPDATE OF stage** trigger that sets
`NEW.stage_entered_at := NOW()` whenever the stage actually changes.

So an `after update of stage` trigger sees the new timestamp, and a `before` one would see
the old — silently reusing the previous entry's key, which would make the unique constraint
suppress the very re-audit it is meant to allow. Checked in the migration rather than
assumed, because the failure would look like "re-entering a stage does not re-run" and lead
someone to the wrong place entirely.

## What declares that a prompt fires

`prompts` gains `fires_on_stage_entry text[] not null default '{}'`. **Nothing auto-runs
unless it says so**, so adding this column changes nothing about the two prompts that
already exist until they are told to.

It is deliberately *not* the existing `stages` column. That one means "offer this prompt for
a matter at these stages". A forty-prompt library will certainly hold prompts worth offering
at a stage but not worth spending a model call on at every entry to it — a forty-rule review
among them. One column carrying both meanings is one that cannot express the difference.

**The design-sheet audit fires on entry to `design` and to `drafting`** — the owner's
decision, on the grounds that the sheet changes substantially between them and each entry
deserves its own look.

## The tick materialises a signal into a run

The tick route already reaps, then claims a queued run. It gains one step ahead of that:
claim a `pending` trigger — `for update skip locked`, the same idiom as `claim_workflow_run`
— resolve the prompt and its inputs, and open a run with its `pending` steps. From there the
existing machinery is untouched.

No second worker and no second cron. A trigger becomes a run, and a run is already something
this system knows how to finish.

**A trigger whose inputs cannot resolve is `skipped`, not a failed run.** A matter reaching
`drafting` with no design sheet, or with the required `concerns` field empty, is not a run
that failed — it is a run that should not have started. Recording that as `skipped` with the
reason keeps the failure count meaning what it says, and keeps `/prompts` from filling with
runs that never had a chance.

That decision lives in the tick, in app code, rather than in the trigger. The trigger stays
dumb on purpose: it knows a stage was entered and which prompts care, and nothing else.

## Advisory, never blocking

**The owner's decision, 2026-09-06, and the evidence is specific.** The plan says a stage
move should be blocked while a BLOCKER finding stands. Both version 1 and version 2 of the
design-sheet audit produced blocker-level **false positives** on a real matter — guardians
reported as missing from the plan that were recorded in `guardian_slots` all along. A hard
gate would have stopped a well-drafted matter from advancing on a wrong finding.

So a transition always succeeds. An unresolved blocker is surfaced, and declining to advance
stays the attorney's decision rather than the tool's.

"Unresolved" needs no new state: `workflow_findings.disposition` already carries
`open | accepted | rejected | deferred`, and `saveDisposition` already writes it. An
unresolved blocker is `severity = 'blocker'` with `disposition = 'open'`. Reusing that means
dispositioning a false positive is what clears it, which is the action that should clear it.

## Where the advisory appears, and the cost of that

`/prompts` gains a section listing matters with unresolved blocker findings, linking to the
run that raised each.

**This is knowingly the wrong place, accepted for now.** Stage transitions happen in the old
app's matter screens — that is where an attorney stands when they move a matter, and
therefore where an advisory would actually be read. Putting it there means building on
something phase 15 deletes; putting it in the workbench means it is not visible at the moment
it applies.

The owner chose the workbench "for now", which is the right staging call: phases 6 and 10
move matters into the workbench, and at that point the advisory belongs beside the stage
control. **Until then this surfaces a blocker to someone who has already moved the matter**,
and that limitation should be stated wherever the feature is described rather than
discovered.

## Testing

- Pure functions tested directly: which prompts a stage entry fires, whether a trigger is
  claimable, the skip decision when inputs cannot resolve.
- **The trigger is proven against the real database**, because it is a database object: update
  a matter's stage and confirm exactly one row appears per firing prompt, and that a second
  write of the same stage adds none.
- **A trigger with unresolvable inputs is proven to skip rather than create a failing run.**
- The advisory list is proven to ignore a blocker that has been dispositioned — otherwise
  dispositioning a false positive would not clear it, and the list would only ever grow.
- Every new column checked against the live database by `scripts/checkDbColumns.mjs` and the
  generated types by `query-columns.test.ts`; the new RPC by `checkDbRpcs.mjs`, which now
  scans the workbench.

## Out of scope, named

Blocking a transition, in any form. Firing on anything other than a stage entry — a document
filed, a date passing. Surfacing the advisory anywhere but `/prompts`. And any change to how
a run is executed, verified or dispositioned: this slice decides *when* a run starts and
*where* its blockers are seen, nothing else.
