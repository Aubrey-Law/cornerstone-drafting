# Plan Tasks — Review Draft

The SLA plan tasks Cornerstone generates for each practice area, as they stand on 2026-10-01. Mark each row in the last column (keep / revise / cut, plus notes), add new rows anywhere, and send it back. I'll turn your edits into a template migration.

**Where these come from.** Each plan is a row in `sla_task_templates`, seeded by a migration. The live copy is in the database, so edits go in a new migration, not in this file.

| Practice area | Template | Tasks | Target | Source |
|---|---|---|---|---|
| Estate Planning (EP) | `estate_planning_sla_v3` | 48 | ~14d soft pre-engagement + 28d firm after engagement (42 blended) | `supabase/migrations/20260824000001_estate_planning_sla_v3.sql` |
| Estate Planning - LP (EP-LP) | `estate_planning_lp_sla_v1` | 48 | same clocks as EP | `supabase/migrations/20270102090700_estate_planning_lp_sla_v1.sql` |
| College Prep Plan (CP) | `college_prep_sla_v1` | 33 | ~10d soft + 14d firm (24 blended) | `supabase/migrations/20260922000000_college_prep_sla_v1.sql` |
| Probate | `probate_sla_v1` | 9 | 14d pre-engagement + 166d (180 total) | `supabase/migrations/20261004000000_solo_practice_efficiency_billing.sql` |

> **EP-LP has its own checklist.** `slaTemplateForPracticeArea` (`lib/slaTasks/generate.ts`) routes EP-LP to `estate_planning_lp_sla_v1`. That checklist copies EP row for row, except for four billing tasks, which are marked "LP change" in the notes column. A test (`tests/estate-planning-lp-sla.test.ts`) keeps the two lists in step, so any further LP difference has to be added there too.

> **Existing Probate matters keep their checklist.** The Probate track only applies to newly opened matters; `resyncMatterSlaTemplate` skips Probate on purpose.

## How to read the columns

- **Owner**: Firm (attorney/staff), Client, or Auto (the system does it, no one acts).
- **Due**: *Day N* counts calendar days from **Day 0, the day the engagement agreement is signed**. Pre-engagement tasks count from the discovery call or the PMPS instead, and show no date until that meeting is on the calendar. "—" means no deadline of its own.
- **Nudge / escalation**: when the automatic reminder goes out, and at what tier: *gentle* (client), *firm* (client, stronger), *internal* (firm only).
- **Flags**
  - *auto*: the system does it without anyone acting.
  - *conditional*: only applies when relevant (deeds, round 2, balance due…). It is generated, and you skip it when it doesn't apply.
  - *gated: fit confirmed*: held back until the lead is marked a fit.
  - *remote signing only*: generated only on the DIY/remote-signing path.
  - *pauses clock*: the SLA clock stops while this waits on the client, and later due dates shift out.
  - *starts Day 0*: finishing this task starts the firm clock.
  - *skill*: the workflow/skill the task launches. `cornerstone-billing` replaced `qbo-invoice` in the Probate migration.

---

## 1. Estate Planning (EP)

#### Discovery

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-1 | Lead schedules 15-min discovery call | Client | — |  |  |  |
| EP-2 | Hold discovery call | Firm | day of discovery call |  |  |  |
| EP-3 | Determine fit - proceed or decline | Firm | day of discovery call |  |  |  |

#### Organizer Sent

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-4 | Send post-discovery email (PMPS link + estate plan organizer) | Auto | day of discovery call |  | auto; gated: fit confirmed |  |
| EP-5 | Lead schedules Peace of Mind Planning Session | Client | 7d after discovery call | nudge 5d after discovery call (gentle) | gated: fit confirmed |  |
| EP-6 | Lead completes estate plan organizer | Client | 1d before PMPS | nudge 3d before PMPS (gentle) | gated: fit confirmed |  |

#### Planning Session

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-7 | Confirm organizer submitted; follow up if not | Firm | 1d before PMPS |  |  |  |
| EP-8 | Run PMPS prep (agenda, proposal, tax worksheet, one-pager) | Firm | 1d before PMPS |  | skill: `pmps-prep` |  |
| EP-9 | Hold Peace of Mind Planning Session | Firm | day of PMPS |  |  |  |

