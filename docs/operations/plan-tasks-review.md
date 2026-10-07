# Plan Tasks — Review Draft

The SLA plan tasks Cornerstone generates for each practice area. Mark each row in the last column (keep / revise / cut, plus notes) and add new tasks anywhere. Edits are applied to the live templates in a database migration; changing this document does not change the app.

**Lead and matter lists.** Leads and matters run separate task lists, cut from the same template. A lead gets only its lead tasks, from scheduling the discovery call through "Client signs engagement agreement". Signing converts the lead to hired, and only then is the matter task list created. Trust Administration has no task list yet.

| Practice area | Template | Tasks | Target |
|---|---|---|---|
| Estate Planning (EP) | `estate_planning_sla_v3` | 48 (11 lead + 37 matter) | ~14 days soft before engagement, then a 28-day firm SLA (42 blended) |
| Estate Planning - LP (EP-LP) | `estate_planning_lp_sla_v1` | 48 (12 lead + 36 matter) | Same clocks as EP |
| College Prep Plan (CP) | `college_prep_sla_v1` | 33 (8 lead + 25 matter) | ~10 days soft, then a 14-day firm SLA (24 blended) |
| Probate | `probate_sla_v1` | 9 (1 lead + 8 matter) | 14 days before engagement + 166 days (180 total) |

Templates live in `sla_task_templates` and are seeded by migrations in `supabase/migrations/`. A template change only reaches leads and matters generated after it; existing ones keep the tasks they were generated with.

## How to read the columns

- **Owner**: Firm (attorney/staff), Client, or Auto (the system does it).
- **Due**: "Day N" counts calendar days from Day 0, the day the engagement agreement is signed. Lead tasks count from the discovery call or the PMPS and stay undated until that meeting is on the calendar. "—" means no deadline of its own.
- **Nudge / escalation**: When the automatic reminder goes out, and its tier: gentle (client), firm (client, stronger), internal (firm only).
- **Conditional**: Only applies when relevant (deeds, round 2, out-of-plan work). Skip it when it doesn't apply.
- **Gated: fit confirmed**: Held back until the lead is marked a fit.
- **Remote signing only**: Generated only on the DIY / remote-signing path.
- **Pauses clock**: The SLA clock stops while waiting on the client, and later dates shift out.
- **Skill**: The workflow the task launches.

---

## 1. Estate Planning (EP)

### Lead tasks

_Created when the lead is opened. Ends at "Client signs engagement agreement", which converts the lead to hired._

#### Discovery

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-1 | Lead schedules 15-min discovery call | Client | — |  |  |  |
| EP-2 | Hold discovery call | Firm | Day of discovery call |  |  |  |
| EP-3 | Determine fit - proceed or decline | Firm | Day of discovery call |  |  |  |

#### Organizer Sent

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-4 | Send post-discovery email (PMPS link + estate plan organizer) | Auto | Day of discovery call |  | Auto; Gated: fit confirmed |  |
| EP-5 | Lead schedules Peace of Mind Planning Session | Client | 7d after discovery call | Nudge 5d after discovery call (gentle) | Gated: fit confirmed |  |
| EP-6 | Lead completes estate plan organizer | Client | 1d before PMPS | Nudge 3d before PMPS (gentle) | Gated: fit confirmed |  |

#### Planning Session

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-7 | Confirm organizer submitted; follow up if not | Firm | 1d before PMPS |  |  |  |
| EP-8 | Run PMPS prep (agenda, proposal, tax worksheet, one-pager) | Firm | 1d before PMPS |  | Skill: pmps-prep |  |
| EP-9 | Hold Peace of Mind Planning Session | Firm | Day of PMPS |  |  |  |

#### Recommendations Sent

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-10 | Send recommendations + engagement agreement | Firm | 1d after PMPS |  |  |  |
| EP-11 | Client signs engagement agreement | Client | 4d after PMPS | Nudge 3d after PMPS (gentle)<br>Escalate 7d after PMPS (firm) | Starts Day 0; converts lead to hired |  |

### Matter tasks

_Created when the engagement is signed. Due dates count from that day (Day 0)._

