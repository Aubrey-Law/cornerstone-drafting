# Lead Discovery Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give leads a `discovery_call` pipeline stage so a held discovery call stops reporting a false SLA breach, and correct three stage lists that order draft approval before revisions.

**Architecture:** One migration adds the stage, a `BEFORE UPDATE OF discovery_call_at` trigger on `matters` that pins `stage_entered_at` to the call date, a discovery branch in `ensure_lead_matter()`, a hardened `trg_matters_stage_entered_at`, and a backfill. One TypeScript change stamps the anchor when a discovery call is booked. Part 2 swaps two entries in three ordered stage lists.

**Tech Stack:** PostgreSQL (Supabase), TypeScript, Next.js App Router, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-11-lead-discovery-stage-design.md`

---

## Before you start

**Migrations are not deployed automatically here.** Vercel ships code only. A merged migration reaches the database only when someone runs `supabase db push`. Task 7 covers this and is not optional.

**Do not trust `supabase_migrations.schema_migrations`.** This project has had phantom-applied rows. Verify objects exist by querying the catalog directly, as Task 7 does.

**Test style.** This repo has no local Postgres in the test run, so migration behaviour is asserted against the migration *source*. That is the established pattern (`tests/stage-engine-keys.test.ts`, `tests/lead-matter-parity-aging.test.ts`) and its honest ceiling: it proves the SQL says what we intend, not that Postgres does what we expect. Task 7 closes that gap by hand against the real database.

Run the whole suite with `npm test`. Run one file with `npx vitest run <path>`.

---

## File Structure

**Created:**
- `supabase/migrations/20260910000000_lead_discovery_stage.sql` — the whole Part 1 schema change: stage row, both triggers, the `ensure_lead_matter()` replacement, and the backfill. One file because these are a single atomic change; splitting them risks a half-applied stage.
- `tests/lead-discovery-stage.test.ts` — migration source assertions for Part 1.
- `tests/matter-stage-order.test.ts` — Part 2 ordering assertions.

**Modified:**
- `lib/appointments/book.ts` — stamp `discovery_call_at` on a discovery booking.
- `tests/appointment-booking.test.ts` — cover that stamp; extend the mock builder with `.is()`.
- `types/database.ts:150` — `STAGES` order.
- `lib/slaTasks/types.ts:14` — `SLA_PHASES` order.
- `app/admin/matters/[id]/MatterProgressTimeline.tsx:5` — `STAGE_ORDER`.
- `docs/SLA_Policy.md` — reflect the new stage and corrected order.

---

## Task 1: The `discovery_call` stage row

**Files:**
- Create: `supabase/migrations/20260910000000_lead_discovery_stage.sql`
- Create: `tests/lead-discovery-stage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lead-discovery-stage.test.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION = path.join(
  process.cwd(),
  'supabase/migrations/20260910000000_lead_discovery_stage.sql',
)

const sql = () => fs.readFileSync(MIGRATION, 'utf8')

/**
 * Parse the lead rows this migration seeds or renumbers, so the assertions read
 * as a table rather than a pile of substring checks.
 */