#### Recommendations Sent

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-10 | Send recommendations + engagement agreement | Firm | 1d after PMPS |  |  |  |
| EP-11 | Client signs engagement agreement | Client | 4d after PMPS | nudge 3d after PMPS (gentle)<br>escalate 7d after PMPS (firm) | **starts Day 0** |  |

#### Engaged

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-12 | Create matter folder in OneDrive | Auto | Day 0 |  | auto; skill: `new-matter-folder` |  |
| EP-13 | Send invoice / collect payment | Firm | Day 0 |  | skill: `cornerstone-billing` |  |

#### Design

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-14 | Send design summary to client | Firm | Day 1 |  |  |  |
| EP-15 | Schedule optional design meeting | Firm | Day 2 |  | conditional |  |
| EP-16 | Hold design meeting | Firm | Day 5 |  | conditional |  |
| EP-17 | Client approves design | Client | Day 7 | nudge Day 5 (gentle)<br>escalate Day 10 (firm) | pauses clock |  |

#### Drafting

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-18 | Draft full document package | Firm | Day 13 | nudge Day 11 (internal) | skill: `draft-estate-plan-documents` |  |
| EP-19 | Draft deed(s) if applicable | Firm | Day 14 |  | conditional; skill: `deed-drafting` |  |
| EP-20 | Internal QA review of all documents | Firm | Day 15 |  |  |  |
| EP-21 | Deliver drafts to client for review | Firm | Day 16 | nudge Day 14 (internal) |  |  |

#### Client Review

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-22 | Client reviews drafts and submits feedback | Client | Day 22 | nudge Day 20 (gentle)<br>escalate Day 24 (firm) | pauses clock |  |

#### Revision

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-23 | Incorporate revisions (Round 1) | Firm | Day 24 |  |  |  |
| EP-24 | Deliver revised drafts to client | Firm | Day 24 |  |  |  |
| EP-25 | Round 2 revision (extends SLA +5 days) | Firm | Day 29 |  | conditional; extends SLA +5d |  |

#### Ready to Sign

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-26 | Indicate funding details for each asset in design sheet | Firm | Day 25 |  |  |  |
| EP-27 | Print and tab all documents for signing | Firm | Day 27 |  |  |  |
| EP-28 | Generate final invoice if balance due | Firm | Day 27 |  | conditional; skill: `cornerstone-billing` |  |
| EP-29 | Generate DIY signing instructions | Firm | Day 25 |  | conditional; remote signing only |  |
| EP-30 | Mail/deliver signing package to client | Firm | Day 25 |  | conditional; remote signing only |  |
| EP-31 | Confirm client received package | Firm | Day 28 |  | conditional; remote signing only; pauses clock |  |
| EP-32 | Monitor signing progress until originals returned | Firm | Day 28 | nudge Day 28 (gentle) | conditional; remote signing only; pauses clock; repeats every 7d |  |

#### Signed

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-33 | Signing meeting held | Firm | Day 28 |  |  |  |
| EP-34 | Supervise execution (clients, notary, witnesses) | Firm | Day 28 |  |  |  |
| EP-35 | Collect any balance due | Firm | Day 28 |  | conditional |  |
| EP-36 | Scan signed Certification of Trust; upload to OneDrive | Firm | Day 28 |  |  |  |
| EP-37 | Review trust funding package with client | Firm | Day 28 |  | skill: `trust-funding` |  |
| EP-38 | Originals received; proceed to post-signing | Firm | Day 35 |  | conditional; remote signing only |  |

#### Post-Signing

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-39 | Send deeds to county clerk for recording | Firm | Day 29 |  | conditional |  |
| EP-40 | Scan all signed originals; upload to OneDrive | Firm | Day 31 |  |  |  |
| EP-41 | Generate estate plan summary | Firm | Day 33 |  | skill: `generate-estate-plan-summary` |  |
| EP-42 | Draft closing / funding package | Firm | Day 34 |  | skill: `trust-funding` |  |
| EP-43 | Deliver closing package to client | Firm | Day 35 |  |  |  |
| EP-44 | Send handwritten thank-you note | Firm | Day 35 |  |  |  |
| EP-45 | File legal plan claim if applicable (MetLife / LegalEASE / ARAG) | Firm | Day 38 |  | conditional; skill: `metlife-claim` |  |