#### Engaged

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-12 | Create matter folder in OneDrive | Auto | Day 0 |  | Auto; Skill: new-matter-folder |  |
| EP-13 | Send invoice / collect payment | Firm | Day 0 |  | Skill: cornerstone-billing |  |

#### Design

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-14 | Send design summary to client | Firm | Day 1 |  |  |  |
| EP-15 | Schedule optional design meeting | Firm | Day 2 |  | Conditional |  |
| EP-16 | Hold design meeting | Firm | Day 5 |  | Conditional |  |
| EP-17 | Client approves design | Client | Day 7 | Nudge Day 5 (gentle)<br>Escalate Day 10 (firm) | Pauses clock |  |

#### Drafting

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-18 | Draft full document package | Firm | Day 13 | Nudge Day 11 (internal) | Skill: draft-estate-plan-documents |  |
| EP-19 | Draft deed(s) if applicable | Firm | Day 14 |  | Conditional; Skill: deed-drafting |  |
| EP-20 | Internal QA review of all documents | Firm | Day 15 |  |  |  |
| EP-21 | Deliver drafts to client for review | Firm | Day 16 | Nudge Day 14 (internal) |  |  |

#### Client Review

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-22 | Client reviews drafts and submits feedback | Client | Day 22 | Nudge Day 20 (gentle)<br>Escalate Day 24 (firm) | Pauses clock |  |

#### Revision

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-23 | Incorporate revisions (Round 1) | Firm | Day 24 |  |  |  |
| EP-24 | Deliver revised drafts to client | Firm | Day 24 |  |  |  |
| EP-25 | Round 2 revision (extends SLA +5 days) | Firm | Day 29 |  | Conditional; Extends SLA +5d |  |

#### Ready to Sign

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-26 | Indicate funding details for each asset in design sheet | Firm | Day 25 |  |  |  |
| EP-27 | Print and tab all documents for signing | Firm | Day 27 |  |  |  |
| EP-28 | Generate final invoice if balance due | Firm | Day 27 |  | Conditional; Skill: cornerstone-billing |  |
| EP-29 | Generate DIY signing instructions | Firm | Day 25 |  | Conditional; Remote signing only |  |
| EP-30 | Mail/deliver signing package to client | Firm | Day 25 |  | Conditional; Remote signing only |  |
| EP-31 | Confirm client received package | Firm | Day 28 |  | Conditional; Remote signing only; Pauses clock |  |
| EP-32 | Monitor signing progress until originals returned | Firm | Day 28 | Nudge Day 28 (gentle) | Conditional; Remote signing only; Pauses clock; Repeats every 7d |  |

#### Signed

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-33 | Signing meeting held | Firm | Day 28 |  |  |  |
| EP-34 | Supervise execution (clients, notary, witnesses) | Firm | Day 28 |  |  |  |
| EP-35 | Collect any balance due | Firm | Day 28 |  | Conditional |  |
| EP-36 | Scan signed Certification of Trust; upload to OneDrive | Firm | Day 28 |  |  |  |
| EP-37 | Review trust funding package with client | Firm | Day 28 |  | Skill: trust-funding |  |
| EP-38 | Originals received; proceed to post-signing | Firm | Day 35 |  | Conditional; Remote signing only |  |

#### Post-Signing

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-39 | Send deeds to county clerk for recording | Firm | Day 29 |  | Conditional |  |
| EP-40 | Scan all signed originals; upload to OneDrive | Firm | Day 31 |  |  |  |
| EP-41 | Generate estate plan summary | Firm | Day 33 |  | Skill: generate-estate-plan-summary |  |
| EP-42 | Draft closing / funding package | Firm | Day 34 |  | Skill: trust-funding |  |
| EP-43 | Deliver closing package to client | Firm | Day 35 |  |  |  |
| EP-44 | Send handwritten thank-you note | Firm | Day 35 |  |  |  |
| EP-45 | File legal plan claim if applicable (MetLife / LegalEASE / ARAG) | Firm | Day 38 |  | Conditional; Skill: metlife-claim |  |

