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

The same pipeline is spelled three ways, and until this review nothing asserted
they agree:

1. `cornerstone_crm_stages.slug` — 9 seeded values (`new_inquiry`,
   `discovery_call`, `intake_sent`, `intake_complete`, `engagement`,
   `converted`, `closed_lost`, `declined`, `needs_review`).
2. `matters.stage` — 5 lead stages plus the 12 matter stages in
   `types/database.ts` STAGES.
3. `LEAD_BOARD_COLUMNS` (`lib/leads/board.ts`) — 7 columns derived at render
   from timestamps, never stored.

A fourth vocabulary, the stage-*engine* keys in `stage_sla`
(`design_input`, `revisions`, `approved`, `closeout`, `matter_closed`), is
mapped onto by `map_matter_stage_to_engine()` — that one at least has a test
(`tests/stage-engine-keys.test.ts`) asserting the SQL and TS agree. The
intake→CRM-slug mapping had the same duplication (SQL
`crm_stage_slug_for_intake` and TS `leadBoardColumn`) with no equivalent test.

**Fixed alongside this review — the test:**
`tests/stage-vocabulary-parity.test.ts` parses the live SQL — the CHECK's stage
list, the `stage_sla` seeds, the CRM stage seeds and the
`crm_stage_slug_for_intake` ladder — and holds it against the TypeScript. It asserts the CHECK permits exactly the lead stages plus
`types/database.ts` STAGES; that every stage it permits reaches a `stage_sla`
row (directly for a lead, through `PIPELINE_TO_ENGINE` for a matter), with
`matter_closed` asserted to have *no* row since both aging views exclude it
before the join; that every slug the SQL can return has a seeded
`cornerstone_crm_stages` row, so the mirror's lookup cannot silently set
`stage_id` to null; and that the SQL ladder and `leadBoardColumn()` place the
same lead in corresponding buckets, in the same order of precedence. The
correspondence is written out rather than derived, because it is not one to
one — the board has no discovery or needs-review column — so a new arm on
either side has to be placed deliberately.

**Fixed alongside this review — the constraint:** `matters.stage` had no CHECK,
so a typo or retired key wrote cleanly and then failed the `stage_sla` inner
join inside `v_pipeline_aging` — dropping the matter off the aging board silently
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
- ~~`twenty_opportunity_id`, `twenty_contact_id`, `twenty_company_id`,
  `sync_state`, `last_synced_at` are leftovers of an abandoned CRM sync.~~
  **Dropped.** `twenty_opportunity_id` went with the mirror (§5b); the other
  four went in `20261013000000_drop_twenty_sync_columns.sql`. Verified dead
  against production first: of 221 people, none carried a Twenty contact or
  company id and none had ever been synced. `sync_state` read `'pending'` on
  every row — the triggers wrote that literal on insert and nothing ever
  advanced it, so a column with one value across the whole table was telling a
  reader a sync was queued when none existed.

  Two mechanics worth keeping, both learned the hard way here: the person-sync
  triggers named `sync_state` in their INSERT lists, so the same
  execution-time-resolution trap as §5b applied and both were rewritten first;
  and `create or replace view` can only *append* columns, so
  `v_cornerstone_crm_people` had to be dropped and recreated rather than
  replaced. `cornerstone_crm_sync_events` is untouched — it is the outbox
  itself, not a Twenty artefact, and the CRM sync page reads it.
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

**The table was left in place** at the time, deliberately: code and schema deploy
in no guaranteed order, so the release before that migration had to keep finding
it. It has since been dropped — see §5b.

## 5b. The mirror is gone

`20261012000000_drop_crm_opportunity_mirror.sql` removes the table, its dependent
view, the `opportunity_id` column on `cornerstone_crm_activities`, and the 415
dead `opportunity.*` outbox rows. No snapshot was kept: every value in those 85
rows was derived by trigger from `client_intake` and `matters`, so there was
nothing in them that those tables do not still hold.

