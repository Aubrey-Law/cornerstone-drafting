# Discovery call advances the lead stage

**Date:** 2026-08-11
**Status:** Approved, ready for implementation planning

Two independent changes to the pipeline SLA, specified together because both came
out of the same review. Part 1 is the substantial one; Part 2 is a three-line
ordering correction that can ship on its own.

---

## Part 1 — A `discovery_call` lead stage

### Problem

A lead that has had its discovery call shows red on the pipeline aging board
against a clock that already expired, for work nobody is late on.

Three defects combine to produce this:

1. **The anchor is never recorded automatically.** `matters.discovery_call_at` is
   written by exactly one caller: the manual `PATCH /api/admin/matters/[id]/sla-anchors`
   route. Booking a discovery call does not stamp it — `lib/appointments/book.ts`
   only creates a lead and optionally sends the intake invite. Every v3 task
   anchored to `discovery_call` therefore stays unscheduled until an attorney
   types the date into the Key Dates panel by hand.

2. **Setting the anchor does not move the stage.** `matters.stage` is written only
   by `ensure_lead_matter()`, a trigger on `client_intake` scoped to
   `update of lead_status, intake_sent_at, intake_completed_at, engagement_sent_at`.
   Its cascade has no discovery branch, and `discovery_call_at` lives on `matters`,
   which that trigger never reads. So a lead sits in `new_lead` — a 1-day
   attorney SLA — from creation until `intake_sent_at` is stamped.

3. **Latent: the lead stage clock has never started when it should.**
   `trg_matters_stage_entered_at` is `BEFORE INSERT OR UPDATE OF stage ON matters`
   and unconditionally assigns `NEW.stage_entered_at := NOW()`. `ensure_lead_matter()`
   computes a `v_stage_entered_at` by coalescing the intake timestamps and passes
   it in the same UPDATE — where it is silently overwritten every time the stage
   actually changes. That variable is dead code today.

### Design

#### A. New stage key `discovery_call`

Add one `stage_sla` row and renumber the lead rows so `stage_order` stays strictly
increasing:

| stage_key | entity | owner | sla_days | escalation_offset | stage_order |
|---|---|---|---|---|---|
| `new_lead` | lead | attorney | 1 | 1 | 1 |
| **`discovery_call`** | **lead** | **attorney** | **1** | **1** | **2** |
| `intake_sent` | lead | client | 5 | 4 | 3 *(was 2)* |
| `intake_completed` | lead | attorney | 2 | 1 | 4 *(was 3)* |
| `engagement_sent` | lead | client | 5 | 4 | 5 *(was 4)* |

`sla_days = 1` matches the v3 plan, where both "Send post-discovery email (PMPS
link + estate plan organizer)" and "Determine fit — proceed or decline" are due at
`discovery_call + 0`.

Renumbering is safe: `stage_order` is consumed only for sort ordering, in
`lib/queries/pipelineAging.ts:119` and the settings table, and both the aging views
and the settings query filter by `entity`. Lead orders (1–5) and matter orders
(2–10) already overlap harmlessly for the same reason.

No display-label change is needed. `PipelineSlaSettings` is fully data-driven and
renders unknown keys through `engineStageLabel`'s title-case fallback, which yields
"Discovery Call" — the same way `new_lead` already renders as "New Lead".

#### B. Trigger `stamp_lead_discovery_stage`

`BEFORE UPDATE OF discovery_call_at ON public.matters`, following the existing
`stamp_matter_status_dates` / `stamp_matter_relationship_dates` pattern.

- **Guard:** act only when `relationship_status = 'lead'` and the current stage is
  `new_lead` or `discovery_call`. This makes it forward-only — it can never drag a
  lead backwards out of `intake_sent` or later.
- **On a non-null value:** set `stage := 'discovery_call'` and
  `stage_entered_at := discovery_call_at`.
- **On null (attorney clears a mistaken date):** revert to `stage := 'new_lead'`
  and `stage_entered_at := created_at`, restoring the original speed-to-lead clock.

