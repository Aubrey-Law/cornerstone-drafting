# A prompt that fires when the notes change — phase 4, ninth slice

**Date:** 2026-09-08
**Phase:** 4 of `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, ninth sub-project
**Follows:** `2026-09-07-fiduciary-tasks-design.md`
**Status:** direction approved by the owner 2026-09-08; **check substance needs the owner's sign-off before publication**

## Why stage entry is the wrong trigger for this prompt

The subject is whether the attorney's own `drafting_notes` contradict the structured
decisions recorded beside them. That is genuinely model-shaped work — free text against
structure, not a field comparison a deterministic checker could do — and it is distinct from
version 4 of the design-sheet audit, which reads the *client's* `concerns` against
provisions, and reads `drafting_notes` only to ask whether a *person* named there appears
somewhere.

But measured before building, the field will not support a stage-entry trigger:

| | populated |
| --- | --- |
| `drafting_notes` | **3 of 44 sheets** (194–499 chars) |
| `concerns` | 15 of 44 |
| `goals_notes` | 2 of 44 |

All three sheets with notes are on hired matters in `revision`, `drafts_approved` and
`client_review`. **None is in `design` or `drafting`** — the stages the audit fires on. The
6 hired matters currently in those stages have no notes at all.

So a prompt firing on entry to `drafting` would read a field nobody has written yet: skipped
for a missing required input, or six `not_applicable` findings and a model call to say
nothing. The pattern says drafting notes accumulate *during and after* drafting, which makes
stage entry not merely unlucky but structurally too early.

**So it fires when the notes change.** That is when the question becomes answerable, and it
is answerable on whatever stage the matter has reached.

## One trigger table, not two

`prompt_stage_triggers` already exists and works: a Postgres trigger on `matters` records
that a stage was entered, and the cron tick claims one pending row and materialises it into a
run. Its dedup key is `(matter_id, prompt_id, stage_entered_at)`.

A field trigger's natural key is `(matter_id, prompt_id, <the moment the notes changed>)` —
the same shape, the same `pending → claimed → done | skipped` lifecycle, and the same drain
path. Only the *cause* differs.

That is why this generalises the existing table rather than adding a second one, and the
distinction is worth stating because this project made the opposite call one slice ago.
`planFiduciaryEmit` was deliberately **not** merged with `planEmit`: those two answer the
same shape of question with genuinely different logic, over different sources, and one of
them had just absorbed three corrections. Here the logic is identical and only the input
differs. Two tables would mean two claim functions and two materialise call sites for one
idea.

### Additive, and deliberately not tidy

`to_stage` becomes nullable, `on_field text` is added, and a CHECK requires exactly one of
them. `stage_entered_at` keeps its name.

That last part is a trade, made knowingly. The column now holds either a stage's
`stage_entered_at` or a notes-changed timestamp, so its name is narrower than its meaning —
and this session has spent real effort fixing exactly that kind of stale name. But renaming
it means recreating the unique index that backs a live queue's de-duplication, for cosmetic
gain, on a path that is working. The column's comment is updated to say what it actually
holds. If the table gains a third trigger kind, rename then, when the name is wrong three
ways instead of one.

## What declares that a prompt watches a field

`prompts.fires_on_field_change text[] not null default '{}'`, mirroring
`fires_on_stage_entry`. **Nothing fires unless it says so**, so adding the column changes
nothing about the three prompts that already exist.

The values are allow-listed source keys, not arbitrary column names — the same discipline as
`SOURCE_ALLOW_LIST`. A prompt should not be able to watch a column by typing its name.

## The database trigger

On `design_sheets`, `after insert or update of drafting_notes`, `when` the value is
distinct from the old one — so re-saving a sheet without touching the notes fires nothing.

The dedup timestamp is the sheet's own `updated_at`, which the existing
`design_sheets` updated-at trigger sets. Two writes in one transaction cannot fire twice; a
genuine later edit has a new timestamp and does re-audit, which is the behaviour worth
having.

An insert counts as a change: a sheet created with notes already in it has notes worth
reading, and nothing else would ever notice.

## The checks

Drafted, **for the owner to confirm before publication**. Every statement is about a
contradiction between prose and a recorded decision — nothing asserts a statute, consistent
with v4's checks 1 to 4.

1. **blocker** — the notes instruct a distribution the structured residuary fields do not
   record. Reads `drafting_notes`, `residuary_beneficiary`,
   `residual_beneficiary_individuals`, `residuary_distribution`.
2. **high** — the notes name a trust or plan structure that `plan_type`, `trust_name` or
   `marital_trust_type` contradicts.
3. **high** — the notes instruct something about a fiduciary that the appointment fields do
   not reflect. Reads `drafting_notes` and the name-bearing fiduciary fields.
4. **normal** — the notes describe an asset or bequest treatment the asset list or specific
   bequests do not record.

Check 3 is the closest to v4's check 2 and the boundary is deliberate: v4 asks whether a
person *named* in free text appears in the structured decisions at all. This asks whether an
*instruction about* a fiduciary is reflected — a note saying the trustee should act only with
a co-trustee is not a missing person, and v4 would pass it.

**`drafting_notes` is a required input.** A prompt whose whole subject is that field has
nothing to say without it, and the existing skip path already handles this correctly: a
trigger whose inputs cannot resolve is recorded `skipped` with the reason, not run and not
failed. That was measured working on a real matter.

## What this finally exercises

The audit and this prompt both emit tasks, and both can have tasks on one matter. That makes
this the first real test of #419's cross-prompt withdrawal scoping, which has been proven by
tests alone since it shipped: each prompt must keep its own tasks and leave the other's
untouched.

It is a secondary motive, stated so it is not mistaken for the reason. If the subject were
not worth a model call, exercising a property would not make it so.

## Testing

- The trigger proven against the real database, because it is a database object: editing
  `drafting_notes` inserts exactly one row per watching prompt, and re-saving the sheet
  without changing them inserts none.
- A trigger whose `drafting_notes` is empty is `skipped`, not run — the required-input path.
- The seed migration gets a `describe` block following the convention every seeded version
  has: the body parses, every source is on the allow-list, and the stated `content_hash` is
  the real sha256 of the body with SQL's doubled quotes collapsed.
- No check's `reads` set duplicates a v4 check's subject, asserted by comparing bodies.
- **Both prompts' tasks coexisting on one matter, in production**, then each re-running: each
  keeps its own and touches nothing of the other's.

## Out of scope, named

**Renaming `stage_entered_at`.** Considered and declined above.

**Watching any field but `drafting_notes`.** The column is an array so a prompt could watch
several, and the trigger is per-column, so a second watched field means a second database
trigger. One is enough to learn from.

**The verification drift** on the design-sheet audit — five runs now, still unexplained.