#### Funding

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-46 | 30-day post-signing funding check-in | Firm | Day 58 | nudge Day 58 (gentle) | repeats every 30d |  |
| EP-47 | Confirm recorded deeds received from county | Firm | Day 58 |  | conditional |  |
| EP-48 | Confirm all assets funded; close matter | Firm | — |  |  |  |

---

## 2. Estate Planning - LP (EP-LP)

_Same as EP except the four rows marked "LP change": coverage is confirmed at engagement instead of invoicing, client billing covers only out-of-plan work, and the plan claim is always filed._

#### Discovery

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-1 | Lead schedules 15-min discovery call | Client | — |  |  |  |
| LP-2 | Hold discovery call | Firm | day of discovery call |  |  |  |
| LP-3 | Determine fit - proceed or decline | Firm | day of discovery call |  |  |  |

#### Organizer Sent

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-4 | Send post-discovery email (PMPS link + estate plan organizer) | Auto | day of discovery call |  | auto; gated: fit confirmed |  |
| LP-5 | Lead schedules Peace of Mind Planning Session | Client | 7d after discovery call | nudge 5d after discovery call (gentle) | gated: fit confirmed |  |
| LP-6 | Lead completes estate plan organizer | Client | 1d before PMPS | nudge 3d before PMPS (gentle) | gated: fit confirmed |  |

#### Planning Session

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-7 | Confirm organizer submitted; follow up if not | Firm | 1d before PMPS |  |  |  |
| LP-8 | Run PMPS prep (agenda, proposal, tax worksheet, one-pager) | Firm | 1d before PMPS |  | skill: `pmps-prep` |  |
| LP-9 | Hold Peace of Mind Planning Session | Firm | day of PMPS |  |  |  |

#### Recommendations Sent

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-10 | Send recommendations + engagement agreement | Firm | 1d after PMPS |  |  |  |
| LP-11 | Client signs engagement agreement | Client | 4d after PMPS | nudge 3d after PMPS (gentle)<br>escalate 7d after PMPS (firm) | **starts Day 0** |  |

#### Engaged

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-12 | Create matter folder in OneDrive | Auto | Day 0 |  | auto; skill: `new-matter-folder` |  |
| LP-13 | Confirm legal plan coverage and obtain the case / authorization number | Firm | Day 0 |  |  | _LP change: replaces "Send invoice / collect payment"_ |

#### Design

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-14 | Send design summary to client | Firm | Day 1 |  |  |  |
| LP-15 | Schedule optional design meeting | Firm | Day 2 |  | conditional |  |
| LP-16 | Hold design meeting | Firm | Day 5 |  | conditional |  |
| LP-17 | Client approves design | Client | Day 7 | nudge Day 5 (gentle)<br>escalate Day 10 (firm) | pauses clock |  |

#### Drafting

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-18 | Draft full document package | Firm | Day 13 | nudge Day 11 (internal) | skill: `draft-estate-plan-documents` |  |
| LP-19 | Draft deed(s) if applicable | Firm | Day 14 |  | conditional; skill: `deed-drafting` |  |
| LP-20 | Internal QA review of all documents | Firm | Day 15 |  |  |  |
| LP-21 | Deliver drafts to client for review | Firm | Day 16 | nudge Day 14 (internal) |  |  |

#### Client Review

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-22 | Client reviews drafts and submits feedback | Client | Day 22 | nudge Day 20 (gentle)<br>escalate Day 24 (firm) | pauses clock |  |

#### Revision

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-23 | Incorporate revisions (Round 1) | Firm | Day 24 |  |  |  |
| LP-24 | Deliver revised drafts to client | Firm | Day 24 |  |  |  |
| LP-25 | Round 2 revision (extends SLA +5 days) | Firm | Day 29 |  | conditional; extends SLA +5d |  |