#### Funding

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| EP-46 | 30-day post-signing funding check-in | Firm | Day 58 | Nudge Day 58 (gentle) | Repeats every 30d |  |
| EP-47 | Confirm recorded deeds received from county | Firm | Day 58 |  | Conditional |  |
| EP-48 | Confirm all assets funded; close matter | Firm | — |  |  |  |


---

## 2. Estate Planning - LP (EP-LP)

Same as Estate Planning except the rows marked "LP change". The member ID and benefits are confirmed on the lead, a day after the discovery call. There is no invoice or payment task at engagement. Client billing covers only out-of-plan work, and the plan claim is always filed.

### Lead tasks

_Created when the lead is opened. Ends at "Client signs engagement agreement", which converts the lead to hired._

#### Discovery

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-1 | Lead schedules 15-min discovery call | Client | — |  |  |  |
| LP-2 | Hold discovery call | Firm | Day of discovery call |  |  |  |
| LP-3 | Determine fit - proceed or decline | Firm | Day of discovery call |  |  |  |

#### Organizer Sent

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-4 | Send post-discovery email (PMPS link + estate plan organizer) | Auto | Day of discovery call |  | Auto; Gated: fit confirmed |  |
| LP-5 | Request member ID and confirm benefits | Firm | 1d after discovery call |  | Gated: fit confirmed | _LP change: added on the lead, after the post-discovery email_ |
| LP-6 | Lead schedules Peace of Mind Planning Session | Client | 7d after discovery call | Nudge 5d after discovery call (gentle) | Gated: fit confirmed |  |
| LP-7 | Lead completes estate plan organizer | Client | 1d before PMPS | Nudge 3d before PMPS (gentle) | Gated: fit confirmed |  |

#### Planning Session

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-8 | Confirm organizer submitted; follow up if not | Firm | 1d before PMPS |  |  |  |
| LP-9 | Run PMPS prep (agenda, proposal, tax worksheet, one-pager) | Firm | 1d before PMPS |  | Skill: pmps-prep |  |
| LP-10 | Hold Peace of Mind Planning Session | Firm | Day of PMPS |  |  |  |

#### Recommendations Sent

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-11 | Send recommendations + engagement agreement | Firm | 1d after PMPS |  |  |  |
| LP-12 | Client signs engagement agreement | Client | 4d after PMPS | Nudge 3d after PMPS (gentle)<br>Escalate 7d after PMPS (firm) | Starts Day 0; converts lead to hired |  |

### Matter tasks

_Created when the engagement is signed. Due dates count from that day (Day 0)._

#### Engaged

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-13 | Create matter folder in OneDrive | Auto | Day 0 |  | Auto; Skill: new-matter-folder |  |

#### Design

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-14 | Send design summary to client | Firm | Day 1 |  |  |  |
| LP-15 | Schedule optional design meeting | Firm | Day 2 |  | Conditional |  |
| LP-16 | Hold design meeting | Firm | Day 5 |  | Conditional |  |
| LP-17 | Client approves design | Client | Day 7 | Nudge Day 5 (gentle)<br>Escalate Day 10 (firm) | Pauses clock |  |

#### Drafting

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-18 | Draft full document package | Firm | Day 13 | Nudge Day 11 (internal) | Skill: draft-estate-plan-documents |  |
| LP-19 | Draft deed(s) if applicable | Firm | Day 14 |  | Conditional; Skill: deed-drafting |  |
| LP-20 | Internal QA review of all documents | Firm | Day 15 |  |  |  |
| LP-21 | Deliver drafts to client for review | Firm | Day 16 | Nudge Day 14 (internal) |  |  |

#### Client Review

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-22 | Client reviews drafts and submits feedback | Client | Day 22 | Nudge Day 20 (gentle)<br>Escalate Day 24 (firm) | Pauses clock |  |

#### Revision

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-23 | Incorporate revisions (Round 1) | Firm | Day 24 |  |  |  |
| LP-24 | Deliver revised drafts to client | Firm | Day 24 |  |  |  |
| LP-25 | Round 2 revision (extends SLA +5 days) | Firm | Day 29 |  | Conditional; Extends SLA +5d |  |