**A correction to §5a.** That section, the #316 migration header and the table's
`COMMENT` all warned that a bare `drop table ... cascade` would destroy all 235
CRM activity rows through the `ON DELETE CASCADE` foreign key. **That is wrong.**
`ON DELETE CASCADE` is a row-level referential action that fires on `DELETE`; it
does nothing on `DROP TABLE`, which simply drops the constraint and leaves the
referencing rows alone. Verified directly: after a bare `drop table ... cascade`
on a scratch copy, `cornerstone_crm_activities` still held every row.

Two real hazards remained, and the ordering still matters for them:

- A bare cascade **drops `v_cornerstone_crm_parity` outright** — all four arms,
  three of which never touched the mirror. It is rebuilt here without the
  `opportunities` arm instead.
- It leaves `opportunity_id` behind as a column of dangling ids pointing at a
  table that no longer exists.

And one hazard nothing had recorded, which is the one that would actually have
caused an outage: **two trigger functions still named `opportunity_id` in their
INSERT column lists.** plpgsql resolves columns at execution, so dropping the
column without rewriting `sync_crm_person_from_intake` and
`sync_crm_activity_from_lead_activity` would not fail the migration — it would
fail *every* `client_intake` and `lead_activity` write from that moment on. It
surfaced only because the migration was exercised against a real Postgres; the
first run broke lead creation outright.

One more consequence worth recording: `cornerstone_crm_activities` had a CHECK of
`person_id is not null or opportunity_id is not null`, and Postgres drops any
constraint involving a dropped column. Removing `opportunity_id` silently took
that guarantee with it, so the migration restores it as
`person_id set not null` — the only form that still means anything.

## 6. Truncation limits are invisible to the reader

- ~~`app/admin/leads/page.tsx` loads at most 200 leads and 2,000 activity rows.~~
- ~~`fetchCrmPeople(500)` in `lib/queries/crmDashboard.ts`;
  `.limit(5000)` in `lib/queries/crmOperations.ts`.~~

Every filter, sort and insight card — including the lead score — was computed
client-side over that truncated set. At the volume this was written at (56 lead
rows) it was correct and invisible; past 200 open leads the list would have
ranked a subset while still reading as the whole pipeline.

**Fixed for the leads list:** `v_lead_list` and `lead_score()`
(`20261014000000_lead_list_ranking.sql`) moved filtering, searching, sorting and
ranking into the database, and `lib/queries/leadList.ts` returns one page of
that ordering with an exact count. The list says which page it is showing and
of how many, and "Load more" asks for the next — so the bound is now stated
rather than hidden. Ranking by lead score is why the score had to exist in SQL
too: ordering by a number computed in the browser can only rank what the
browser already holds. `tests/lead-score-sql-parity.test.ts` holds the two
definitions together.

The tab counts and the insight cards are counted over the whole pipeline rather
than the loaded page, deliberately: the cards are how the reader sees what a
filter or a page boundary is hiding, so counting the page would have made them
agree with the list by construction.

**Fixed for the CRM dashboard:** the overview counted the first 500 rows of
`cornerstone_crm_people` and presented the result as the firm's whole book. At
221 contacts that was already 44% of the cap, and the contact sync adds several
rows per matter — a spouse, children, fiduciaries — so it was the limit closest
to biting. `fetchCrmDashboardPeople()` now reads the whole contact base in
narrow pages (only the seven columns the counts read, ordered on a unique pair
so pages partition rather than overlap), and the eight rows the recent-people
table renders are read separately with the joins that table needs. A ceiling
remains at 25,000 contacts, but reaching it renders a line on the page saying
the counts are a sample — the objection to the old cap was never the number,
it was the silence.

`lib/queries/crmOperations.ts` and `app/admin/crm/CrmActionQueue.tsx` were
deleted rather than fixed: nothing rendered the action queue, so those
`.limit(5000)` reads never ran. A dead reader with a lurking limit is worse
than no reader — it reads as covered.

## 6a. The same limit was hiding the day's work — fixed

§6 caught the truncation in the leads list. The identical pattern was live on
the Today page and had already crossed its cap: `fetchTodayData()` read
`fetchTasks({ status: 'open', limit: 500 })` and picked the overdue and
due-today rows out in JavaScript.

