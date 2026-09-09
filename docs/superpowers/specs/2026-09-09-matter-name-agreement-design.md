# Does the matter's name agree with the sheet it drafts from — design

**Date:** 2026-09-09
**Status:** drafted, awaiting the owner's review
**Found by:** #438's investigation of a check-2 finding on one matter

## The problem, from the matter that exposed it

One matter is filed as **"Can Cheng — Estate Planning"** while its design sheet
drafts for **"Jie Cheng"**, and the sheet's own `concerns` field says so:

> "Matter on file lists client as Can Cheng (ccheng0730@gmail.com…); however,
> the legal summary identifies the primary contact as Jie Cheng (Jane) — client
> identity discrepancy needs clarification"

There is one `Cheng` contact record — Jie Cheng, with a third email address.

If a document is generated from `client_name`, it will say Jie Cheng on a matter
opened for Can Cheng. Nothing in the system notices, and the audit cannot: check
2 asks whether a person named in the free text reaches the structured decisions,
and "these two names may be one person" is not one of its four outcomes. Two
runs on that sheet answered it two different ways, and the second silently
resolved a discrepancy the sheet had flagged as open.

## Why this is not a seventh check on the audit prompt

The answer is a string comparison. It needs no model, and putting it in the
prompt would buy a model call, per-run variance, and a finding that can be
phrased differently each time — all for a question with one right answer.

The precedent is already here: `lib/fiduciary/matrix.ts` computes issues in code
and `lib/fiduciary/tasks.ts` turns them into tasks under their own
`tasks.source`. This follows that shape rather than the prompt engine's.

Everything the render-versioning slice exists for — pinning what a run asked,
replaying it, refusing a claim it cannot verify — is machinery for a *judgment*.
This is not a judgment.

## What it compares

Three values, all already on records the app reads:

- `matters.name`, taking the person part — the text before the ` — <type>`
  separator, so "Can Cheng — Estate Planning" yields "Can Cheng"
- `design_sheets.client_name`
- `design_sheets.spouse_name`

It agrees when the matter's person matches **either** the client or the spouse.

## The comparison rule, and why each part of it exists

Measured over all 39 matters that have both a name and a sheet with a
`client_name`. Each refinement below removed a specific false positive, named:

1. **Compare the first and last name tokens**, lowercased, punctuation stripped.
   A bare equality check on the whole string is too strict: "Richard G. Goss"
   and "Richard Goss" are one person.
2. **Strip generational and professional suffixes** — `jr`, `sr`, `ii`, `iii`,
   `iv`, `md`, `esq`. Without this, *Frank Lombardi* vs *Frank J. Lombardi Jr.*
   flags, and it is the same man.
3. **Accept a surname that is a component of the other.** Without this,
   *Alexandra Purdue* vs *Alexandra Purdue-Smithe* flags. A hyphenated surname
   is the ordinary case, not a discrepancy.
4. **Accept the spouse as well as the client.** Without this, *Siobhan Creedon*
   vs client *Kevin McGurgan* flags — and Siobhan Creedon is the `spouse_name`.
   A couples matter named for one spouse is normal.

### The measured result

| | |
| --- | --- |
| Matters compared | **39** |
| Agrees with the client | 35 |
| Agrees with the spouse | 1 |
| **Flagged** | **3** |

The three:

- `0528d2db` — matter *Can Cheng*, sheet *Jie Cheng*, spouse *Zilong Zhang*.
  The documented discrepancy above.
- `90551be8` — matter *Laura Coakley*, sheet *Kayleigh Marie Coakley*, no
  spouse. Same surname, different given name.
- `e543cdd7` — matter *Veronica Pace*, sheet *Matteo Lorenzo Neretti*, no
  spouse. Unrelated names.

**Roughly 8%, and all three are worth an attorney's glance.** That rate is the
argument for building it: a rule that flagged thirty of thirty-nine would be
noise, and one that flagged none would be pointless. It is also the number to
re-measure before trusting this spec, because it was taken on one day's data.

## What it must not do

- **Not block anything.** Same reasoning as the design-sheet audit's advisory
  design: a hard gate on a wrong finding stops good work. This surfaces.
- **Not guess which name is right.** The finding is "these disagree", never
  "the sheet is wrong". Whoever reads it knows; the checker does not.
- **Not touch the sheet or the matter.** It reads and reports.

## Shape of the implementation

Mirroring the fiduciary path, which is the closest existing thing:

| File | Responsibility |
| --- | --- |
| `apps/workbench/lib/identity/names.ts` | **new** — `personPartOf(matterName)`, `normaliseName(text)`, `namesAgree(a, b)`. Pure, no database. Every refinement above is a case in its tests. |
| `apps/workbench/lib/identity/matrix.ts` | **new** — `nameIssuesFor(matter, sheet)` returning zero or one issue. Pure. |
| `apps/workbench/lib/identity/tasks.ts` | **new** — the issue becomes a task row and a withdrawal plan, modelled on `lib/fiduciary/tasks.ts`, including its stable `batch_tag` built from the matter rather than a run. |
| `apps/workbench/lib/identity/sweep.ts` | **new** — `sweepNameAgreement(client)`, run from the tick beside the fiduciary sweep. |
| `supabase/migrations/<ts>_identity_task_source.sql` | **new** — extends `tasks_source_check` with `'identity'` and `tasks_closeout_reason_check` with `'identity_resolved'`, exactly as `20261105000000` did for `'fiduciary'`. |
| `lib/tasks/types.ts` (root app) | `TASK_SOURCES` gains `'identity'`, with a label and a pill colour — the root app is still the only thing that renders tasks, and a source it does not know renders as an empty chip. That defect shipped once already. |

### Two things learned today that this must inherit

**A stable `batch_tag`.** The fiduciary path builds its tag from the matter and
the issue, deliberately not from a run, which is why its sweep is idempotent.
The prompt path built its tag from the run id and churned every task on every
run, discarding attorneys' checklist ticks until #433 and #434. This uses the
fiduciary shape.

**No `.in('id', …)` on a value that might not be a uuid.** Not directly relevant
here — this reads no contacts — but the same class of bug stranded five matters
today, and the reviewer of this work should check it anyway.

## Severity, and the one judgment the owner still owes

The issue's severity decides the task's priority. A name disagreement is not a
drafting defect; it is a file-integrity problem that *can become* one — the
wrong name on an executed instrument. `high`, on the reading that it must be
resolved before signing but blocks nothing today.

That is a guess about practice, and the owner should confirm it or say
otherwise before this is built.

## Out of scope, named

- **The email discrepancy.** The Cheng sheet's `concerns` names a third address.
  Real, and a different check.
- **Comparing against the linked contact record.** `matter_contacts` was not
  readable in the shape this investigation expected, and adding a third source
  triples the ways two things can disagree. Two first.
- **Fixing any of the three flagged matters.** They are the owner's to resolve.
