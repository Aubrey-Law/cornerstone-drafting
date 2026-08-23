# Architecture review — the lead / opportunity model

_Reviewed August 2026, alongside the lead-scoring work. Covers `client_intake`,
`matters`, the `cornerstone_crm_*` tables, and the admin leads UI._

This is a findings document, not a work plan. Each item records what is true
today and what it costs. Nothing here is scheduled; the three items that were
cheap and safe to fix were fixed alongside the scoring change and are marked
as such.

## 1. The opportunity is modeled three times over

One lead exists as rows in three tables, plus a partial fourth:

| Table | Role | Who reads it |
|---|---|---|
| `client_intake` | The de-facto lead record (~105 columns): identity, qualification, intake answers, engagement state | **The entire leads UI** |
| `matters` | Lifecycle owner: `relationship_status`, `stage`, and the dated anchors (`discovery_call_at`, `hired_at`, `lost_at`) | The leads list overlays it; matter pages own it |
| `cornerstone_crm_opportunities` | A CRM mirror, written only by triggers | Almost nothing — see §5 |
| `matter_details` | A partial copy of qualification data (`urgency`, `est_estate_value`, `referral_source`, `billing_type`) | Matter detail |

The practical cost is that "where does this field live?" has no general answer.
Adding a lead field means picking an owner, then deciding which of the other
three need it fanned out, and the fan-out happens in SQL triggers rather than in
application code where it would be visible to a reader of the route handler.

Lead scoring sidestepped this by deriving rather than storing (§5).

## 2. Bidirectional trigger sync has no single authoritative writer

`20260902000000_unify_crm_hub.sql` installs triggers in both directions:

- `sync_crm_person_from_intake()` and `sync_crm_opportunity_from_matter()` write
  the CRM mirror **from** `client_intake` / `matters`.
- `mirror_crm_opportunity_compatibility()` writes `client_intake.lead_status`
  and `matters.relationship_status` **back from** the mirror.

Cycles are broken only by `is distinct from` guards on each column. That works,
but it means no table is the authority: a write to any of the three can
propagate to the other two, and reconstructing why a value changed means reading
three trigger bodies rather than one code path.

**Consequence for application code:** never write `cornerstone_crm_opportunities`
directly. Write the source table and let the trigger mirror it.

## 3. Three parallel stage vocabularies

The same pipeline is spelled three ways, and nothing asserts they agree:

1. `cornerstone_crm_stages.slug` — 8 seeded values (`new_inquiry`, `intake_sent`,
   `intake_complete`, `engagement`, `converted`, `closed_lost`, `declined`,
   `needs_review`).
2. `matters.stage` — 5 lead stages plus the 12 matter stages in
   `types/database.ts` STAGES.
3. `LEAD_BOARD_COLUMNS` (`lib/leads/board.ts`) — 7 columns derived at render
   from timestamps, never stored.

A fourth vocabulary, the stage-*engine* keys in `stage_sla`
(`design_input`, `revisions`, `approved`, `closeout`, `matter_closed`), is
mapped onto by `map_matter_stage_to_engine()` — that one at least has a test
(`tests/stage-engine-keys.test.ts`) asserting the SQL and TS agree. The
intake→CRM-slug mapping has the same duplication (SQL
`crm_stage_slug_for_intake` and TS `leadBoardColumn`) with no equivalent test.

**Fixed alongside this review:** `matters.stage` had no CHECK constraint, so a
typo or retired key wrote cleanly and then failed the `stage_sla` inner join
inside `v_pipeline_aging` — dropping the matter off the aging board silently
rather than showing it wrong. `20261007000000_matters_stage_check.sql`
constrains the column (NOT VALID, then validated in a guarded block so legacy
rows cannot fail a deploy).

## 4. Status vocabularies disagree across five columns