Measured on 2026-08-24: **1,024 open firm tasks**, of which 27 are overdue and 1
is due today. A PostgREST read with a `limit` and no `order` returns an
arbitrary 500 of the 1,024 — in heap order the first 500 held **1 of the 27**.
So the page said "1 task overdue" and listed one row.

The nav badge did not agree with it. `fetchTaskCounts()` reads the same tasks at
`limit(2000)`, which still covers the whole table, so the badge said 27. Two
counts of the same thing, 26 apart, with nothing on screen to say which was
right — and the queue, the surface that exists to be worked top to bottom, was
the one that was wrong.

**Fixed:** `fetchDueTasks()` asks the database for the due window instead of
slicing an unordered read — a three-branch filter mirroring `effectiveDueAt`'s
precedence (`due_at`, then `soft_due_at`, then `hard_due_at`), bounded at the
end of today in the firm's timezone. It returns 28 rows today rather than 500,
and it is a filter, so nothing falls off the end of it. The 500-row cap stays as
a backstop and now logs when it is reached, because the defect being fixed was a
silent truncation, not a small one.

The predicate was checked against all 1,024 production rows: it selects exactly
the same set as `coalesce(due_at, soft_due_at, hard_due_at) <= end of today`,
with zero disagreements. `tests/today-due-tasks.test.ts` evaluates the filter
string itself against `effectiveDueAt` over every combination of the three
columns, so a test restating the branches cannot agree with a wrong version of
them.

### 6b. The other five reads — fixed

The same capped read stood behind five more surfaces, each past its cap, and
each has been given the read it was actually asking for:

| Surface | Was | Is |
|---|---|---|
| `app/admin/tasks/page.tsx` | An arbitrary 500 of 1,024 | Every open task, read in pages ordered on `(created_at, id)` |
| `app/api/admin/calendar/plan/route.ts` | An arbitrary 1,000 of 1,024 | The due window through the end of the plan range, plus a second read for undated work carrying an estimate |
| `app/api/cron/calendar-week-review/route.ts` | An arbitrary 500, filtered to overdue | The due window |
| `lib/adminChat/calendarTools.ts` (two tools) | An arbitrary 500, filtered to overdue | The due window |
| `lib/calendarAttention.ts` | An arbitrary 500, filtered by matter and by title | Tasks on the matters that appear on the day's calendar, and a title-filtered read for the follow-up rail |

The Tasks page is the one that had to be paged rather than filtered: it is the
firm's whole open queue and its scope, source and assignee filters run over
whatever it was handed, so a cap there does not shorten the list so much as
choose an arbitrary part of it to filter. Paging needs a total order —
`created_at` alone is not one, so the read orders on `(created_at, id)`. The
20,000-row ceiling is a runaway guard rather than a display limit, and reaching
it is logged.

`fetchTasks` gained the plain-column filters those reads needed — `matterIds`,
`undated`, `hasEstimate`, `titleLike` — deliberately none of which spend the
one `or=` parameter a PostgREST request can carry, since `recordId` already
owns it. The title filter is a `title ilike any (…)` superset that the caller's
regex still narrows; checked against production, it returns all 75 rows the
regex matches and misses none.

### 6c. The due date the database can sort on — fixed

The five reads above are each exactly expressible without a schema change, and
were written that way. Two were not, because they do not want a *subset* — they
want the most urgent N, which is an ordering question:

- `lib/queries/crmDashboard.ts` takes 5 rows for the CRM Tasks card, which was
  an arbitrary 5 of 1,024.
- `lib/queries/stageTasks.ts` read at the 500 default and kept whichever rows
  carried a `stage_key`. No open task carries one today, so it returned nothing
  either way — the kind of read that stays wrong quietly once that changes.

PostgREST orders by columns, not expressions, and the app's working due date is
`coalesce(due_at, soft_due_at, hard_due_at)`. So
`20261016000000_task_effective_due.sql` stores it:

```sql
alter table public.tasks
  add column effective_due_at timestamptz
    generated always as (coalesce(due_at, soft_due_at, hard_due_at)) stored;
```

