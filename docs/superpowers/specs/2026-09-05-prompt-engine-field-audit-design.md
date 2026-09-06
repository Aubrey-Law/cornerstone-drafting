# Prompt objects and the run engine — first slice

**Date:** 2026-09-05
**Phase:** 4 of `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, first sub-project
**Status:** approved by the owner 2026-09-05; implementation plan next

## Why this slice

Phase 4 as written bundles five independently buildable subsystems: the prompt library
with versioning, typed inputs from the matter record, the generalised run engine with
per-step fail-soft, the five output targets, and stage-gated surfacing. Built as one unit
it would run for weeks with nothing verifiable in the middle.

This slice takes a vertical cut instead, and it is chosen to retire the largest risk
first. The Irys reframe rests on a claim nothing has tested: that of the ~40 prompts the
firm needs, almost none is a rule ladder. Every line of the review path assumes a
document to cite. If the prompt object cannot hold a prompt that reads no document at
all, the abstraction is wrong, and it is better to learn that from one prompt than from
thirty-nine.

So: prompts move into the database with versioning, the existing review playbook migrates
into them unchanged, and one genuinely different prompt — a design-sheet issue spotter
whose findings become tasks — runs end to end beside it.

This is the same shape as the phase 3 citation slice, which gated the product on one
question answered against real instruments rather than on a plan.

## What already exists

More than the plan assumes, which is why this slice is smaller than phase 4 sounds:

- `workflow_runs`, `workflow_findings`, `workflow_citations`, `document_text_layers` are
  live (migrations `20261027000000` and earlier).
- `workflow_jobs` is a working queue with `dedupe_key`, attempts and locking.
- `design_sheets` holds 110 columns of answered matter facts.
- `lib/stage-engine/` and `stage_tasks` are built; `tasks` is the mature 58-column system.
- `packages/citations` holds the text layer, the verifier, `runReview`, and the model
  caller with tool-forced output and prompt caching.

Missing: any `prompts` table, and anything that is not a rule-ladder review.

## Schema

### New tables, one migration

Following the immutability idiom from `20260715210000_estate_clause_library.sql`:
subject → immutable versions with a content hash → publication pointer with a composite
foreign key.

- **`prompts`** — `slug` unique, `title`, `kind ∈ (review|field_audit)`, `stages text[]`,
  `matter_types text[]`, `is_system boolean`, `UNIQUE (id, kind)`.
- **`prompt_versions`** — `prompt_id`, `kind`, `version_number`, `body jsonb`,
  `content_hash text CHECK (content_hash ~ '^[0-9a-f]{64}$')`, `change_summary`,
  `validation_status`, `created_by`. `UNIQUE (prompt_id, version_number)` and
  `FOREIGN KEY (prompt_id, kind) REFERENCES prompts(id, kind)`.
- **`prompt_publications`** — `prompt_id` primary key so there is exactly one current
  version, `version_id`, composite FKs to both parents.

The composite key is the point of the idiom: a review prompt can never acquire a
field-audit body, enforced by the database rather than by care.

### Changes to existing tables

- `workflow_runs` gains `prompt_version_id uuid REFERENCES prompt_versions(id)`.
- `workflow_runs` gains `kind text NOT NULL`, denormalised from the prompt. A check
  constraint cannot join, and the constraint below is the one that has to hold, so the
  discriminator lives on the row it constrains. `prompt_versions.kind` remains the source
  of truth; a trigger keeps the two in step on insert.
- `workflow_runs.document_version_id` becomes nullable, with
  `CHECK (kind <> 'review' OR (document_version_id IS NOT NULL AND text_layer_id IS NOT NULL))`.
  A review run without a document is still a bug; a field audit without one is normal.
- `playbook_slug` and `playbook_version` are dropped, replaced by the foreign key.

**Assumption to verify before writing the migration:** `workflow_runs` is empty. Today's
probe returned zero recorded runs, which makes these column changes free. If rows exist
when the migration is written, they are backfilled rather than dropped. Migration history
is not evidence either way — check the table.

### References: two narrow tables, not one wide one

`workflow_citations` stays exactly as it is: offsets verified against a text layer.

**`workflow_field_references`** is new — `finding_id`, `field_key`, `claimed_value`,
`actual_value`, `verification ∈ (verified|unverified|stale)`.

One table holding both would be half-null in every row and would have to describe two
unrelated checks in one set of columns. The verification *rule* is shared; the evidence
is not.

## The prompt body

Zod, discriminated on `kind`, validated at publish time.

The `review` arm is today's `reviewPlaybookSchema` **unchanged** — `number`, `statement`,
`risk`, optional `preferredLanguage` — which makes migrating `ma-trust-firm-qa.json`
lossless and keeps the phase 3 evidence valid.

That migration is concrete, and it removes things: the migration inserts the playbook as
`prompts` + `prompt_versions` + `prompt_publications` rows, `lib/review/playbook.ts`
starts reading the published version from the database, and both
`tools/workflows/review/ma-trust-firm-qa.json` and the bundled module import that
replaced the filesystem read in #397 are deleted. The `content_hash` of the inserted
version is asserted in a test against the hash of the JSON as it stands at migration
time, so "unchanged" is checked rather than claimed.

The `field_audit` arm carries `checks[]`:

```
{
  number: string
  statement: string        // the firm's position, in prose
  risk: 'blocker' | 'high' | 'medium' | 'low'
  reads: string[]          // the design-sheet fields this check may consult
  taskTemplate: { title, description, priority }
}
```

Both arms carry `inputs[]` — `{ key, source, required }` — where `source` is a dotted
path such as `design_sheet.concerns`.

## Input resolution

`resolveInputs(readers, declarations)` is pure, with injected readers, following the
pattern that has kept TS2589 out of `lib/auth/session.ts` and `lib/supabase/roles.ts`.

Every `source` must appear in an allow-list mapping dotted path → (table, column), and
that mapping is checked **when a version is published, not when a run starts**. An
unknown path is a validation failure on the version, visible to whoever wrote it, rather
than a mystery in a run at midnight.

A missing required input makes the run refuse and name the field. It never asks the model
to proceed without it — a plan reviewed against facts that were not supplied is worse
than no review, because it reads the same.

## Verification — the quality bar, carried across

The review path's rule is that a citation is checked against the document or it never
ships. The field audit inherits it exactly.

Each finding must carry field references. Each reference is re-read from the design sheet
and compared with what the model claimed. A mismatch is stored `unverified` with the
actual value recorded — the role `attemptedQuote` plays today, and for the same reason:
the share of references that survive verification is the measure this design is judged
by, and the response to a poor one is to change the prompting, **never** to loosen the
verifier.

**Only verified evidence becomes a task — revised 2026-09-06.**

As first built, a finding needed *every* reference verified. Three runs of the same six
checks against the same matter verified 19, 18 and 17 of 19 references, the outcomes
identical each time and the drift always on the jsonb array fields, where a model phrases a
claim about `children` or `assets` differently run to run.

Under that rule a blocker — "a person named in the notes is missing from the plan" — had
three of its four references check out and produced no task at all. A finding supported
three ways out of four is not an unsupported claim, and dropping it silently is the worse
error, because the attorney never learns it was found.

The rule is now **at least one verified reference**. The owner decided this on 2026-09-06,
after the rate had been measured rather than guessed at.

The verifier did not move. An unverified claim is still refused as evidence, still stored
with what the field actually held, and still counted in the rate this design is judged by;
the unverified references travel with the finding and the run view shows each one's status,
so what a task rests on stays visible. What changed is only how much checked support a
finding needs before it is worth a person's time.

### A limit found while building it, 2026-09-05

Several allow-listed fields are `jsonb` arrays of objects — `children`, `assets`,
`specific_bequests`, `disinheritances`. Comparing a claim against the whole value would
have required the model to reproduce the exact serialised JSON, which no model producing a
natural-language claim will do, so those fields would have been effectively uncitable —
and four of the six checks read them.

A claim is therefore verified when it matches a scalar **leaf inside** the structure, which
is what `verifyQuote` already does for documents: the model is not asked to reproduce the
source, only to point at something really in it.

That has a cost, and it was found by constructing the case rather than reasoning about it.
A leaf carries no memory of the object it came from, so a claim of "Ana was born
2018-04-02" verifies when that date is really in `children` but belongs to Daniel. The
verifier cannot catch a misattribution of this kind.

No structural matcher was built for it. There is no real data yet to say whether it bites,
and a matcher designed against an imagined failure is the speculative building this plan
warns against. Instead the reference records `matchedPath` — `children[0].dob` — the way a
document citation records its block and span, so the attorney reading a finding can see
which fact it rests on. **Whether misattribution actually occurs is a question for the real
run in the plan's last task**, and the answer belongs in the prompt, never in the verifier.

## Output

`emitTasks` writes `tasks` rows with `source: 'prompt'`, `task_type: 'single'`,
`auto: true`, `batch_tag: 'prompt:<runId>'` — following the `source: 'stage'` convention
`lib/stage-engine/fireStageTasks.ts` already uses.

Re-running supersedes rather than duplicates. Open, untouched tasks from a previous run of
the same prompt on the same matter are closed with a `closeout_reason` naming the new run.
A task that has been edited, assigned, or completed is never touched — the tool may
withdraw its own suggestion, never a person's work.

## The six checks

Drafted for the owner's review. They are deliberately **not** deterministic field
comparisons.

`staggered_distributions` set with `distribution_age` null is a boolean test; six of those
would prove only that a model can do `if`. Worse, it would smuggle in the "compute it in
code" approach that was considered and not chosen, while paying a model to do it.

What a model can do and a checker cannot is read **free text against structured
decisions** — the client's own words in `concerns`, `goals_notes`, `drafting_notes`,
`disinheritances` and `specific_bequests`, held against the fields that will actually
drive the drafting. Every check below is of that shape, and every one is a real
Massachusetts exposure.

| # | Check | Reads | Risk |
|---|---|---|---|
| 1 | A stated concern the plan does not answer | `concerns`, `goals_notes` + residuary, trust and fiduciary decisions | blocker |
| 2 | A person named in free text but absent from the structure — a child or beneficiary who appears nowhere in the decisions | `concerns`, `goals_notes`, `drafting_notes`, `children` + beneficiary and fiduciary fields | blocker |
| 3 | A specific bequest of an asset the asset list does not contain | `specific_bequests`, `assets` | high |
| 4 | A disinheritance the residuary contradicts, or one with no stated reason — MUPC c. 190B §2‑302 invites a pretermitted-heir claim where an omission looks accidental | `disinheritances`, `residuary_beneficiary`, `residual_beneficiary_individuals` | high |
| 5 | A non-citizen spouse with no QDOT — IRC §2056(d) denies the marital deduction outright, and `spouse_citizenship` is free text where "green card", "permanent resident" and "not a citizen" all appear | `spouse_citizenship`, `include_qdot`, `marital_trust_type` | blocker |
| 6 | Real property in the assets with no transfer decision, or property outside Massachusetts with no ancillary plan — a trust that does not hold the house is the failure the funding tracker exists to catch, one stage earlier | `assets`, `real_property_transfer`, `state`, `client_domicile` | high |

Check 6 also derives `out_of_state_property`, one of the three matter facts the plan notes
are missing, from the asset list rather than adding a field.

**Deliberately excluded:** a check for a fiduciary named with no successor. The fiduciary
matrix already finds that deterministically against `contact_roles`, and it found 14 of 33
chains in live data. Two sources of truth for one question is worse than one.

## Surfacing

A new `/prompts` route, listing prompts filtered by `matter_types` and the matter's
current `stage`. `/review` is left alone: it is live, verified against real instruments,
and its job is unchanged.

The result view reuses the findings workspace, with created tasks listed and linked.

## Engine shape

One `runPrompt`. Three seams, named for what actually differs and nothing more:

- **`unitsFor`** — what one unit of work is. Review: rule × document. Field audit: check ×
  matter.
- **`verifyReference`** — what a reference points at. Review: offsets in a text layer.
  Field audit: a design-sheet field.
- **`emitOutput`** — what a finding becomes. Review: nothing. Field audit: a task.

Everything else — input resolution, the model call with tool-forced output and prompt
caching, run recording, fail-soft, disposition — is shared and kind-blind.

Three seams from two examples is a guess, and it is made deliberately rather than
avoided: the alternative, two engines side by side, cannot answer the question this slice
exists to answer. The seams are narrow enough to collapse if the third kind disagrees.

## Testing

- Pure functions tested directly: input resolution, reference verification, task
  superseding, body validation, the publish-time source allow-list.
- The new tables are covered automatically by `scripts/checkDbColumns.mjs` and
  `apps/workbench/tests/query-columns.test.ts`, which check every queried column against
  the live database and the generated types.
- **No fixture asserts a column name that is not in the generated types.** Five features
  shipped in September reading `matters.title`, a column that has never existed, because
  every fixture encoded the same wrong assumption.
- **A real run against a real matter's design sheet, reported to the owner before this is
  called done.** The phase 3 discipline: the check no test can stand in for. The number
  that matters is the share of field references that survive verification.

## Out of scope, named so it is not silently dropped

- `workflow_run_steps`, per-step retry, the tick route, the reaper, Realtime progress —
  the next sub-project.
- Stage-triggered automatic runs — the one after that.
- The `draft_doc`, `email_draft` and `chat` output targets.
- The authoring UI and the ~40-prompt library (phase 14). `Cornerstone_Scope.md` is not in
  this repository; the six checks above are drafted here rather than seeded from it.

## Owner decisions, 2026-09-05

1. **The six checks are approved as drafted.** All six raise tasks.
2. **Check 1 stays at `blocker`.** It was offered at `high` on the argument that it is the
   broadest and will be the noisiest. Rejected: a stated concern the plan does not answer
   is the failure the whole check set exists to catch, and grading it down to manage its
   own noise would hide exactly the finding worth having.

   The consequence is that its noise has to be managed by **prompting and reference
   verification, not by severity** — the same rule the citation verifier follows. If check
   1 produces findings whose field references do not survive verification, the fix is the
   prompt, never the threshold.