Pinning `stage_entered_at` to the call date rather than to `now()` is what makes a
future booking behave correctly. `business_days_elapsed(p_start)` generates
`generate_series(start, today - 1)`, which is empty when `start` is in the future
and returns `0`. So a call booked Monday for Thursday leaves the lead green through
Wednesday, starts counting Thursday, and goes red Friday if the post-discovery
email has not gone out.

This assignment survives because the sla-anchors UPDATE names `discovery_call_at`,
not `stage`, and `trg_matters_stage_entered_at` is `UPDATE OF stage` — which keys
off the statement's SET list, so it does not fire. Change D below removes the
reliance on that subtlety.

#### C. `ensure_lead_matter()` gains a discovery branch

Read the existing matter's `discovery_call_at` into a local before computing
`v_stage`, then slot discovery between `intake_sent` and `new_lead` in both the
stage cascade and the `stage_entered_at` coalesce:

```
when new.engagement_sent_at   is not null then 'engagement_sent'
when new.intake_completed_at  is not null then 'intake_completed'
when new.intake_sent_at       is not null then 'intake_sent'
when v_discovery_call_at      is not null then 'discovery_call'
else 'new_lead'
```

Without this, any change to `lead_status` — marking a lead lost and reopening it,
for instance — recomputes the cascade, finds no discovery branch, and knocks the
lead back to `new_lead`. On the INSERT path no matter exists yet, so
`v_discovery_call_at` is null and behaviour is unchanged.

#### D. Harden `trg_matters_stage_entered_at`

Stamp `now()` only when the caller did not supply `stage_entered_at` itself:

```sql
IF TG_OP = 'INSERT' THEN
  IF NEW.stage_entered_at IS NULL THEN NEW.stage_entered_at := NOW(); END IF;
ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
  IF NEW.stage_entered_at IS NOT DISTINCT FROM OLD.stage_entered_at THEN
    NEW.stage_entered_at := NOW();
  END IF;
END IF;
```

The `TG_OP` split matters: `OLD` is unassigned in a BEFORE INSERT trigger, so
referencing `OLD.stage_entered_at` there would raise.

This is what makes C and the backfill hold — both issue an UPDATE that names
`stage`, so without it the trigger overwrites the intended timestamp. It also
revives `ensure_lead_matter()`'s dead `v_stage_entered_at`, fixing defect 3.

Blast radius is nil for existing callers. Every TypeScript writer of
`stage_entered_at` already passes `now()`:
`app/api/intake/route.ts:345`, `app/api/intake/route.ts:772`, and
`lib/lawmatics/importMatter.ts:227`. Honouring their value instead of overwriting
it with a value computed microseconds later is behaviour-preserving, and for the
Lawmatics importer it makes importing a historical stage date possible.

#### E. Stamp the anchor when a discovery call is booked

In `recordBookingSideEffects` (`lib/appointments/book.ts`), add a branch for
`type.key === 'discovery_call'` that sets `matters.discovery_call_at = startIso`
when it is not already set, skipped when `action === 'Cancelled'` — consistent
with how `scheduled_signing_date` and `design_meeting_date` are already handled.

The matter must be resolved as `matters.client_intake_id = leadId`, **not** through
`findMatterIdByEmail`. That helper filters `relationship_status = 'hired'`
(`lib/bookings/link.ts:29`), so for a lead it returns null and the existing
`if (matterId)` block is skipped entirely. The new branch therefore hangs off
`leadId`, not `matterId`.

Not overwriting an existing value keeps a manually corrected date from being
clobbered by a later reschedule webhook. Rescheduling is out of scope; the
attorney can correct the date in the Key Dates panel, which already replays the
anchor through `applySlaAnchor`.

#### F. Backfill

```sql
update public.matters
set stage = 'discovery_call',
    stage_entered_at = discovery_call_at
where relationship_status = 'lead'
  and stage = 'new_lead'
  and discovery_call_at is not null;
```

Correct only once D has landed in the same migration, ahead of this statement.

### What this does not change

- **`SLA_PHASES` is untouched.** It is the task-checklist vocabulary, not the stage
  vocabulary. v3 keeps the discovery tasks in phase `new_lead`, already labelled
  "Discovery", so the SLA tab is unaffected.
