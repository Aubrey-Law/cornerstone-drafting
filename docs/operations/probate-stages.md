# Probate stages

Probate Phase 3, slice 3. Until now a probate matter showed the estate-planning stage strip
(Design, Drafting, Client Review…). Its nine-task checklist was filed under those same names, so
"File opening documents" sat under Design and "Obtain fiduciary letters" under Drafting. A probate
matter now has stages of its own.

## The stages

Each probate stage is read from a date already on the record (Probate essentials). It is never set
by hand and never stored. The current stage is the furthest event the record shows.

| Stage | Reached when |
|---|---|
| Opening | always; nothing filed yet |
| Petition filed | `pb_petition_filed_date` |
| Appointed | `pb_pr_appointment_date` or `pb_letters_issued_date` (the earlier) |
| Inventory filed | `pb_inventory_filed_date` |
| Claims period over | `pb_claims_period_end_date` is today or earlier |
| Distributed | `pb_final_distribution_date` |
| Closed | `pb_estate_closed_date`, or the estate-closed flag |

The claims period end date is filled by the creditor-claims deadline rule once it is confirmed
(see `probate-deadlines.md`). Record the other dates as they happen.

**Gaps.** If a later date is recorded but an earlier one is not, the earlier stage shows amber with
"No date recorded". For example, an inventory date with no appointment date. It is never assumed
done. The deadlines and the portal read the same dates, so a missing date is something to fill in.

## Where it shows

- **Matter header:** on a probate matter the probate strip replaces the estate-planning strip. Each
  stage's date shows on hover, followed by the next step. There is no "Change stage" button, because
  the stage follows the dates. Closing still runs from Billing.
- **Checklist (Tasks → plan):** the probate track's tasks are grouped under the probate stages.
- **Portal:** the client's progress shows the same six milestones after Opening, each complete only
  on its own date.

`matters.stage` is untouched. The pipeline board, aging and stage history keep their own vocabulary
for every matter, probate included.

## Migration

`20270125090000_probate_stage_phases.sql` re-files the `probate_sla_v1` template under the probate
phases. It also moves tasks already generated from that template, whether open or finished. The
pre-engagement task keeps its `new_lead` phase. The probate track itself is still switched off by
default (`probate_track_enabled`).

| Old phase | New phase |
|---|---|
| intake, design | Opening |
| drafting | Petition filed |
| client_review | Appointed |
| revision | Claims period over |
| post_execution | Distributed |
| closed | Closed |