function leadStageOrders(source: string): Record<string, number> {
  const orders: Record<string, number> = {}
  const seeded = source.match(
    /values\s*\(\s*'discovery_call',\s*'DEFAULT',\s*'lead',\s*'attorney',\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/,
  )
  if (seeded) orders.discovery_call = Number(seeded[3])
  for (const m of source.matchAll(
    /update public\.stage_sla set stage_order = (\d+)\s+where stage_key = '([a-z_]+)'/g,
  )) {
    orders[m[2]] = Number(m[1])
  }
  return orders
}

describe('discovery_call lead stage', () => {
  it('seeds discovery_call as an attorney stage at 1 day', () => {
    const source = sql()
    expect(source).toMatch(
      /'discovery_call',\s*'DEFAULT',\s*'lead',\s*'attorney',\s*1,\s*1,\s*2/,
    )
  })

  it('orders the lead stages new_lead → discovery_call → intake → engagement', () => {
    const orders = leadStageOrders(sql())
    expect(orders).toMatchObject({
      discovery_call: 2,
      intake_sent: 3,
      intake_completed: 4,
      engagement_sent: 5,
    })
  })

  it('does not overwrite sla_days on the stages an admin may have tuned', () => {
    const source = sql()
    // The renumber must touch stage_order only. Re-seeding intake_sent with a
    // literal sla_days would silently revert a value edited in Settings.
    for (const key of ['intake_sent', 'intake_completed', 'engagement_sent']) {
      const renumber = new RegExp(
        `update public\\.stage_sla set stage_order = \\d+\\s+where stage_key = '${key}'`,
      )
      expect(source).toMatch(renumber)
    }
    expect(source).not.toMatch(/'intake_sent',\s*'DEFAULT',\s*'lead',\s*'client',\s*\d+/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lead-discovery-stage.test.ts`
Expected: FAIL — `ENOENT: no such file or directory` for the migration.

- [ ] **Step 3: Create the migration with the stage row**

Create `supabase/migrations/20260910000000_lead_discovery_stage.sql`:

```sql
-- Cornerstone — a `discovery_call` lead stage.
--
-- A lead that had held its discovery call sat in `new_lead` — a 1-day attorney
-- SLA — until the organizer went out, so the aging board reported a breach for
-- work nobody was late on. Discovery existed only as an anchor column and three
-- tasks inside the `new_lead` phase; it had no stage of its own, and nothing
-- recomputed `matters.stage` when the anchor was set.
--
-- The clock is pinned to the call date rather than to the moment the booking is
-- recorded. `business_days_elapsed` generates an empty series for a future
-- start and returns 0, so a lead booked ahead reads green until the day of the
-- call and only then starts counting toward the post-discovery email.

-- ── The stage ───────────────────────────────────────────────────────────────

-- sla_days 1 matches the v3 plan: "Send post-discovery email (PMPS link +
-- estate plan organizer)" and "Determine fit" are both due at discovery_call+0.
insert into public.stage_sla
  (stage_key, track, entity, owner, sla_days, escalation_offset, stage_order)
values
  ('discovery_call', 'DEFAULT', 'lead', 'attorney', 1, 1, 2)
on conflict (stage_key, track) do update set
  entity      = excluded.entity,
  owner       = excluded.owner,
  stage_order = excluded.stage_order;

-- Renumber the stages discovery now sits ahead of. Only stage_order moves:
-- sla_days and escalation_offset are editable in Settings, and re-seeding them
-- with literals would silently revert whatever the firm had tuned them to.
update public.stage_sla set stage_order = 3
  where stage_key = 'intake_sent' and track = 'DEFAULT' and entity = 'lead';
update public.stage_sla set stage_order = 4
  where stage_key = 'intake_completed' and track = 'DEFAULT' and entity = 'lead';
update public.stage_sla set stage_order = 5
  where stage_key = 'engagement_sent' and track = 'DEFAULT' and entity = 'lead';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lead-discovery-stage.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910000000_lead_discovery_stage.sql tests/lead-discovery-stage.test.ts
git commit -m "Add a discovery_call lead stage to stage_sla"
```

---

## Task 2: Stop `trg_matters_stage_entered_at` clobbering a supplied timestamp

`trg_matters_stage_entered_at` unconditionally assigns `NEW.stage_entered_at := NOW()` on any stage change. That makes `ensure_lead_matter()`'s computed `v_stage_entered_at` dead code today, and would defeat both the backfill and the discovery pin.

**Files:**
- Modify: `supabase/migrations/20260910000000_lead_discovery_stage.sql`
- Modify: `tests/lead-discovery-stage.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe` block in `tests/lead-discovery-stage.test.ts`:

```ts
  it('stamps stage_entered_at only when the caller did not supply one', () => {
    const source = sql()
    expect(source).toContain('create or replace function public.trg_matters_stage_entered_at()')
    // The INSERT arm must not reference OLD: it is unassigned in a BEFORE
    // INSERT trigger and referencing it raises.
    expect(source).toMatch(/if tg_op = 'INSERT' then\s+if new\.stage_entered_at is null then/)
    expect(source).toMatch(
      /elsif new\.stage is distinct from old\.stage then[\s\S]*?if new\.stage_entered_at is not distinct from old\.stage_entered_at then/,
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lead-discovery-stage.test.ts`
Expected: FAIL — `expected '…' to contain 'create or replace function public.trg_matters_stage_entered_at()'`.

- [ ] **Step 3: Append the hardened function to the migration**

Append to `supabase/migrations/20260910000000_lead_discovery_stage.sql`:

```sql
-- ── stage_entered_at stops overwriting a deliberate value ───────────────────
--
-- This trigger assigned NOW() on every stage change, which meant no caller
-- could ever set the stage entry date itself. Two consequences: the date
-- `ensure_lead_matter()` computes by coalescing the intake timestamps has never
-- survived the UPDATE that carries it, and the discovery clock below could not
-- be pinned to the call date. Stamp NOW() only when the caller stayed silent.
--
-- Existing callers are unaffected: app/api/intake/route.ts and
-- lib/lawmatics/importMatter.ts already pass now(), so honouring their value
-- instead of replacing it microseconds later changes nothing.
create or replace function public.trg_matters_stage_entered_at()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.stage_entered_at is null then
      new.stage_entered_at := now();
    end if;
  elsif new.stage is distinct from old.stage then
    if new.stage_entered_at is not distinct from old.stage_entered_at then
      new.stage_entered_at := now();
    end if;
  end if;
  return new;
end;
$$;
```

The existing `trg_matters_stage_entered_at` trigger on `public.matters` already
points at this function, so it does not need recreating.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lead-discovery-stage.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910000000_lead_discovery_stage.sql tests/lead-discovery-stage.test.ts
git commit -m "Honour a caller-supplied stage_entered_at instead of overwriting it"
```

---

## Task 3: The `stamp_lead_discovery_stage` trigger

**Files:**
- Modify: `supabase/migrations/20260910000000_lead_discovery_stage.sql`
- Modify: `tests/lead-discovery-stage.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe` block:

```ts
  it('advances a lead to discovery_call and pins the clock to the call date', () => {
    const source = sql()
    expect(source).toContain('create or replace function public.stamp_lead_discovery_stage()')
    expect(source).toContain("new.stage := 'discovery_call'")
    expect(source).toContain('new.stage_entered_at := new.discovery_call_at')
  })

  it('guards the trigger to leads that have not moved past discovery', () => {
    const source = sql()
    expect(source).toContain("if new.relationship_status <> 'lead' then")
    expect(source).toContain("not in ('new_lead', 'discovery_call')")
  })

  it('reverts to new_lead when the date is cleared', () => {
    const source = sql()
    expect(source).toMatch(/else\s+new\.stage := 'new_lead';\s+new\.stage_entered_at := coalesce\(new\.created_at, now\(\)\)/)
  })

  it('fires on discovery_call_at only, so the stage stamper stays out of it', () => {
    const source = sql()
    expect(source).toContain('before update of discovery_call_at on public.matters')
    expect(source).toContain(
      'revoke execute on function public.stamp_lead_discovery_stage() from public, anon, authenticated',
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lead-discovery-stage.test.ts`
Expected: FAIL — 4 new failures, first on `stamp_lead_discovery_stage()` not found.

- [ ] **Step 3: Append the trigger to the migration**

Append to `supabase/migrations/20260910000000_lead_discovery_stage.sql`:

```sql
-- ── Setting the anchor moves the stage ──────────────────────────────────────
--
-- Fires on discovery_call_at rather than on stage, which is what keeps the two
-- triggers out of each other's way: `trg_matters_stage_entered_at` is
-- BEFORE UPDATE OF stage, and that fires off the statement's SET list, which
-- names only the anchor columns here. Should a future caller update both at
-- once, both triggers run in name order — this one first — and the hardened
-- guard above then sees a deliberate stage_entered_at and leaves it alone.
create or replace function public.stamp_lead_discovery_stage()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.discovery_call_at is not distinct from old.discovery_call_at then
    return new;
  end if;

  if new.relationship_status <> 'lead' then
    return new;
  end if;

  -- Forward-only. A lead that already sent the organizer is past discovery, and
  -- recording the call date late must not drag it backwards.
  if new.stage is null or new.stage not in ('new_lead', 'discovery_call') then
    return new;
  end if;

  if new.discovery_call_at is not null then
    new.stage := 'discovery_call';
    -- The call date, not now(): business_days_elapsed returns 0 for a future
    -- start, so a lead booked ahead stays green until the day it happens.
    new.stage_entered_at := new.discovery_call_at;
  else
    new.stage := 'new_lead';
    new.stage_entered_at := coalesce(new.created_at, now());
  end if;

  return new;
end;
$$;

revoke execute on function public.stamp_lead_discovery_stage() from public, anon, authenticated;

drop trigger if exists stamp_lead_discovery_stage on public.matters;
create trigger stamp_lead_discovery_stage
before update of discovery_call_at on public.matters
for each row execute function public.stamp_lead_discovery_stage();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lead-discovery-stage.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910000000_lead_discovery_stage.sql tests/lead-discovery-stage.test.ts
git commit -m "Move a lead to discovery_call when the call date is recorded"
```

---

## Task 4: Teach `ensure_lead_matter()` about discovery

Without this, any update to `lead_status` — marking a lead lost and reopening it — recomputes the cascade, finds no discovery branch, and knocks the lead back to `new_lead`.

**Files:**
- Modify: `supabase/migrations/20260910000000_lead_discovery_stage.sql`
- Modify: `tests/lead-discovery-stage.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe` block:

```ts
  it('slots discovery between intake_sent and new_lead in the cascade', () => {
    const source = sql()
    expect(source).toContain('create or replace function public.ensure_lead_matter()')
    expect(source).toMatch(
      /when new\.intake_sent_at is not null then 'intake_sent'\s+when v_discovery_call_at is not null then 'discovery_call'\s+else 'new_lead'/,
    )
  })

  it('reads discovery_call_at off the matter, since the trigger is on client_intake', () => {
    const source = sql()
    expect(source).toContain('v_discovery_call_at timestamptz')
    expect(source).toContain('select m.id, m.discovery_call_at')
    expect(source).toMatch(
      /v_stage_entered_at := coalesce\([^)]*v_discovery_call_at, new\.created_at, now\(\)\)/,
    )
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lead-discovery-stage.test.ts`
Expected: FAIL — 2 new failures, first on `ensure_lead_matter()` not found.

- [ ] **Step 3: Append the replacement function**

Append to `supabase/migrations/20260910000000_lead_discovery_stage.sql`. This is the
20260824000000 body with three changes: a new `v_discovery_call_at` local, the
matter lookup now selecting it, and the two cascades extended.

```sql
-- ── The intake cascade learns the discovery stage ───────────────────────────
--
-- This trigger recomputes the stage from the intake timestamps whenever
-- lead_status or one of those timestamps changes. Without a discovery branch,
-- reopening a lost lead would recompute straight past discovery back to
-- new_lead, undoing the trigger above. discovery_call_at lives on matters, so
-- it is read from the row the lookup already finds.
create or replace function public.ensure_lead_matter()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_matter_id uuid;
  v_discovery_call_at timestamptz;
  v_relationship_status text;
  v_stage text;
  v_stage_entered_at timestamptz;
begin
  if new.lead_status is null then
    return new;
  end if;

  select m.id, m.discovery_call_at into v_matter_id, v_discovery_call_at
  from public.matters m
  where m.client_intake_id = new.id
  order by (m.id = new.matter_id) desc, m.created_at desc
  limit 1;

  v_relationship_status := case
    when new.lead_status = 'lost' then 'lost'
    when new.lead_status = 'declined' then 'declined'
    else 'lead'
  end;
  v_stage := case
    when new.engagement_sent_at is not null then 'engagement_sent'
    when new.intake_completed_at is not null then 'intake_completed'
    when new.intake_sent_at is not null then 'intake_sent'
    when v_discovery_call_at is not null then 'discovery_call'
    else 'new_lead'
  end;
  v_stage_entered_at := coalesce(new.engagement_sent_at, new.intake_completed_at, new.intake_sent_at, v_discovery_call_at, new.created_at, now());

  if v_matter_id is null then
    insert into public.matters (
      client_intake_id, client_id, name, matter_number, stage, status,
      stage_entered_at, track, relationship_status, lost_at, declined_at
    ) values (
      new.id, null,
      coalesce(nullif(trim(new.full_name), ''), nullif(trim(concat_ws(' ', new.first_name, new.last_name)), ''), new.email, 'Prospective client'),
      null, v_stage, 'active', v_stage_entered_at, 'DEFAULT',
      v_relationship_status,
      case when v_relationship_status = 'lost' then now() else null end,
      case when v_relationship_status = 'declined' then now() else null end
    ) returning id into v_matter_id;

    insert into public.matter_details (
      client_id, practice_area, plan_type, jurisdiction_state, jurisdiction_county,
      flat_fee_amount, est_estate_value, referral_source, urgency, matter_status_notes
    ) values (
      v_matter_id, new.practice_area, 'TBD', coalesce(nullif(new.state, ''), 'MA'),
      nullif(new.county, ''), new.engagement_fee_quoted, new.taxable_estate,
      nullif(new.lead_source, ''), new.lead_urgency, nullif(new.qualification_notes, '')
    ) on conflict (client_id) do nothing;

    update public.client_intake set matter_id = v_matter_id where id = new.id;
  elsif new.lead_status in ('lead', 'lost', 'declined') then
    update public.matters
    set relationship_status = v_relationship_status,
        stage = case when relationship_status = 'hired' then stage else v_stage end,
        stage_entered_at = case when relationship_status = 'hired' then stage_entered_at else v_stage_entered_at end,
        updated_at = now()
    where id = v_matter_id and relationship_status <> 'hired';

    if new.matter_id is distinct from v_matter_id then
      update public.client_intake set matter_id = v_matter_id where id = new.id;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.ensure_lead_matter() from public, anon, authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lead-discovery-stage.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910000000_lead_discovery_stage.sql tests/lead-discovery-stage.test.ts
git commit -m "Keep the discovery stage through a lead_status change"
```

---

## Task 5: Backfill leads already holding a call date

**Files:**
- Modify: `supabase/migrations/20260910000000_lead_discovery_stage.sql`
- Modify: `tests/lead-discovery-stage.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe` block:

```ts
  it('backfills leads stuck in new_lead with a call date already recorded', () => {
    const source = sql()
    expect(source).toMatch(
      /update public\.matters\s+set stage = 'discovery_call',\s+stage_entered_at = discovery_call_at\s+where relationship_status = 'lead'\s+and stage = 'new_lead'\s+and discovery_call_at is not null/,
    )
  })

  it('backfills after the stage stamper is hardened, or the pin is lost', () => {
    const source = sql()
    const hardened = source.indexOf('create or replace function public.trg_matters_stage_entered_at()')
    const backfill = source.indexOf("set stage = 'discovery_call',")
    expect(hardened).toBeGreaterThan(-1)
    expect(backfill).toBeGreaterThan(hardened)
  })

  it('reloads the API schema cache', () => {
    expect(sql()).toContain("notify pgrst, 'reload schema'")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lead-discovery-stage.test.ts`
Expected: FAIL — 3 new failures on the backfill and the notify.

- [ ] **Step 3: Append the backfill**

Append to `supabase/migrations/20260910000000_lead_discovery_stage.sql`:

```sql
-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Leads whose discovery call was recorded by hand before this shipped are
-- sitting in new_lead against an expired 1-day clock. This UPDATE names `stage`,
-- so it relies on the hardened stamper above to keep the pinned date.
update public.matters
set stage = 'discovery_call',
    stage_entered_at = discovery_call_at
where relationship_status = 'lead'
  and stage = 'new_lead'
  and discovery_call_at is not null;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lead-discovery-stage.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Run the full suite for regressions**

Run: `npm test`
Expected: PASS. If `tests/rls-security-policies.test.ts` or a migration-inventory test enumerates migration files, it may need the new filename added — read the failure and update that list.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260910000000_lead_discovery_stage.sql tests/lead-discovery-stage.test.ts
git commit -m "Backfill leads already holding a discovery call date"
```

---

## Task 6: Stamp `discovery_call_at` when a discovery call is booked

Booking a discovery call records nothing today, so the anchor only ever arrives by hand and the v3 discovery tasks stay unscheduled.

**Files:**
- Modify: `lib/appointments/book.ts:133-145`
- Modify: `tests/appointment-booking.test.ts`

- [ ] **Step 1: Extend the test mock with `.is()`**

The mock's `update()` chain in `tests/appointment-booking.test.ts` exposes only `eq`. Add `is` beside it so the new query can be exercised. Change:

```ts
      update: vi.fn((values: Record<string, unknown>) => {
        state.updates.push({ table, values })
        const chain = {
          eq: vi.fn(() => chain),
          then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
        }
        return chain
      }),
```

to:

```ts
      update: vi.fn((values: Record<string, unknown>) => {
        state.updates.push({ table, values })
        const chain = {
          eq: vi.fn(() => chain),
          is: vi.fn(() => chain),
          then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
        }
        return chain
      }),
```

- [ ] **Step 2: Write the failing tests**

The file's existing `TYPE` fixture is already `key: 'discovery_call'`, and
`bookingInput()` already returns a discovery booking, so no new fixture is needed
for the happy path. Add these two inside the existing `describe('bookAppointment')`
block:

```ts
  it('stamps the discovery call anchor on the lead’s matter', async () => {
    // findMatterIdByEmail is hired-only, so state.matterId stays null: the stamp
    // has to find the matter through the lead, not through that helper.
    state.lead = { id: 'lead-9', lead_status: 'lead' }

    await bookAppointment(bookingInput())

    const stamped = state.updates.find(
      u => u.table === 'matters' && 'discovery_call_at' in u.values,
    )
    expect(stamped).toBeDefined()
    expect(stamped?.values.discovery_call_at).toBe(SLOT_ISO)
  })

  it('does not stamp the anchor for a non-discovery appointment type', async () => {
    state.lead = { id: 'lead-9', lead_status: 'lead' }

    await bookAppointment({
      ...bookingInput(),
      type: { ...TYPE, key: 'signing_appointment', slug: 'signing', label: 'Signing' },
    })

    expect(
      state.updates.find(u => u.table === 'matters' && 'discovery_call_at' in u.values),
    ).toBeUndefined()
  })
```

Add this third one inside the existing `describe('cancelAppointment')` block,
which already defines the `ROW` appointment fixture it uses:

```ts
  it('does not stamp the discovery anchor on cancellation', async () => {
    state.lead = { id: 'lead-9', lead_status: 'lead' }

    await cancelAppointment({ appointment: ROW, type: TYPE })

    expect(
      state.updates.find(u => u.table === 'matters' && 'discovery_call_at' in u.values),
    ).toBeUndefined()
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/appointment-booking.test.ts`
Expected: FAIL on the first new test — `expected undefined to be defined`.

- [ ] **Step 4: Add the stamp**

In `lib/appointments/book.ts`, inside `recordActivity`, immediately after the
closing brace of the existing `if (leadId) { … }` block (currently ending at
line 145) and before `if (matterId) {`:

```ts
  // The discovery call is the pre-engagement clock's first anchor, and nothing
  // else records it. It hangs off leadId, not matterId: findMatterIdByEmail
  // filters to relationship_status = 'hired', so a lead resolves to no matter
  // and the block below never runs for one.
  if (leadId && action !== 'Cancelled' && startIso && type.key === 'discovery_call') {
    try {
      await admin
        .from('matters')
        .update({ discovery_call_at: new Date(startIso).toISOString() })
        .eq('client_intake_id', leadId)
        // Never overwrite a date an attorney corrected by hand.
        .is('discovery_call_at', null)
    } catch (err) {
      console.error('[appointments] discovery anchor failed', err)
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/appointment-booking.test.ts`
Expected: PASS, including the three new tests.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/appointments/book.ts tests/appointment-booking.test.ts
git commit -m "Record the discovery call anchor when the call is booked"
```

---

## Task 7: Apply the migration and verify against the real database

Nothing deploys migrations here automatically. Until this runs, the code is live and the stage does not exist.

**Files:** none.

- [ ] **Step 1: Check for drift before pushing**

Run: `npm run check:migration-drift`
Expected: the new migration is reported pending; no orphaned or out-of-order entries. Stop and resolve anything else it reports before continuing.

- [ ] **Step 2: Push**

```bash
supabase db push
```

- [ ] **Step 3: Verify the objects exist — do not trust the history table**

This project has had phantom rows in `supabase_migrations.schema_migrations`. Check the catalog directly:

```sql
select stage_key, owner, sla_days, escalation_offset, stage_order
from public.stage_sla
where entity = 'lead' and track = 'DEFAULT'
order by stage_order;

select tgname from pg_trigger
where tgrelid = 'public.matters'::regclass and not tgisinternal
order by tgname;
```

Expected: five lead rows ordered `new_lead(1), discovery_call(2), intake_sent(3), intake_completed(4), engagement_sent(5)`, and `stamp_lead_discovery_stage` present among the triggers.

- [ ] **Step 4: Verify the behaviour end to end**

On a real lead in `new_lead`, set a discovery call date a few business days in the future via the matter's Key Dates panel, then:

```sql
select stage, stage_entered_at, discovery_call_at from public.matters where id = '<matter-id>';
select current_stage, days_in_stage, sla_days, health from public.v_pipeline_aging where id = '<lead-id>';
```

Expected: `stage = 'discovery_call'`, `stage_entered_at = discovery_call_at`, and the aging row reporting `days_in_stage = 0` with `health = 'green'`. Clear the date and confirm it returns to `new_lead`.

- [ ] **Step 5: Confirm nothing regressed on the board**

Load `/admin/pipeline/aging` and confirm leads that had been red for discovery are now green or amber, and that no lead past `intake_sent` moved.

---

## Task 8: `revision` before `drafts_approved`

The database already orders `revisions` (6) ahead of `approved` (7). Three TypeScript lists disagree, and it is not cosmetic: `nextStage()` walks `STAGES` by index, so `nextStage('client_review')` currently returns `drafts_approved` and skips revision entirely.

**Files:**
- Modify: `types/database.ts:150-163`
- Modify: `lib/slaTasks/types.ts:14-37`
- Modify: `app/admin/matters/[id]/MatterProgressTimeline.tsx:5-17`
- Create: `tests/matter-stage-order.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/matter-stage-order.test.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { STAGES, nextStage, prevStage } from '@/types/database'
import { SLA_PHASES } from '@/lib/slaTasks/types'

const order = (key: string) => STAGES.findIndex(s => s.key === key)

describe('matter stage order', () => {
  it('puts revision before drafts_approved', () => {
    expect(order('client_review')).toBeLessThan(order('revision'))
    expect(order('revision')).toBeLessThan(order('drafts_approved'))
  })

  it('walks client_review → revision → drafts_approved', () => {
    expect(nextStage('client_review')).toBe('revision')
    expect(nextStage('revision')).toBe('drafts_approved')
    expect(prevStage('drafts_approved')).toBe('revision')
  })

  it('orders the SLA phases the same way', () => {
    const phases = [...SLA_PHASES] as string[]
    expect(phases.indexOf('revision')).toBeLessThan(phases.indexOf('drafts_approved'))
  })

  it('orders the progress timeline the same way', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/matters/[id]/MatterProgressTimeline.tsx'),
      'utf8',
    )
    const list = source.slice(source.indexOf('const STAGE_ORDER'), source.indexOf(']', source.indexOf('const STAGE_ORDER')))
    expect(list.indexOf("'revision'")).toBeLessThan(list.indexOf("'drafts_approved'"))
  })

  it('agrees with the stage_sla engine order in the database', () => {
    // revisions is order 6 and approved is order 7 in
    // supabase/migrations/20260903000001_split_design_engine_stage.sql.
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260903000001_split_design_engine_stage.sql'),
      'utf8',
    )
    const revisions = migration.match(/'revisions',\s*'DEFAULT',\s*'matter',\s*'attorney',\s*\d+,\s*\d+,\s*(\d+)/)
    const approved = migration.match(/'approved',\s*'DEFAULT',\s*'matter',\s*'client',\s*\d+,\s*\d+,\s*(\d+)/)
    expect(Number(revisions?.[1])).toBeLessThan(Number(approved?.[1]))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/matter-stage-order.test.ts`
Expected: FAIL on the first four tests; the fifth passes (the DB is already correct).

- [ ] **Step 3: Swap the entries in `types/database.ts`**

In `types/database.ts`, in the `STAGES` array, swap the `drafts_approved` and
`revision` entries so the block reads:

```ts
  { key: 'client_review', label: 'Client Review', group: 'work' },
  { key: 'revision', label: 'Revision', group: 'work' },
  { key: 'drafts_approved', label: 'Drafts Approved', group: 'work' },
  { key: 'signing_scheduled', label: 'Signing Scheduled', group: 'done' },
```

- [ ] **Step 4: Swap the entries in `lib/slaTasks/types.ts`**

In the `SLA_PHASES` array, swap the same two so the block reads:

```ts
  'client_review',
  'revision',
  'drafts_approved',
  'signing_scheduled',
```

- [ ] **Step 5: Swap the entries in `MatterProgressTimeline.tsx`**

In `STAGE_ORDER`, swap the same two so the block reads:

```ts
  'client_review',
  'revision',
  'drafts_approved',
  'signing_scheduled',
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/matter-stage-order.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS. `tests/stage-engine-keys.test.ts` compares sets, not order, so it is unaffected — but if any test asserts a literal stage sequence, read the failure and update the expectation to the corrected order.

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add types/database.ts lib/slaTasks/types.ts "app/admin/matters/[id]/MatterProgressTimeline.tsx" tests/matter-stage-order.test.ts
git commit -m "Order revision before drafts_approved to match the database"
```

---

## Task 9: Update the SLA policy doc

`docs/SLA_Policy.md` is untracked and predates this work. Bring it in line and commit it, or it goes stale before it is ever read.

**Files:**
- Modify: `docs/SLA_Policy.md`

- [ ] **Step 1: Update the lead stage table**

Replace the four-row lead table with five rows: `New Lead` (attorney, 1), **`Discovery Call` (attorney, 1)**, `Intake Sent` (client, 5), `Intake Completed` (attorney, 2), `Engagement Sent` (client, 5). Add a sentence noting the discovery clock is pinned to the call date, so a lead booked ahead reads green until the call day.

- [ ] **Step 2: Add the matter stage table**

The doc currently has no matter stage table. Add one from `stage_sla`, in engine order: `design_input` (client, 5), `design` (attorney, 5), `drafting` (attorney, 5), `client_review` (client, 5), `revisions` (attorney, 3), `approved` (client, 5), `signing_scheduled` (none), `closeout` (attorney, 3), `funding` (none). Note that `signing_complete` maps to the `signing_scheduled` engine key and so carries no clock of its own.

- [ ] **Step 3: Correct the anchor description**

Record that `discovery_call_at` is now stamped when a discovery call is booked, not only by hand, and that `pmps_at` is still manual — the PMPS booking automation remains on the pre-v3 model and is tracked separately.

- [ ] **Step 4: Commit**

```bash
git add docs/SLA_Policy.md
git commit -m "Document the discovery stage and the matter stage SLAs"
```

---

## Out of scope

Filed or noted during design; do not attempt here.

- **PMPS appointment automation.** `lib/appointments/automation.ts:119` advances `intake`/`intake_review` → `design` on a PMPS booking, a post-engagement model that never matches a lead and is dead under v3. It also writes `matter_details.design_meeting_date` instead of stamping `matters.pmps_at`. Tracked separately.
- **`MatterProgressTimeline`'s `STAGE_ORDER` omits `funding`.** A matter in that stage gets `indexOf === -1`, floored to `0` by `Math.max`, and renders as though it were back at intake. Distinct bug.
- **The lead kanban gets no Discovery column.** `lib/leads/board.ts` derives its columns from `client_intake` timestamps and never reads `discovery_call_at`, so it will disagree with the aging board.
- **Rescheduling a discovery call does not move the anchor.** The stamp is write-once by design; an attorney corrects the date in the Key Dates panel, which replays it through `applySlaAnchor`.