| Column | Values |
|---|---|
| `client_intake.status` | intake lifecycle: `in_progress`, `submitted`, `approved`, `completed` |
| `client_intake.lead_status` | `lead`, `hired`, `lost`, `declined` — **no DB constraint**, enforced only in RPCs and Zod |
| `matters.relationship_status` | the same four, CHECK-constrained, with a transition-validating trigger |
| `matters.status` | `active`, `on_hold`, `closed`, `archived` |
| `cornerstone_crm_opportunities.status` | `open`, `won`, `lost`, `declined`, `needs_review` |
| `cornerstone_crm_people.lifecycle_status` | 7 values drawn from the *deprecated* stage set |

Two live consequences:

- **`lifecycle_status` is never updated by the sync triggers**, so every
  trigger-created person sits at `'new'` forever, and no application code
  writes it. It remains readable in the People table and usable as a campaign
  audience filter, where it is close to meaningless.

  _Correction (this review's first draft got this wrong):_ the first draft said
  the CRM conversion rate was computed from that dead column and was therefore
  not a conversion rate. That overstated it. `isConverted` checks
  `lifecycle_status` **first** but falls back to the person's stage against the
  won stages, and `stage_id` **is** maintained — `crm_stage_slug_for_intake`
  returns `converted` for a hired lead and that stage carries `is_won`. So the
  numerator was right all along; the dead branch is merely unreachable.
  The real defect was in the denominator — see §4a.
- **Fixed alongside this review:** `matchesProgress` in
  `lib/adminTables/leadTable.ts` tested `lead.status === 'lost'` — reading the
  *intake* status for a *lifecycle* value it can never hold. The branch was
  dead, and "fixing" it to read `lead_status` would have been worse: the leads
  client already filters lifecycle through its own status chips, so a
  second exclusion would have emptied the Lost tab whenever a progress filter
  was also applied. The dead line was removed and a regression test added.

## 4a. The CRM funnel counted people who cannot convert — fixed

`cornerstone_crm_people` is the whole contact base, not a lead list. The
contact sync writes a person row for every spouse, and since
`20260925000000_matter_contacts_join.sql` for every matter contact too —
children, successor trustees, health-care agents. Those rows are inserted at
`new_inquiry` and their `stage_id` is never advanced (the `on conflict do
update` deliberately omits it), so they are permanently open and never won.

`buildCrmDashboard` computed every funnel metric over all of them. The
consequences, all in the same direction:

- **Conversion rate understated.** The denominator carried every spouse and
  fiduciary. For an estate-planning practice — where most leads are couples and
  a funded trust names several fiduciaries — that is several unconvertible rows
  per matter. The regression test models six leads with two conversions plus
  four related contacts: 33% correct, 20% as it was computed.
- **Active pipeline inflated**, since `new_inquiry` is not a closed stage.
- **Stage occupancy skewed**, with a growing pile parked in the first column.
- **Lead sources skewed**, as contacts carry no `lead_source` and inflated
  "Unattributed".

Fixed by scoping the funnel to `person_kind = 'primary'` (`isPipelinePerson` in
`lib/crm/dashboard.ts`). "Total people" and the follow-up buckets still cover
the whole contact base, which is what those two are asking about.

**Still true after the fix:** the dashboard reads at most 500 people
(`fetchCrmPeople(500)`, ordered by `updated_at`), so once the contact base
exceeds that, the funnel is computed over a truncated and recency-biased sample
of leads — and contacts consume slots in that window without contributing to
it. Below 500 total people the numbers are exact. See §6.

## 5. Dormant columns and unread surfaces

- `cornerstone_crm_opportunities.confidence_score` (smallint, CHECK 0–100) is
  read and written by nothing. It was the obvious home for a lead score, and
  scoring deliberately did **not** claim it — see below.
- `expected_close_date` is never written. `expected_value` is only ever a
  trigger copy of `engagement_fee_quoted`. `practice_area` and `service_type`
  hold the same value in two columns.
- `twenty_opportunity_id`, `twenty_contact_id`, `twenty_company_id`,
  `sync_state`, `last_synced_at` are leftovers of an abandoned CRM sync.
- `/admin/crm/opportunities` re-exports the leads pages, which read
  `client_intake` + `matters`. The opportunities table and
  `v_cornerstone_crm_opportunities` are effectively write-only.
- **Fixed alongside this review:** `lib/queries/leads.ts` exported an
  `insertCrmActivity` that did nothing — a no-op any caller would reasonably
  believe was recording activity. It had zero callers and was deleted.

### Why lead scoring does not persist a score

The score is computed at render (`lib/leads/score.ts`) and stored nowhere:

- Every surface that displays it reads `client_intake` + the `matters` overlay.
  Nothing displaying a score reads the opportunities mirror, so persisting there
  would buy no read.
- The score moves with `last_activity_at`, so a stored copy is stale the moment
  anything touches the lead.
- Writing the mirror directly means entering the bidirectional trigger loop in §2.

`confidence_score` was the obvious slot, and it is now gone with the rest of the
mirror (§5a). If scores ever need to be queried in SQL — a "hot leads" digest,
or server-side ranking over more than the 200 rows the list loads — the column
belongs on `client_intake` alongside the other lead fields, written by the lead
PATCH route rather than by a trigger.

## 5a. The mirror is retired

`20261008000000_retire_crm_opportunity_mirror.sql` stops
`cornerstone_crm_opportunities` being written and stops it writing back. This
also closes out §2: with the mirror inert, the bidirectional trigger loop is
gone and `client_intake` / `matters` are the only writers of lead lifecycle.

What the investigation established before anything was changed:

- **One** application read existed (`lib/queries/crmHub.ts`, the CRM activities
  page), using the mirror for a display label and an intake id. Both come from
  `cornerstone_crm_people` via `person_id`, so the read was re-pointed and the
  rendered column is unchanged.
- **Zero** application writes. Every row was trigger-produced.
- The write-back was a **loop, not an inbound path** — nothing outside the
  database wrote the mirror, so it could only echo values the sync triggers had
  just derived from `client_intake` and `matters`. It was also already inert:
  27 production rows sat with a NULL `lead_status` against a `hired` matter and
  a `won` opportunity, and the app ran fine on them.
- The `opportunity.*` outbox has no consumer; 415 rows sit `held`.

One trap was worth the whole investigation. `sync_crm_activity_from_lead_activity()`
returned early when no opportunity row existed, so stopping the mirror without
touching it would have silently stopped mirroring **every new lead's** timeline
into the CRM activities page while old leads kept working — a failure that looks
like nothing at all. Verified against a scratch Postgres running the full
migration chain: with the old guard the activity does not land; with the guard
relaxed to require only `person_id`, it does.

**The table itself still exists**, deliberately. Code and schema deploy in no
guaranteed order, so the release before this migration must keep finding it.
Dropping it is a follow-up, and not a one-liner: `cornerstone_crm_activities.opportunity_id`
holds an `ON DELETE CASCADE` FK that would take all 235 activity rows with it,
and `v_cornerstone_crm_opportunities` and `v_cornerstone_crm_parity` are hard
`DROP` blockers. The order is recorded in the migration header and in the
table's own `COMMENT`.

## 6. Truncation limits are invisible to the reader

- `app/admin/leads/page.tsx` loads at most 200 leads and 2,000 activity rows.
- `fetchCrmPeople(500)` in `lib/queries/crmDashboard.ts`;
  `.limit(5000)` in `lib/queries/crmOperations.ts`.

Every filter, sort and insight card — now including the lead score — is computed
client-side over that truncated set. At current volume this is correct; past 200
open leads the list silently ranks a subset, and the dashboard's counts become a
sample rather than a total. Nothing in the UI says so. Server-side ranking and
pagination is the fix whenever the firm's lead count approaches that bound.

## 7. Audit-trail gaps

- `matter_relationship_status_history` records relationship transitions and is
  insert-only. Its CHECK omitted `'declined'` when v3 introduced that state;
  **this was already corrected** in `20260824000000_matter_lifecycle_v3.sql`
  (lines 30–38). Verified during this review, no action needed.
- ~~There is **no stage-change history** for `matters.stage`.~~ **Fixed** by
  `20261009000000_matter_stage_history.sql` — see §7a.
- The `opportunity_stage_changed` activity's idempotency key was
  `id || ':' || epoch(updated_at)`, so two stage changes in the same second
  collided and the second was dropped. Moot as of §5a: the trigger that wrote
  it is gone, and `matter_stage_history` now records stage transitions properly.
- Field-level edits emit one generic `details_updated` activity carrying no
  before/after values.

## 7a. Stage history

`matter_stage_history` records every `matters.stage` transition — insert-only,
staff-read, written by a trigger on the column so no caller can forget it. It
answers what nothing could before: how long a matter actually sat in Drafting,
whether it was walked backwards, and who moved it.

Two deliberate departures from the `matter_relationship_status_history`
precedent it otherwise copies:

- **The stage columns carry no CHECK.** That precedent is the cautionary tale:
  its CHECK was written with three states, lifecycle v3 added `declined`, and
  the constraint was left behind until `20260824000000` caught it. Stage has a
  much larger vocabulary that has already moved more than once — `discovery_call`
  added, `design_input` split, `revision` reordered. A history table records what
  happened; pinning it to today's vocabulary means the next stage change either
  breaks the audit insert or silently blocks a legitimate transition. The
  constraint belongs on `matters.stage` itself, which is where §3 put it.
- **`entered_at` is separate from `created_at`.** Since `20260910000000` a caller
  can pin `stage_entered_at` — the discovery anchor sets it to the date of the
  call, not the date of the write — so the business date and the write moment are
  different facts and a duration computed from the wrong one would be wrong.

The backfill seeds one row per existing matter from its own `stage_entered_at`,
with a null `from_stage`. Earlier transitions were never recorded anywhere and
cannot be recovered, so the timeline starts from today rather than inventing
history; the table `COMMENT` says how to tell a seeded row from an observed one.

**It is surfaced on the matter page.** `MatterStageHistoryCard` sits in the
Overview stack beneath `MatterProgressTimeline`: that rail shows where a matter
is, this shows how it got there and how long each stage took. Rows are read by
`fetchMatterStageHistory` (`lib/queries/matterStageHistory.ts`) and shaped into
intervals by `buildStageTimeline` (`lib/matters/stageTimeline.ts`) — the stored
rows are transitions, and the duration of a stage is derived from when the next
one began.

Three details the card has to respect, all consequences of the table's design:

- The earliest row is a **starting point, not an observed move** — either the
  matter's creation or the seeded backfill row — so it reads "Recorded from …"
  rather than inventing a stage it moved out of.
- Stage keys are unconstrained, so `historicalStageLabel` falls back to
  title-casing anything no longer in `STAGES`; a renamed stage still renders.
- Durations come from `entered_at`, the business date, never `created_at`.

`buildStageTimeline` lives outside the `server-only` query module so the client
card and the server reader share one definition of the shape.

## 7b. The aging board could not see a matter churning

The aging board measures from `matters.stage_entered_at`, and
`trg_matters_stage_entered_at` resets that column to `now()` on every stage
change. Re-entering a stage therefore restarts the clock — which is precisely
what the revision loop does. A matter bounced from Client Review to Revision and
back arrives in Client Review looking brand new, and can cycle for months
without any single visit growing long enough to turn the SLA red. The board's
whole job is surfacing what needs attention, and this was invisible to it.

`matter_stage_history` holds the earlier visits, so `v_matter_stage_totals`
(`20261010000000`) aggregates them: per matter and stage, how many times it has
been entered and the total time spent there. The aging board now shows that
total beneath the SLA bar whenever a stage has been entered more than once — a
row reading "6/10d" alongside "50d total · 3 visits" is the case the SLA cannot
otherwise catch.

Two decisions worth recording:

- **Business days, not calendar days.** The totals reuse the same
  `business_days_elapsed` the board already uses (it takes an explicit end, and
  excludes weekends and `firm_holidays`), so the two numbers sitting side by
  side are the same unit. A calendar-day total next to a business-day SLA would
  quietly misread.
- **Health was initially left unchanged**, then folded in deliberately as a
  separate decision — see §7c.

## 7c. Cumulative time now breaches the SLA

`20261011000000` makes the total count, not just display. `stage_sla` gains
`cumulative_sla_days` — a second threshold measured across every visit, seeded
at twice the per-visit budget and editable per stage in **Settings → SLA**
alongside the others. `is_overdue` and `health` go red when *either* the current
visit exceeds `sla_days` or the total exceeds `cumulative_sla_days`.

Three boundaries drawn on purpose:

- **`needs_outreach` is untouched.** It decides when a *client* is chased, and
  `escalation_offset` fires before the SLA. Nudging someone over time their
  earlier round consumed would be wrong when the current round is days old.
- **Amber is untouched.** It warns that the current visit is nearly due, which
  is still a per-visit question. Cumulative time only ever triggers red.
- **A snooze still suppresses everything**, cumulative breach included.

It also fixed a real defect shipped with §7b. `v_matter_stage_totals` is keyed
by the raw `matters.stage`, but the aging board keys matter rows by the *engine*
stage from `map_matter_stage_to_engine()`. Those differ across half the
vocabulary — raw `revision` is engine `revisions`, and `intake` and
`intake_review` both fold into `design_input` — so the TypeScript join matched
nothing for exactly the revision loop it was built for. Matter rows now
re-aggregate totals by engine key inside the view, which also correctly sums the
two raw stages sharing one engine key, and the TypeScript join is gone rather
than left to disagree.

**One consequence worth knowing.** `TodayQueue`'s `waitingOnClient` bucket is
`health !== 'green'`, and its "Nudge all" button emails that set. More rows
turning red therefore widens what that button would send — still behind an
explicit click and a preview dialog listing every recipient, but the set is
larger than before. Nothing sends automatically: the SLA nudge cron is driven by
`tasks.nudge_at`, not by health, and the only cron that reads health is the
daily digest, which goes to the attorney.

The view also carries `client_intake_id`, because `v_pipeline_aging` keys matter
rows by matter id and lead rows by intake id, and the reader needs to match
either without a second round trip.

## 8. Typing

`LeadDetailRecord` (`lib/leads/viewTypes.ts`) carries an
`[key: string]: unknown` index signature, so every field access through it
type-checks whether or not the field exists. That is what allows
`intake_status` — documented in `lib/leads/readiness.ts` as *not a column on
that table* — to flow through the detail record as an optimistic client-only
value without anything objecting.

## Ranked recommendations

Not scheduled; ordered by value per unit of risk.

1. ~~**Fix the CRM conversion rate.**~~ Done — see §4a. The cause was not the
   one this review first named; the denominator counted contacts who cannot
   convert, rather than the numerator reading a dead column.
2. ~~**Retire or adopt the CRM mirror.**~~ Retired — see §5a. The remaining step
   is the physical `DROP TABLE`, which needs its own migration once the release
   that still reads the old shape is gone; §5a records the required order.
3. ~~**Add a stage-history table.**~~ Done and surfaced on the matter page — see
   §7a, and now feeding time-in-stage on the aging board — see §7b.
4. **Assert the stage vocabularies agree** (§3), the way
   `tests/stage-engine-keys.test.ts` already does for engine keys.
5. **Server-side ranking and pagination for leads** (§6), before volume makes
   the truncation matter.
6. **Drop the dead Twenty-sync columns** (§5).