Generated and stored, so nothing can write a different value into it and the
sort can be indexed — Postgres rejects an insert that names the column, which
is what keeps it from drifting the way a trigger-maintained column would.
`tests/task-effective-due-parity.test.ts` holds the SQL to `effectiveDueAt()`
the way `tests/lead-score-sql-parity.test.ts` holds `lead_score()` to
`computeLeadScore()`; verified on the scratch database over all 27 combinations
of the three columns being early, late, or absent, with one all-null row
yielding null and an update to `due_at` moving the stored value with it.

**Every read is now ordered, not just the paged ones.** An unordered `limit` is
what made a capped read arbitrary, so `fetchTasks` orders on
`(effective_due_at nulls last, id)` on every path: a cap now keeps the most
urgent rows and drops the furthest-off ones, and paging has the total order it
needs — `effective_due_at` is null on 831 of the 1,024, so the `id` tiebreak is
load-bearing rather than decorative. `fetchDueTasks` is a single `lte` on the
column instead of a three-branch filter over the raw columns.

The index leads on `owner` rather than `status`:

```sql
create index tasks_open_effective_due on public.tasks (owner, effective_due_at)
  where status <> 'done';
```

Every queue read fixes `owner` — a client's "sign the engagement agreement" is
not the attorney's work — and takes a *range* of statuses, and a leading column
under an inequality cannot order what follows it. Checked on 3,000 seeded rows:
the plan is an index scan with `Presorted Key: effective_due_at`, so the sort
comes from the index. `tasks_open_due`, which indexed the same expression as an
expression for the same sort, is dropped in the same migration: the planner
will not match a column reference to it, so it would cost every write and serve
no read.

**One consequence to schedule:** a new column drifts
`types/supabase.generated.ts` (§8a) until it is regenerated. The scheduled
check will flag it after this merges; running **Database types drift** from the
Actions tab with `open_pr` raises the regeneration itself.

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

## 8a. The generated types described a schema that no longer existed

`types/supabase.generated.ts` is produced by `npm run db:types:linked` and
checked in, and nothing ever verified it. By the end of this review it was four
merged migrations out of date in both directions: still declaring
`cornerstone_crm_opportunities`, its view, and the three Twenty sync columns —
all dropped — while knowing nothing about `matter_stage_history`,
`v_matter_stage_totals`, `stage_sla.cumulative_sla_days` or `v_lead_list`.

Nothing broke, and that is the point. Nearly all database code runs through the
permissive compatibility `Database` in `types/supabase.ts`, where every column
access type-checks whether or not the column exists (§8). Only three call sites
use the real generated types — `lib/workflowJobs.ts`, `lib/billing/schedules.ts`
and the matter-type route — and they were being checked against a schema the
database had moved on from.

**Fixed:** `.github/workflows/db-types-drift.yml`. The comparison against the
deployed database runs on a schedule rather than on pull requests, because a
branch that adds a migration is *supposed* to carry types the database does not
have yet — the same reason `db-migration-drift.yml` keeps `--strict` off its
pull-request run. It also stays off `push` to `main`, where it would race the
migration deploy. Pull requests get the credential-free structural check only.

Regenerating needs credentials that a development container has neither of:
`--db-url` and `--local` need Docker, `--linked` and `--project-id` need an
access token. So the workflow that finds the drift can also fix it — dispatched
with `open_pr`, it regenerates and raises the pull request itself. That path is
a separate job rather than a conditional permission, because `permissions:`
takes no expressions: an expression there does not fail the step, it
invalidates the whole workflow file.

Opening the pull request needs one repository setting — Settings → Actions →
General → Workflow permissions → *Allow GitHub Actions to create and approve
pull requests*. With it off, the regenerated branch is still pushed and the
step prints the setting to change and a compare link, rather than a bare
GraphQL error.

## 9. The pipeline had no working priority signal — second review

The first eight sections are about whether the data is right. This one is about
whether the reader can act on it, and the answer was no: every mechanism built
to say "work this lead next" was saying the same thing about nearly every lead.
Measured against production on 2026-08-24, 35 open leads:

