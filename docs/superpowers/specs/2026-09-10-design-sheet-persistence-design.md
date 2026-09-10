# Phase 6a — the design-sheet persistence layer

**Date:** 2026-09-10
**Status:** approved, ready for an implementation plan
**Parent:** `docs/superpowers/plans/2026-09-02-workbench-overhaul.md`, phase 6

## Why this is its own phase

Phase 6 as written is "drafting ported" — 15,032 lines across 51 files, of
which 9,916 in 29 `design/sections/` components. Its acceptance test is "the
attorney drafts one real matter in the workbench, diffed against the corpus",
and the corpus has **zero of 45 documents approved**, so that test has no
baseline yet.

Splitting the risky half out lets it proceed anyway:

- **6a (this spec)** — where the design sheet is stored and how it is written.
  No UI. All the correctness risk, none of the attorney dependency.
- **6b** — the sections, ported near-verbatim onto the new shell.
- **6c** — the real-matter drafting run, which needs the corpus approvals.

## What is actually wrong today

### Three homes for one design sheet

| home | rows | last written |
| --- | --- | --- |
| `design_sheets` columns | 45 matters | 2026-09-10 |
| `design_sheets.decisions` jsonb | 41 of 45 non-empty | 2026-09-10 |
| `matters.li_design_sheet_data` jsonb | 10 matters | 2026-08-17 |

`lib/designSheetPersistence.ts` decides between the first two:
`WRITABLE_DESIGN_SHEET_COLUMNS` lists what becomes a column and its comment
says everything else goes under `decisions`. The third is not documented as a
store at all, but 17 code sites read it — `lib/designSheetReadiness.ts`,
`lib/designSheet/useDesignSheetState.ts`, `designSectionCatalog.tsx`,
`FiduciariesSection.tsx` among them.

### The third home is where the residuary lives, and the audit cannot see it

This is the finding that makes the consolidation urgent rather than tidy.

`ResiduarySection.tsx` writes four keys — `residuary_spouse_survives`,
`residuary_no_spouse`, `residuary_other_instructions`,
`residuary_specific_gifts` — through `onChange`, into
`matters.li_design_sheet_data`. Measured 2026-09-10: ten matters carry the
first two (both `string`), and neither of the other two appears anywhere.

The `ma-design-sheet-audit` prompt resolves `design_sheet.residuary_beneficiary`
through `packages/citations/src/prompt/inputs.ts` — a **column**, empty on all
44 latest sheets and never written by anything.

So the check asks "is a residuary recorded?", looks at a column nothing writes,
and finds nothing. On 2026-09-08–09 it raised nine blocker-severity findings
saying a stated concern had no provision answering it. **Seven of those nine
matters have the residuary recorded in the blob:** `0528d2db`, `10904a59`,
`48aac2c1`, `590a0498`, `d11717cd`, `e10908ee`, `fadd6263`. All seven were
archived as false on 2026-09-10.

Consolidating the store without also moving where the audit reads would relocate
the data and leave the check still blind. Both belong in this phase.

### Last-write-wins on a legal document

`app/admin/drafting/[matterId]/design/actions.ts` — `saveLiDesignSheet`:

```ts
const { error } = await admin
  .from('matters')
  .update({ li_design_sheet_data: data, updated_at: new Date().toISOString() })
  .eq('id', matterId)
```

No version check of any kind. Two tabs open on one matter and the second save
silently discards the first. The overhaul plan flags this at
`design/actions.ts:23` and prescribes compare-and-swap; the defect is in this
function rather than at that line.

## Scope

0. Add `design_sheets.lock_version`, defaulted, so no existing row needs
   backfilling.
1. Migrate the ten blobs into `design_sheets.decisions`, and stop writing the
   column.
2. Port the persistence layer into `apps/workbench`, with compare-and-swap.
3. ~~Port `lib/designSheet/seedFromIntake.ts` and
   `lib/contacts/intakeFiduciarySnapshot.ts` verbatim.~~ **Withdrawn
   2026-09-10 on attempting it.** Those two files stand on eleven modules
   absent from `apps/workbench`, so the port is not a copy — it needs the
   overhaul plan's *Shared-code extraction* first, which is its own phase.
   The bridge is not required until something in the workbench seeds a sheet
   from intake, which is 6b's work.
4. Point the audit's input resolution at `decisions`.
5. Re-run check 1 against the seven and record whether it stops firing.

No UI. No sections. No drafting run.

## The migration

Small, and measured rather than assumed:

| | |
| --- | --- |
| matters with a non-empty blob | 10 |
| distinct keys across them | 2 |
| keys colliding with existing `decisions` | **0** |
| of the 10, how many already have a `design_sheets` row | **10** |

Twenty key-value pairs, no collisions, no missing parents. The migration folds
each matter's blob into its latest sheet's `decisions` and leaves
`matters.li_design_sheet_data` in place.