#### Ready to Sign

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-26 | Indicate funding details for each asset in design sheet | Firm | Day 25 |  |  |  |
| LP-27 | Print and tab all documents for signing | Firm | Day 27 |  |  |  |
| LP-28 | Invoice the client for any out-of-plan work | Firm | Day 27 |  | conditional; skill: `cornerstone-billing` | _LP change: was "Generate final invoice if balance due"_ |
| LP-29 | Generate DIY signing instructions | Firm | Day 25 |  | conditional; remote signing only |  |
| LP-30 | Mail/deliver signing package to client | Firm | Day 25 |  | conditional; remote signing only |  |
| LP-31 | Confirm client received package | Firm | Day 28 |  | conditional; remote signing only; pauses clock |  |
| LP-32 | Monitor signing progress until originals returned | Firm | Day 28 | nudge Day 28 (gentle) | conditional; remote signing only; pauses clock; repeats every 7d |  |

#### Signed

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-33 | Signing meeting held | Firm | Day 28 |  |  |  |
| LP-34 | Supervise execution (clients, notary, witnesses) | Firm | Day 28 |  |  |  |
| LP-35 | Collect payment for any out-of-plan work | Firm | Day 28 |  | conditional | _LP change: was "Collect any balance due"_ |
| LP-36 | Scan signed Certification of Trust; upload to OneDrive | Firm | Day 28 |  |  |  |
| LP-37 | Review trust funding package with client | Firm | Day 28 |  | skill: `trust-funding` |  |
| LP-38 | Originals received; proceed to post-signing | Firm | Day 35 |  | conditional; remote signing only |  |

#### Post-Signing

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-39 | Send deeds to county clerk for recording | Firm | Day 29 |  | conditional |  |
| LP-40 | Scan all signed originals; upload to OneDrive | Firm | Day 31 |  |  |  |
| LP-41 | Generate estate plan summary | Firm | Day 33 |  | skill: `generate-estate-plan-summary` |  |
| LP-42 | Draft closing / funding package | Firm | Day 34 |  | skill: `trust-funding` |  |
| LP-43 | Deliver closing package to client | Firm | Day 35 |  |  |  |
| LP-44 | Send handwritten thank-you note | Firm | Day 35 |  |  |  |
| LP-45 | File legal plan claim (MetLife / LegalEASE / ARAG) | Firm | Day 38 |  | skill: `metlife-claim` | _LP change: no longer conditional_ |

#### Funding

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-46 | 30-day post-signing funding check-in | Firm | Day 58 | nudge Day 58 (gentle) | repeats every 30d |  |
| LP-47 | Confirm recorded deeds received from county | Firm | Day 58 |  | conditional |  |
| LP-48 | Confirm all assets funded; close matter | Firm | — |  |  |  |

---

## 3. College Prep Plan (CP)

No PMPS, no trust, no deeds, no funding. Pre-engagement tasks anchor to the intro call only and nothing waits on a fit decision. The migration describes this list as "a starting point for the attorney to adjust, not a firm commitment."

#### Discovery

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-1 | Parent or student books intro call | Client | — |  |  |  |
| CP-2 | Hold intro call | Firm | day of discovery call |  |  |  |
| CP-3 | Confirm the student turns 18 before signing, and note the move-in / orientation date | Firm | day of discovery call |  |  |  |

#### Organizer Sent

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-4 | Send College Preparation Plan questionnaire | Auto | day of discovery call |  | auto |  |
| CP-5 | Student completes the questionnaire | Client | 5d after discovery call | nudge 3d after discovery call (gentle) |  |  |

#### Planning Session

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-6 | Review answers; confirm the named agents are reachable | Firm | 6d after discovery call |  |  |  |

#### Recommendations Sent

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-7 | Send engagement agreement | Firm | 7d after discovery call |  |  |  |
| CP-8 | Client signs engagement agreement | Client | 10d after discovery call | nudge 8d after discovery call (gentle)<br>escalate 12d after discovery call (firm) | **starts Day 0** |  |

#### Engaged

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-9 | Create matter folder in OneDrive | Auto | Day 0 |  | auto; skill: `new-matter-folder` |  |
| CP-10 | Send invoice / collect payment | Firm | Day 0 |  | skill: `cornerstone-billing` |  |