| Signal | What it said | Why it said nothing |
|---|---|---|
| Aging board, lead rows | 27 red, 12 amber, **0 green** | A board that is never green has no foreground |
| `new_lead` | 13 rows, all red, avg **12 days** against a **1-day** SLA | An SLA missed 13 times out of 13 is a wall, not a queue |
| `discovery_call` | 12 rows **amber at 0 days** | The clock starts at the *scheduled* call, so a booking reads as aging |
| `intake_completed` | 10 red, avg **1,498 days**, max **14,864** | One lead's milestone is dated **1969-09-02** |
| Score bands | **0 hot**, 2 warm, 20 cool, 13 cold; best 63 | "Hot" was unreachable — see §9a |
| Lead tasks | **0**, ever ⚠️ **wrong — see §9e** | Measured on `tasks.lead_id`, which nothing writes. A lead's tasks hang off its `matters` row, and there were 1,021 of them |

### 9a. The score banded against points a lead cannot earn — fixed

`computeLeadScore()` bands at hot ≥ 70 of 100, but 45 of those 100 points are
for questions nobody asks before the planning session. Of 35 open leads, 1 has a
fee quoted, 3 an estate value, 2 an urgency; readiness is always absent on a
list row. The best real lead scored 63, so no lead was ever hot and nearly every
badge read Cool or Cold — the pipeline looked worthless rather than sorted.

**Fixed:** the band now reads the share of the points a lead could actually
earn. Each component carries `available`, and both sides of the fraction read
the same components. The distinction that matters is between an answer and
silence: "no intake sent yet" and "no meeting booked" are answers and stay in
the denominator; "no fee quoted" pre-engagement is silence and leaves. The raw
0–100 score is untouched, because the list orders by it and `lead_score()` in
SQL mirrors it (`tests/lead-score-sql-parity.test.ts`).

### 9b. A booked call read as a lead going cold — fixed

`ensure_lead_matter()` sets a lead's `stage_entered_at` to the milestone behind
its stage, which for `discovery_call` is the scheduled call — often days ahead.
`business_days_elapsed()` returns 0 for a future start, and the amber rule
(`days >= sla_days - 1`) fires at 0 when the SLA is one day, so every booked
call sat amber from the moment it was booked.

**Fixed** in `20261015000000_lead_scheduled_not_aging.sql`: a lead whose clock
has not started is `is_scheduled`, reads green, and owes nothing — the board
shows the date instead of a colour. Amber now requires `sla_days > 1`, because a
one-day budget has no approach to it, only inside or outside. The Today queue
needed no change: it filters on `health !== 'green'`, so scheduled leads leave
it on their own, and the booked call already appears under appointments.

### 9c. One typo ran a clock for forty years — surfaced

A lead carries `discovery_call_at = 1969-09-02`, which became its stage clock
and reported 14,864 days. The same date reached the row twice — once as the
clock, once through the stage-history row it wrote, where it totalled 14,860
business days and turned the row red by the cumulative rule instead. Both paths
are now guarded: a milestone predating its own record by more than a year is
measured from creation, and the row is flagged `stage_clock_suspect` so the
board asks for the date to be checked. Deliberately *surfaced* rather than
corrected — a silently fixed date never gets fixed at source.

### 9d. Left for a decision

- **The `new_lead` SLA is one business day and was missed on all 13 leads**
  (avg 12 days, worst 30). Whether to change the promise or the staffing is a
  firm decision, and quietly relaxing the SLA to match performance would be
  moving the goalposts, so nothing here touches it.
- ~~**No lead has ever had a task.**~~ **This was wrong — see §9e.** Leads carry
  more tasks than matters do; the row above was measured on the wrong column.
- **34 of 35 open leads have no fee quoted**, so "Quoted pipeline" reads $0.
- **22 of 35 have no lead source**, so the sources donut is mostly Unattributed.
- **One object, five names**: nav "CRM", page header "Opportunities", route
  `/admin/leads`, detail URL `/admin/crm/opportunities/{id}`, dashboard
  "People".