**The column is not dropped in this phase**, and that is the repo's governing
rule rather than caution for its own sake: from
`20261013000000_drop_twenty_sync_columns.sql`, a table or column is never
dropped in the same PR as its last code reference, because migrations and code
deploy in no guaranteed order. Seventeen sites still read it. The drop is a
later PR, after 6b removes them.

## Compare-and-swap

A new column, `design_sheets.lock_version integer not null default 0`, carried
on read and required on write:

```
update design_sheets
   set <fields>, lock_version = lock_version + 1
 where matter_id = $1 and lock_version = $expected
```

A zero-row result is a lost race, not an error to swallow: the caller is told
the sheet moved and reloads rather than overwriting. That is the whole point —
the failure being fixed is a save that succeeds while destroying someone's
work.

**Two more obvious options were rejected, both on measurement.**

*Reusing `version`.* It already exists, is unique per `(matter_id, version)`,
and sits at 1 for all 45 matters. But `version` means "which revision of this
sheet", not "has it changed since I read it", and incrementing it on every save
would quietly redefine it. `20260813000001_design_sheet_unique_version.sql`
states the intent plainly: "One design sheet per (matter_id, version) is the
intended invariant."

*Appending a new row per save*, letting the unique constraint be the CAS. This
is the elegant version — real revision history on a legal document, no new
column — and it is wrong here. **26 files touch `design_sheets`; only 10 order
by version.** The other sixteen assume a single row, and several would not
merely read a stale one: `app/api/admin/matters/[id]/design-sheet/route.ts:73`
does `.eq('matter_id', …).maybeSingle()`, which *throws* once a second version
exists. Turning on history means auditing 16 read sites, which is 6b's work at
best and not persistence at all.

*Using `updated_at`* was rejected for the ordinary reason: it depends on every
writer remembering to set it and on clock resolution. A counter the update
statement increments cannot be forgotten.

`lock_version` is additive, changes no reader, and leaves `version` meaning
what the schema says it means.

## Where the audit reads

`packages/citations/src/prompt/inputs.ts` maps a prompt input key to
`{ table, column }`. It needs to express "a key inside `decisions`" as well.

The mapping gains a `jsonKey` form alongside `column`, so
`design_sheet.residuary_spouse_survives` resolves to
`decisions->>'residuary_spouse_survives'`.

**Correction to an earlier draft of this spec.** It said publish-time
validation would catch a mapping that names a key nothing writes. It would
not, and could not: `unknownSources` checks only that a declared source exists
in the allow-list, and it has no access to data. That is exactly why the
original bug survived — `design_sheet.residuary_beneficiary` *was* in the
allow-list, naming a real column that happened to be empty on every row.

So nothing in the system catches "an input resolving to something nothing
writes". Only measurement against real data does, which is what found it. The
plan therefore ends by measuring how many rows populate every allow-list
source, rather than pretending a gate exists.

A new prompt version publishes the changed inputs. Content changes make a
version; that rule is already established (#417).

## Errors

The three failure modes that matter, and what each does:

- **A lost CAS race** returns a distinct result the caller can act on — not an
  exception, and never a silent success. The sheet moved; reload and re-apply.
- **A migration that finds a collision** aborts rather than merging. Measured at
  zero today, but the migration asserts it rather than trusting this document.
- **An input mapping naming a missing key** fails at publish, not at run. A run
  that resolved an input to nothing is exactly how the nine false findings
  happened.

## Testing

**Unit, against a fake client** — the CAS path: a matching `lock_version`
writes and increments; a stale one writes nothing and reports the race; of two
writes sharing an expected value, the second loses.

**Migration, as SQL text** — CI's test job has no Supabase environment
(`.github/workflows/app-ci.yml`), so structural facts are asserted against the
migration's text, the idiom `tests/engagement-repository.test.ts` uses: that it
folds into `decisions`, that it asserts no collision, that it does not drop the
column.

**Against the real database, in a rolled-back transaction** — the ten matters
land with both keys in `decisions`; no matter loses a key it already had; a
second run is a no-op.

**The proof that this phase mattered** — after the migration and the new prompt
version, re-run check 1 on the seven. If it stops firing, the fix is
demonstrated against the thing that motivated it. If it still fires, the
findings were real and this diagnosis is wrong; that outcome gets recorded
rather than explained away.

## Out of scope

Dropping `matters.li_design_sheet_data`. The sections. The drafting run. The
other three coexistence hazards (H1 CRM triggers, H2 `deleteMatter`, H3 the
`client_intake`↔`contacts` mirror) — none is touched by a persistence port, and
H3's `npm run check:matter-contacts` is a precondition for 6b, when the
workbench first writes a join row.

`residuary_other_instructions` and `residuary_specific_gifts` exist in
`ResiduarySection` and appear in no matter's data. They migrate if present and
are otherwise ignored; no work is done to support fields nobody has used.

## Noted, not designed here

`matters.engagement_signed_at` and `matter_details.engagement_signed_at`
disagree on 15 matters — 14 where the first is set and the second is not, one
the reverse — although `lib/engagement/signedDate.ts` intends them to move
together. Found while working nearby on 2026-09-10. Unrelated to the design
sheet, and worth its own look.