#### Design

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-11 | Resolve the answers the student deferred to the meeting | Firm | Day 2 |  |  |  |
| CP-12 | Confirm power of attorney scope and HIPAA recipients with the student | Firm | Day 3 |  |  |  |
| CP-13 | Student approves the plan | Client | Day 5 | nudge Day 4 (gentle) | pauses clock |  |

#### Drafting

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-14 | Draft the student package (POA, health care proxy, HIPAA, living will) | Firm | Day 7 |  | skill: `draft-estate-plan-documents` |  |
| CP-15 | Draft the FERPA release | Firm | Day 7 |  | conditional |  |
| CP-16 | Check whether the school requires its own FERPA form or portal authorization | Firm | Day 8 |  | conditional |  |
| CP-17 | Internal QA review of all documents | Firm | Day 9 |  |  |  |
| CP-18 | Deliver drafts for review | Firm | Day 10 | nudge Day 9 (internal) |  |  |

#### Client Review

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-19 | Student reviews drafts and submits feedback | Client | Day 12 | nudge Day 11 (gentle)<br>escalate Day 13 (firm) | pauses clock |  |

#### Revision

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-20 | Incorporate revisions | Firm | Day 13 |  | conditional |  |
| CP-21 | Deliver revised drafts to the student | Firm | Day 13 |  | conditional |  |

#### Ready to Sign

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-22 | Confirm the student has turned 18 before scheduling | Firm | Day 12 |  |  |  |
| CP-23 | Schedule signing ahead of the move-in / orientation date | Firm | Day 12 |  |  |  |
| CP-24 | Print and tab all documents for signing | Firm | Day 13 |  |  |  |

#### Signed

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-25 | Signing meeting held | Firm | Day 14 |  |  |  |
| CP-26 | Supervise execution (student, notary, witnesses) | Firm | Day 14 |  |  |  |

#### Post-Signing

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-27 | Scan signed originals; upload to OneDrive | Firm | Day 15 |  |  |  |
| CP-28 | Give the student copies to carry (wallet card / phone) | Firm | Day 16 |  |  |  |
| CP-29 | Deliver copies to the named agents | Firm | Day 16 |  |  |  |
| CP-30 | Submit the FERPA release to the school | Firm | Day 17 |  | conditional |  |
| CP-31 | Send the HIPAA authorization and health care proxy to the campus health center | Firm | Day 17 |  | conditional |  |
| CP-32 | File legal plan claim if applicable (MetLife / LegalEASE / ARAG) | Firm | Day 20 |  | conditional; skill: `metlife-claim` |  |

#### Complete

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-33 | Confirm documents delivered; close matter | Firm | — |  |  |  |

---

## 4. Probate

Coarse phase-level milestones, not a detailed checklist yet. The `phase` values reuse the estate-planning pipeline stages as slots (for example, "Drafting" = obtaining fiduciary letters), so the stage labels below don't describe the probate work. A real probate stage list may be worth defining as part of this revision. Billing runs on three manual phases: opening, administration, closing.

#### Discovery

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-1 | Collect death certificate and initial family information | Client | day of discovery call |  |  |  |

#### Engaged

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-2 | Confirm probate court, interested persons, original will, and asset inventory | Firm | Day 3 |  |  |  |
| PR-3 | Prepare opening petition and required notices | Firm | Day 10 |  |  |  |

#### Design

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-4 | File opening documents and calendar citation or notice deadlines | Firm | Day 14 |  |  |  |

#### Drafting

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-5 | Track appointment and obtain fiduciary letters | Firm | Day 35 |  |  |  |

#### Client Review

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-6 | Complete asset inventory and creditor review | Firm | Day 75 |  |  |  |

#### Revision

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-7 | Prepare administration accounting and distributions | Firm | Day 140 |  |  |  |

#### Post-Signing

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-8 | Prepare closing statement or final account | Firm | Day 175 |  |  |  |

#### Complete

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-9 | Confirm distributions, receipts, billing, and court close-out | Firm | Day 180 |  |  |  |

---

## Revision notes / new tasks

_Add anything that doesn't fit a row above: new tasks (with plan, stage, owner, due day), stage changes, or questions._

- 