### 9e. The lead-task finding was wrong, and the truth was the opposite — fixed

§9 reported "0 lead tasks, ever" and recommended generating them or removing the
surfaces. Both the finding and the recommendation were wrong, and the mistake is
worth recording because of how it was made: the count was
`tasks.lead_id is not null`, which is **0 across all 1,469 rows** — nothing has
ever written that column. A lead's plan is generated against the `matters` row
`ensure_lead_matter()` creates for it, so its tasks carry `matter_id`.
`lib/tasks/closeout.ts` had this right all along and matched both columns; the
measurement did not.

Read the other way, on 2026-08-24:

| | leads | matters |
|---|---|---|
| Active records | 39 | 38 |
| Open tasks | **1,021** | 227 |

**Leads hold 1,021 of the firm's 1,024 open tasks** — about 43 each. That is not
a pipeline being worked; it is `ensureLeadSlaTasks` generating the whole
48-task estate-planning template on the day a lead is created. Only 11 of those
templates are pre-engagement. The rest is drafting, signing, funding and
post-execution work for a plan nobody has bought: **783 such tasks across 25
leads**, 709 of them firm-owned, and **24 leads carrying post-execution tasks**.
It is most of what filled the Today queue and the Tasks page in §6a.

Two separate defects, both fixed:

**The lead Tasks tab could not see them.** `fetchTasksForLead(intakeId)` filtered
`matter_id.eq.{intakeId},lead_id.eq.{intakeId}`, and the intake id is never a
matter id — so the tab and its count badge read zero on a record holding 43 open
tasks. (The Plan view worked: it is handed `lead.matter_id` directly.) The read
now resolves a lead's matter the way the closeout sweep always did.

**The unsold half is held back.** `ensureLeadSlaTasks` still generates the plan
whole — the dated plan is what the Plan view reads, and generating less would
mean reconciling at conversion — and then archives everything from the `intake`
phase onward behind `closeout_reason = 'not_engaged'`
(`20261017000000_task_not_engaged_closeout.sql`). Conversion releases exactly
those rows, scoped to that reason so converting a lead that had gone lost does
not also revive what the lost sweep archived. It reuses the mechanism
20261006000000 already built rather than growing a second one, which means the
hold-back is reversible and a hand-added task — which carries no phase — is
never touched.

The boundary is read as an index into `SLA_PHASES` rather than restated as a
second list: that list is "lead stages, then matter stages", and `intake` is the
first stage a signed engagement reaches. `scripts/holdBackUnsoldLeadTasks.ts`
clears the existing backlog through the same helper the live path uses, dry by
default.

**What this says about the review.** A count of zero is the easiest wrong answer
to believe, because it looks like an absence rather than a mistake. §9 had
production data behind every other row in that table and still shipped a
recommendation — "generate them or remove the surfaces" — that would have added
tasks to a pipeline drowning in them.

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
4. ~~**Assert the stage vocabularies agree**~~ (§3). Done —
   `tests/stage-vocabulary-parity.test.ts`, the way
   `tests/stage-engine-keys.test.ts` already does for engine keys.
5. ~~**Server-side ranking and pagination for leads**~~ (§6). Done — the leads
   list ranks and pages in the database, and the CRM dashboard counts the whole
   contact base.
6. ~~**Drop the dead Twenty-sync columns**~~ (§5). Done —
   `20261013000000_drop_twenty_sync_columns.sql`.
7. ~~**Keep the generated database types honest**~~ (§8a). Done — a scheduled
   check compares them against the deployed schema.
8. ~~**Give the pipeline a working priority signal**~~ (§9). Done for the score
   bands, the scheduled-call clock and the impossible-date guard; §9d lists what
   was deliberately left for a decision.
9. ~~**Finish the truncation sweep for tasks**~~ (§6a–§6c). Done: Today, the
   Tasks page, the calendar plan route, the calendar attention read, the
   weekly-review cron, the admin chat tools, the CRM Tasks card and the
   stage-task read. `tasks.effective_due_at` gives every capped read an
   ordering, so a cap keeps the most urgent rows instead of arbitrary ones.
