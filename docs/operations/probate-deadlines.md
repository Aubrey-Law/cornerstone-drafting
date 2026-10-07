# Probate deadlines

The first slice of probate as a practice area (roadmap recommendation 11). A probate matter
runs on statutory clocks that start from facts on the record. Until now each due date was
worked out by hand and typed into the matter. Now the attorney authors each clock once, as a
rule, and every probate matter gets its dates and a task from it.

## Rules

**Settings → Workflow → Probate deadlines** (`probate_deadline_rules`). A rule is:

- **Counted from** one anchor on the matter: date of death (`pb_date_of_death`), appointment
  of the personal representative (`pb_pr_appointment_date`), letters issued
  (`pb_letters_issued_date`, new) or petition filed (`pb_petition_filed_date`, new).
- **Months after**, then **plus days** (months clamp to the month end: Jan 31 + 1 month is
  Feb 28).
- **Applies to** every probate matter, or only when the matter says a federal or a
  Massachusetts estate tax return is required (`pb_federal_estate_tax_required`,
  `pb_state_estate_tax_required`).
- **Move a weekend date to Monday.** Court holidays are not modelled; the authority is the
  check.
- **Fills the matter's date** (optional): the claims-period, inventory, M-706, Form 706 or
  fiduciary-return due-date field.
- **Authority**: the citation the period comes from.

**A rule is the attorney's, not the software's.** It computes nothing until an administrator
presses *I have checked this period. Confirm*. Changing when a confirmed rule falls (anchor,
months, days, condition, weekend, target field) returns it to draft. Wording and authority can
be edited without reconfirming. *Return to draft* stops a rule without deleting it.

The migration seeds four drafts with their authority, for the attorney to check:

| Rule | Period | Fills | Authority given |
|---|---|---|---|
| Creditor claims period ends | 12 months after the date of death | Claims period ends | M.G.L. c. 190B §3-803(a) |
| Inventory due | 3 months after appointment | Inventory due | M.G.L. c. 190B §3-706 |
| M-706 due | 9 months after the date of death, weekend to Monday, only with a Massachusetts return | M-706 due | M.G.L. c. 65C §14 |
| Form 706 due | 9 months after the date of death, weekend to Monday, only with a federal return | Form 706 due | IRC §6075(a), §7503 |

## What a confirmed rule does

`syncProbateDeadlines` (`lib/probateDeadlines/server.ts`) runs for a probate matter whenever
an anchor date, a tax-return flag or the practice area changes on the matter page, and for
every probate matter whenever a rule is saved or confirmed. For each confirmed rule whose
anchor is recorded and whose condition the matter meets:

- **One task** (source `deadline`, high priority, due on the date, the rule's basis and
  authority in the description), keyed `deadline:<matter>:<rule>`. A corrected anchor redates
  an open task. A finished or archived task is never reopened or redated.
- **The matter's date field**, when the rule names one: filled when empty, or moved when it
  still holds the date this rule computed before. A date the attorney typed over is left
  alone.

Deadline tasks are written directly rather than proposed through the dial: they record a
period the attorney confirmed, not a decision the assistant made.

The matter's probate card gains *Petition filed* and *Letters issued*.

## Not yet

- **Calendar entries.** The calendar code makes timed holds only; a deadline would want an
  all-day event. The task carries the date for now.
- **A rule removed or no longer applicable** (a tax flag turned off) leaves its open task in
  place for the attorney to close.
- New rules are added in SQL for now; the Settings page edits and confirms the rules that
  exist.