- **`MatterStage` is untouched.** Lead stage keys have never been members of that
  union even though `matters.stage` stores them; `matters.stage` carries no CHECK
  constraint, so the new key needs no schema change.
- **The lead kanban gets no Discovery column.** `lib/leads/board.ts` derives its own
  columns from `client_intake` timestamps and never reads `discovery_call_at`, so
  it will not show discovery. Filed as a known gap, not fixed here.
- **The PMPS appointment automation is left alone.** `lib/appointments/automation.ts:119`
  still advances `intake`/`intake_review` → `design` on a PMPS booking, a
  post-engagement model that never matches a lead and is dead under v3. Filed
  separately.

### Testing

Follow the existing split in this repo: migration-source assertions in the style of
`tests/lead-matter-parity-aging.test.ts`, plus behavioural tests where there is
logic to exercise.

- Migration source contains the `discovery_call` `stage_sla` row, the renumbered
  lead orders, the `stamp_lead_discovery_stage` trigger, the discovery branch in
  `ensure_lead_matter()`, the hardened `trg_matters_stage_entered_at` with its
  `TG_OP` split, and the backfill.
- The trigger guard is forward-only: a lead in `intake_sent` that gains a
  `discovery_call_at` keeps its stage.
- Clearing `discovery_call_at` returns the lead to `new_lead`.
- `business_days_elapsed` returns `0` for a future `stage_entered_at`, so a lead
  booked ahead reports `health = 'green'`.
- `recordBookingSideEffects` resolves the lead's matter by `client_intake_id` and
  does not stamp on cancellation.

---

## Part 2 — `revision` belongs before `drafts_approved`

### Problem

The real sequence is: deliver drafts → client reviews → incorporate revisions →
client approves → schedule signing. Three TypeScript lists order approval *before*
revision, which reads as "approved, then revised."

The database is already correct. `stage_sla` places `revisions` at order 6 and
`approved` at order 7 (`supabase/migrations/20260903000001_split_design_engine_stage.sql`).
The v3 task offsets agree: client review lands day 22, Round 1 revision day 24,
and Round 2 day 29. Neither task system contradicts this — the v3 template seeds no
`drafts_approved` tasks, and `approved` is listed in `UNTASKED_ENGINE_KEYS`, so it
carries no stage task template either. Approval is a client acknowledgement with no
work attached, which is why it reads naturally as the step *after* revisions.

This is not cosmetic. `nextStage()` and `prevStage()` (`types/database.ts:710-720`)
walk `STAGES` by index, so today `nextStage('client_review')` returns
`drafts_approved` and skips revision entirely.

### Design

Swap the two entries in all three ordered lists so they match `stage_sla`:

1. `STAGES` — `types/database.ts:150`
2. `SLA_PHASES` — `lib/slaTasks/types.ts:14`
3. `STAGE_ORDER` — `app/admin/matters/[id]/MatterProgressTimeline.tsx:5`

`DRAFTING_QUEUE_STAGES` (`lib/queries/drafting.ts:20`) also contains both keys but
is a membership set, so its order is irrelevant and it is left alone.

No migration. No data change: `matters.stage` stores the key, never an index.

### Consequences to verify

- `nextStage('client_review')` becomes `revision`; `nextStage('revision')` becomes
  `drafts_approved`. Any UI offering a one-click advance now walks the real path.
- `MatterStageStrip` (`app/admin/matters/[id]/MatterStageStrip.tsx:35,64`) derives
  completed/current styling from `STAGES.findIndex`, so a matter in `revision`
  renders one step earlier than before. That is the intended correction.

### Separately noted, not fixed here

`MatterProgressTimeline`'s `STAGE_ORDER` omits `funding`. A matter in that stage
gets `indexOf === -1`, which `Math.max(0, ...)` floors to `0`, rendering it as if
it were back at `intake`. Distinct bug; worth its own fix.

### Testing

- `nextStage`/`prevStage` return the corrected neighbours across
  `client_review → revision → drafts_approved`.
- The three lists agree with each other and with the `stage_sla` engine order — the
  same shape as the existing test asserting `PIPELINE_TO_ENGINE` matches
  `map_matter_stage_to_engine()`.