#### Ready to Sign

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-26 | Indicate funding details for each asset in design sheet | Firm | Day 25 |  |  |  |
| LP-27 | Print and tab all documents for signing | Firm | Day 27 |  |  |  |
| LP-28 | Invoice the client for any out-of-plan work | Firm | Day 27 |  | Conditional; Skill: cornerstone-billing | _LP change: was "Generate final invoice if balance due"_ |
| LP-29 | Generate DIY signing instructions | Firm | Day 25 |  | Conditional; Remote signing only |  |
| LP-30 | Mail/deliver signing package to client | Firm | Day 25 |  | Conditional; Remote signing only |  |
| LP-31 | Confirm client received package | Firm | Day 28 |  | Conditional; Remote signing only; Pauses clock |  |
| LP-32 | Monitor signing progress until originals returned | Firm | Day 28 | Nudge Day 28 (gentle) | Conditional; Remote signing only; Pauses clock; Repeats every 7d |  |

#### Signed

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-33 | Signing meeting held | Firm | Day 28 |  |  |  |
| LP-34 | Supervise execution (clients, notary, witnesses) | Firm | Day 28 |  |  |  |
| LP-35 | Collect payment for any out-of-plan work | Firm | Day 28 |  | Conditional | _LP change: was "Collect any balance due"_ |
| LP-36 | Scan signed Certification of Trust; upload to OneDrive | Firm | Day 28 |  |  |  |
| LP-37 | Review trust funding package with client | Firm | Day 28 |  | Skill: trust-funding |  |
| LP-38 | Originals received; proceed to post-signing | Firm | Day 35 |  | Conditional; Remote signing only |  |

#### Post-Signing

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-39 | Send deeds to county clerk for recording | Firm | Day 29 |  | Conditional |  |
| LP-40 | Scan all signed originals; upload to OneDrive | Firm | Day 31 |  |  |  |
| LP-41 | Generate estate plan summary | Firm | Day 33 |  | Skill: generate-estate-plan-summary |  |
| LP-42 | Draft closing / funding package | Firm | Day 34 |  | Skill: trust-funding |  |
| LP-43 | Deliver closing package to client | Firm | Day 35 |  |  |  |
| LP-44 | Send handwritten thank-you note | Firm | Day 35 |  |  |  |
| LP-45 | File legal plan claim (MetLife / LegalEASE / ARAG) | Firm | Day 38 |  | Skill: metlife-claim | _LP change: no longer conditional_ |

#### Funding

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| LP-46 | 30-day post-signing funding check-in | Firm | Day 58 | Nudge Day 58 (gentle) | Repeats every 30d |  |
| LP-47 | Confirm recorded deeds received from county | Firm | Day 58 |  | Conditional |  |
| LP-48 | Confirm all assets funded; close matter | Firm | — |  |  |  |


---

## 3. College Prep Plan (CP)

No PMPS, no trust, no deeds, no funding. Lead tasks count from the intro call, and nothing waits on a fit decision. Drafted as a starting point for the attorney to adjust.

### Lead tasks

_Created when the lead is opened. Ends at "Client signs engagement agreement", which converts the lead to hired._

#### Discovery

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-1 | Parent or student books intro call | Client | — |  |  |  |
| CP-2 | Hold intro call | Firm | Day of discovery call |  |  |  |
| CP-3 | Confirm the student turns 18 before signing, and note the move-in / orientation date | Firm | Day of discovery call |  |  |  |

#### Organizer Sent

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-4 | Send College Preparation Plan questionnaire | Auto | Day of discovery call |  | Auto |  |
| CP-5 | Student completes the questionnaire | Client | 5d after discovery call | Nudge 3d after discovery call (gentle) |  |  |

#### Planning Session

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-6 | Review answers; confirm the named agents are reachable | Firm | 6d after discovery call |  |  |  |

#### Recommendations Sent

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-7 | Send engagement agreement | Firm | 7d after discovery call |  |  |  |
| CP-8 | Client signs engagement agreement | Client | 10d after discovery call | Nudge 8d after discovery call (gentle)<br>Escalate 12d after discovery call (firm) | Starts Day 0; converts lead to hired |  |

### Matter tasks

_Created when the engagement is signed. Due dates count from that day (Day 0)._

#### Engaged

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-9 | Create matter folder in OneDrive | Auto | Day 0 |  | Auto; Skill: new-matter-folder |  |
| CP-10 | Send invoice / collect payment | Firm | Day 0 |  | Skill: cornerstone-billing |  |

#### Design

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-11 | Resolve the answers the student deferred to the meeting | Firm | Day 2 |  |  |  |
| CP-12 | Confirm power of attorney scope and HIPAA recipients with the student | Firm | Day 3 |  |  |  |
| CP-13 | Student approves the plan | Client | Day 5 | Nudge Day 4 (gentle) | Pauses clock |  |

#### Drafting

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-14 | Draft the student package (POA, health care proxy, HIPAA, living will) | Firm | Day 7 |  | Skill: draft-estate-plan-documents |  |
| CP-15 | Draft the FERPA release | Firm | Day 7 |  | Conditional |  |
| CP-16 | Check whether the school requires its own FERPA form or portal authorization | Firm | Day 8 |  | Conditional |  |
| CP-17 | Internal QA review of all documents | Firm | Day 9 |  |  |  |
| CP-18 | Deliver drafts for review | Firm | Day 10 | Nudge Day 9 (internal) |  |  |

#### Client Review

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-19 | Student reviews drafts and submits feedback | Client | Day 12 | Nudge Day 11 (gentle)<br>Escalate Day 13 (firm) | Pauses clock |  |

#### Revision

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-20 | Incorporate revisions | Firm | Day 13 |  | Conditional |  |
| CP-21 | Deliver revised drafts to the student | Firm | Day 13 |  | Conditional |  |

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
| CP-30 | Submit the FERPA release to the school | Firm | Day 17 |  | Conditional |  |
| CP-31 | Send the HIPAA authorization and health care proxy to the campus health center | Firm | Day 17 |  | Conditional |  |
| CP-32 | File legal plan claim if applicable (MetLife / LegalEASE / ARAG) | Firm | Day 20 |  | Conditional; Skill: metlife-claim |  |

#### Complete

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| CP-33 | Confirm documents delivered; close matter | Firm | — |  |  |  |


---

## 4. Probate

Broad milestones rather than a detailed checklist, filed under probate's own stages. Billing runs on three manual phases: opening, administration, closing. Existing probate matters keep their current checklist.

### Lead tasks

_Created when the lead is opened. Ends at "Client signs engagement agreement", which converts the lead to hired._

#### Discovery

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-1 | Collect death certificate and initial family information | Client | Day of discovery call |  |  |  |

### Matter tasks

_Created when the engagement is signed. Due dates count from that day (Day 0)._

#### Opening

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-2 | Confirm probate court, interested persons, original will, and asset inventory | Firm | Day 3 |  |  |  |
| PR-3 | Prepare opening petition and required notices | Firm | Day 10 |  |  |  |
| PR-4 | File opening documents and calendar citation or notice deadlines | Firm | Day 14 |  |  |  |

#### Petition Filed

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-5 | Track appointment and obtain fiduciary letters | Firm | Day 35 |  |  |  |

#### Appointed

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-6 | Complete asset inventory and creditor review | Firm | Day 75 |  |  |  |

#### Claims Period Over

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-7 | Prepare administration accounting and distributions | Firm | Day 140 |  |  |  |

#### Distributed

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-8 | Prepare closing statement or final account | Firm | Day 175 |  |  |  |

#### Estate Closed

| # | Task | Owner | Due | Nudge / escalation | Flags | Keep / revise / cut — notes |
|---|---|---|---|---|---|---|
| PR-9 | Confirm distributions, receipts, billing, and court close-out | Firm | Day 180 |  |  |  |

---

## Revision notes / new tasks

_Add anything that doesn't fit a row above: new tasks (with plan, list, stage, owner, due day), stage changes, or questions._

- 
