# Google Calendar Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the firm choose which Google calendars appear on the admin calendar, and separately which ones block client booking.

**Architecture:** Two `text[]` override columns on `scheduling_settings` record only the deviations from default (visible on, blocking off). A new pure-logic module `lib/appointments/calendarSelection.ts` holds every decision, so the rules are unit-testable without touching Google or Supabase. `listCalendarView` and `fetchCalendarBusy` read the setting themselves rather than taking it as a parameter — they have five and six production callers respectively, and no call site should be able to forget.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Postgres, Vitest, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-16-google-calendar-selection-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/20261208000000_calendar_selection.sql` — the two columns
- `lib/appointments/calendarSelection.ts` — pure selection logic, no I/O
- `tests/calendar-selection.test.ts` — unit tests for the above
- `app/api/admin/scheduling/calendars/route.ts` — lists account calendars for the settings UI
- `app/admin/calendar/CalendarVisibilityPopover.tsx` — the checkbox popover
- `app/admin/settings/BlockingCalendarsEditor.tsx` — the blocking list

**Modify:**
- `packages/db-types/src/supabase.generated.ts` — regenerated
- `lib/appointments/types.ts` — `SchedulingSettings` gains two fields
- `lib/appointments/settings.ts` — read, write, and sanitize them
- `lib/appointments/googleEvents.ts` — `listCalendarView` skips hidden calendars
- `lib/appointments/calendarBusy.ts` — `freeBusy` queries blocking calendars, fatal on error
- `app/api/admin/scheduling/settings/route.ts` — accept the two arrays
- `app/admin/calendar/CalendarClient.tsx` — mount the popover
- `app/admin/settings/SchedulingSettingsSection.tsx` — mount the editor
- `tests/calendar-fanout.test.ts` — hidden-calendar cases
- `tests/calendar-busy.test.ts` — blocking-calendar cases

`CalendarClient.tsx` is already 1401 lines, so the popover is its own file rather than inline. `SchedulingSettingsSection.tsx` is 552 lines; the blocking editor is likewise its own file.

---

## Task 1: Migration and generated types

**Files:**
- Create: `supabase/migrations/20261208000000_calendar_selection.sql`
- Modify: `packages/db-types/src/supabase.generated.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261208000000_calendar_selection.sql`:

```sql
-- Which Google calendars the firm sees, and which protect its time.
--
-- Two different questions about the same list. Before this, the app answered
-- both by itself: the admin grid displayed every calendar it could read, while
-- freeBusy consulted `primary` alone. An event on a secondary calendar was
-- therefore visible to the attorney and invisible to the booking flow, so a
-- client could book straight over it.
--
-- Only the deviations from the default are stored. Google's calendarList stays
-- the source of truth for which calendars exist, so a newly-subscribed calendar
-- is absent from both arrays and lands on its defaults (visible, non-blocking)
-- with no reconciliation step. An id left behind by a calendar deleted in
-- Google matches nothing on the display side and is surfaced as a removable
-- stale row on the booking side.
--
-- Both default to empty: no behavior changes on deploy.
alter table public.scheduling_settings
  add column if not exists hidden_calendar_ids   text[] not null default '{}',
  add column if not exists blocking_calendar_ids text[] not null default '{}';

comment on column public.scheduling_settings.hidden_calendar_ids is
  'Google calendar ids excluded from the admin calendar. The primary calendar is never hidden.';
comment on column public.scheduling_settings.blocking_calendar_ids is
  'Google calendar ids consulted by freeBusy in addition to primary. An error from any of these fails booking availability closed.';
```

- [ ] **Step 2: Apply the migration**

Per `docs/` and the project's migration notes, apply through the pooler URL — `--db-url` drops a header the drift test requires.

Run: `npm run supabase:db:push`

- [ ] **Step 3: Verify the columns exist in the database itself**

Migration history is not trustworthy evidence here; ask the database.

Run: `npm run check:db-columns`
Expected: exit 0.

Then confirm directly — the columns must appear in the live schema, not just in the migration file:

```bash
npm run check:migration-drift
```

Expected: exit 0, no drift reported.

- [ ] **Step 4: Regenerate the database types**

Run: `npm run db:types:linked`

Expected: `packages/db-types/src/supabase.generated.ts` now lists `blocking_calendar_ids` and `hidden_calendar_ids` in `scheduling_settings`'s `Row`, `Insert`, and `Update`.

Verify:

```bash
grep -n "hidden_calendar_ids" packages/db-types/src/supabase.generated.ts
```

Expected: three matches (Row, Insert, Update).

- [ ] **Step 5: Confirm the types match the database**

Run: `npm run check:db-types`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261208000000_calendar_selection.sql packages/db-types/src/supabase.generated.ts
git commit -m "feat: record which calendars display and which block booking"
```

---

## Task 2: Pure selection logic

Every rule in the spec lives here, with no Google and no Supabase, so the rules can be tested directly.

**Files:**
- Create: `lib/appointments/calendarSelection.ts`
- Test: `tests/calendar-selection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/calendar-selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  busyCalendarIds,
  sanitizeCalendarIds,
  staleBlockingIds,
  visibleCalendars,
} from '@/lib/appointments/calendarSelection'
import type { CalendarRef } from '@/lib/appointments/calendarTypes'

const PRIMARY: CalendarRef = { id: 'firm@example.com', name: 'Aubrey Law', isDefault: true }
const PERSONAL: CalendarRef = { id: 'personal@example.com', name: 'Personal', isDefault: false }
const HOLIDAYS: CalendarRef = { id: 'holidays@group.v.calendar.google.com', name: 'US Holidays', isDefault: false }
const ALL = [PRIMARY, PERSONAL, HOLIDAYS]

describe('visibleCalendars', () => {
  it('treats a calendar in neither array as visible', () => {
    expect(visibleCalendars(ALL, [])).toEqual(ALL)
  })

  it('drops a hidden secondary calendar', () => {
    expect(visibleCalendars(ALL, [HOLIDAYS.id])).toEqual([PRIMARY, PERSONAL])
  })

  // The primary calendar is what "connected" means: listCalendarView reads it
  // first and treats a failure there as fatal. Hiding it would break the view,
  // so the rule is enforced here rather than trusted to the UI.
  it('keeps the primary calendar even when its id is in the hidden list', () => {
    expect(visibleCalendars(ALL, [PRIMARY.id, HOLIDAYS.id])).toEqual([PRIMARY, PERSONAL])
  })

  it('ignores hidden ids that match no calendar', () => {
    expect(visibleCalendars(ALL, ['deleted@example.com'])).toEqual(ALL)
  })
})

describe('busyCalendarIds', () => {
  it('always includes primary', () => {
    expect(busyCalendarIds([])).toEqual(['primary'])
  })

  it('adds each blocking calendar after primary', () => {
    expect(busyCalendarIds([PERSONAL.id])).toEqual(['primary', PERSONAL.id])
  })

  it('collapses duplicates', () => {
    expect(busyCalendarIds([PERSONAL.id, PERSONAL.id, 'primary'])).toEqual(['primary', PERSONAL.id])
  })
})

describe('staleBlockingIds', () => {
  it('reports a blocking id that matches no live calendar', () => {
    expect(staleBlockingIds(ALL, [PERSONAL.id, 'deleted@example.com'])).toEqual(['deleted@example.com'])
  })

  it('reports nothing when every blocking id is live', () => {
    expect(staleBlockingIds(ALL, [PERSONAL.id])).toEqual([])
  })
})

describe('sanitizeCalendarIds', () => {
  it('keeps unique non-empty strings', () => {
    expect(sanitizeCalendarIds(['a', 'b', 'a', ' c '])).toEqual(['a', 'b', 'c'])
  })

  it('drops non-strings and blanks', () => {
    expect(sanitizeCalendarIds(['a', '', '   ', 3, null, undefined, {}])).toEqual(['a'])
  })

  it('returns an empty array for anything that is not an array', () => {
    expect(sanitizeCalendarIds(null)).toEqual([])
    expect(sanitizeCalendarIds('a')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/calendar-selection.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/appointments/calendarSelection"`.

- [ ] **Step 3: Write the implementation**

Create `lib/appointments/calendarSelection.ts`:

```ts
import type { CalendarRef } from './calendarTypes'

/**
 * Which calendars display, and which protect the firm's time.
 *
 * Only deviations from the default are stored, so "absent from both arrays"
 * is the meaningful state a new calendar arrives in: visible, non-blocking.
 * Blocking is opted into per calendar because Google's freeBusy treats an
 * all-day event as busy for the whole day — a subscribed holiday or birthday
 * calendar that blocked by default would silently make the attorney
 * unbookable on every one of those days.
 *
 * Pure by design: no Google, no Supabase, so each rule is testable on its own.
 */

/** Normalize an id list off the wire or out of the database. */
export function sanitizeCalendarIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (id) seen.add(id)
  }
  return [...seen]
}

/**
 * The calendars to read events from.
 *
 * The primary calendar survives whatever `hiddenIds` says. It is what
 * "connected" means — `listCalendarView` reads it first and a failure there is
 * fatal — so the rule is enforced here rather than trusted to the UI.
 */
export function visibleCalendars(
  all: readonly CalendarRef[],
  hiddenIds: readonly string[],
): CalendarRef[] {
  const hidden = new Set(hiddenIds)
  return all.filter(calendar => calendar.isDefault || !hidden.has(calendar.id))
}

/**
 * The `freeBusy` request's calendar ids: primary, then each blocking calendar.
 *
 * `primary` is an alias rather than an id, so a blocking entry naming the
 * primary calendar by its real address would ask about the same calendar
 * twice. That is harmless — availability takes the union of busy intervals —
 * and the literal duplicate is collapsed here anyway.
 */
export function busyCalendarIds(blockingIds: readonly string[]): string[] {
  return [...new Set(['primary', ...blockingIds])]
}

/**
 * Blocking ids that no longer match a calendar on the account.
 *
 * A stale id errors on every `freeBusy` call, and under the fail-closed rule
 * that takes availability down. The settings UI renders these as removable so
 * the surface that creates them is the surface that clears them.
 */
export function staleBlockingIds(
  all: readonly CalendarRef[],
  blockingIds: readonly string[],
): string[] {
  const live = new Set(all.map(calendar => calendar.id))
  return blockingIds.filter(id => !live.has(id))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/calendar-selection.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Prove the primary-calendar guard is real**

An assertion that passes against its own assumption proves nothing. Temporarily change `visibleCalendars` to drop the `calendar.isDefault ||` clause:

```ts
  return all.filter(calendar => !hidden.has(calendar.id))
```

Run: `npx vitest run tests/calendar-selection.test.ts`
Expected: FAIL on "keeps the primary calendar even when its id is in the hidden list".

Restore the `calendar.isDefault ||` clause and re-run.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/appointments/calendarSelection.ts tests/calendar-selection.test.ts
git commit -m "feat: decide which calendars display and which block booking"
```

---

## Task 3: Settings storage

**Files:**
- Modify: `lib/appointments/types.ts`
- Modify: `lib/appointments/settings.ts`

- [ ] **Step 1: Add the fields to the settings type**

In `lib/appointments/types.ts`, inside `interface SchedulingSettings`, after the `calendlyUrls` field:

```ts
  /** Google calendar ids hidden from the admin calendar (primary is never hidden). */
  hiddenCalendarIds: string[]
  /** Google calendar ids that block client booking, in addition to primary. */
  blockingCalendarIds: string[]
```

- [ ] **Step 2: Read them in getSchedulingSettings**

In `lib/appointments/settings.ts`:

Add to the imports at the top:

```ts
import { sanitizeCalendarIds } from './calendarSelection'
```

Add to `interface SchedulingSettingsRow`:

```ts
  hidden_calendar_ids: unknown
  blocking_calendar_ids: unknown
```

Add to the object returned by `defaults()`:

```ts
    hiddenCalendarIds: [],
    blockingCalendarIds: [],
```

**The `select` call names its columns rather than using `*`.** Both new columns must be added to that string or they read as `undefined` and fall through to the defaults — they would appear to save and then quietly do nothing. Change the select to:

```ts
    .select('timezone, weekly_hours, min_notice_hours, horizon_days, buffer_minutes, reminder_hours_before, booking_paused, sms_reminders_enabled, auto_intake_invite, date_overrides, calendly_urls, hidden_calendar_ids, blocking_calendar_ids')
```

Add to the `value` object built from `row`:

```ts
        hiddenCalendarIds: sanitizeCalendarIds(row.hidden_calendar_ids),
        blockingCalendarIds: sanitizeCalendarIds(row.blocking_calendar_ids),
```

- [ ] **Step 3: Write them in updateSchedulingSettings**

Add to `interface UpdateSchedulingSettingsInput`:

```ts
  hiddenCalendarIds?: unknown
  blockingCalendarIds?: unknown
```

Add to the `patch` assembly, before the `updatedBy` line:

```ts
  if (input.hiddenCalendarIds !== undefined) {
    patch.hidden_calendar_ids = sanitizeCalendarIds(input.hiddenCalendarIds)
  }
  if (input.blockingCalendarIds !== undefined) {
    patch.blocking_calendar_ids = sanitizeCalendarIds(input.blockingCalendarIds)
  }
```

`updateSchedulingSettings` already ends with `settingsCache = null`, so a change takes effect on the next read rather than up to 30 seconds later. No extra cache handling is needed.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Confirm nothing regressed**

Run: `npx vitest run tests/calendar-selection.test.ts tests/calendar-busy.test.ts tests/calendar-fanout.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/appointments/types.ts lib/appointments/settings.ts
git commit -m "feat: persist the calendar display and blocking choices"
```

---

## Task 4: Skip hidden calendars on the read path

`listCalendarView` reads the setting itself. It has five production callers — `calendar-events`, `app/api/admin/calendar/plan/route.ts`, `lib/queries/today.ts`, `lib/adminChat/calendarTools.ts`, and `lib/appointments/calendarSnapshot.ts` (which already passes `ownerId` positionally). Reading the setting inside means every one of them honors it with no signature change and no call site that can forget.

**Files:**
- Modify: `lib/appointments/googleEvents.ts:475-560`
- Test: `tests/calendar-fanout.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/calendar-fanout.test.ts`, add this mock beside the existing `@/lib/googleCalendar` mock near the top of the file (after the `vi.mock('next/cache', ...)` line):

```ts
const getSchedulingSettings = vi.fn(async () => ({
  hiddenCalendarIds: [] as string[],
  blockingCalendarIds: [] as string[],
}))
vi.mock('@/lib/appointments/settings', () => ({
  getSchedulingSettings: () => getSchedulingSettings(),
}))
```

Add to the existing `beforeEach` block:

```ts
  getSchedulingSettings.mockResolvedValue({ hiddenCalendarIds: [], blockingCalendarIds: [] })
```

Add this describe block at the end of the file:

```ts
describe('listCalendarView hidden calendars', () => {
  it('never fetches a hidden calendar', async () => {
    const fetchMock = stubGoogle({
      calendars: [
        { id: 'primary', summary: 'Aubrey Law', primary: true },
        { id: 'personal@example.com', summary: 'Personal' },
        { id: 'holidays@example.com', summary: 'US Holidays' },
      ],
      primaryEvents: [event('primary-1')],
      calendarEvents: {
        'personal@example.com': [event('personal-1')],
        'holidays@example.com': [event('holiday-1')],
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    getSchedulingSettings.mockResolvedValue({
      hiddenCalendarIds: ['holidays@example.com'],
      blockingCalendarIds: [],
    })

    const view = await listCalendarView(FROM, TO)

    // Hidden means not read, not merely filtered after paying for it.
    const urls = fetchMock.mock.calls.map(call => String(call[0]))
    expect(urls.some(url => url.includes('holidays%40example.com'))).toBe(false)
    expect(view.calendars.map(c => c.id)).toEqual(['primary', 'personal@example.com'])
  })

  it('reads the primary calendar even when its id is hidden', async () => {
    vi.stubGlobal('fetch', stubGoogle({
      calendars: [{ id: 'primary', summary: 'Aubrey Law', primary: true }],
      primaryEvents: [event('primary-1')],
    }))
    getSchedulingSettings.mockResolvedValue({
      hiddenCalendarIds: ['primary'],
      blockingCalendarIds: [],
    })

    const view = await listCalendarView(FROM, TO)

    expect(view.calendars.map(c => c.id)).toEqual(['primary'])
  })

  it('reads every calendar when nothing is hidden', async () => {
    vi.stubGlobal('fetch', stubGoogle({
      calendars: [
        { id: 'primary', summary: 'Aubrey Law', primary: true },
        { id: 'personal@example.com', summary: 'Personal' },
      ],
      primaryEvents: [event('primary-1')],
      calendarEvents: { 'personal@example.com': [event('personal-1')] },
    }))

    const view = await listCalendarView(FROM, TO)

    expect(view.calendars.map(c => c.id)).toEqual(['primary', 'personal@example.com'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/calendar-fanout.test.ts`
Expected: FAIL on "never fetches a hidden calendar" — the url for `holidays@example.com` is present, and `view.calendars` has three entries.

- [ ] **Step 3: Write the implementation**

In `lib/appointments/googleEvents.ts`, add to the imports at the top:

```ts
import { visibleCalendars } from './calendarSelection'
import { getSchedulingSettings } from './settings'
```

In `listCalendarView`, replace the line that reads:

```ts
  const others = account.filter(calendar => !calendar.isDefault)
```

with:

```ts
  // Hidden calendars are never fetched. Deselecting is therefore how the
  // attorney spends the secondary budget deliberately: MAX_SECONDARY_CALENDARS
  // and SECONDARY_CALENDAR_BUDGET_MS apply to whatever survives this filter, so
  // hiding noise is what keeps a calendar they care about out of `skipped`.
  const { hiddenCalendarIds } = await getSchedulingSettings()
  const others = visibleCalendars(account, hiddenCalendarIds).filter(
    calendar => !calendar.isDefault,
  )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/calendar-fanout.test.ts`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 5: Confirm the other callers still compile and pass**

Run: `npm run typecheck && npx vitest run tests/calendar-view-mapping.test.ts tests/calendar-reconcile.test.ts tests/google-calendar-events.test.ts`
Expected: exit 0, PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/appointments/googleEvents.ts tests/calendar-fanout.test.ts
git commit -m "feat: a hidden calendar is never read"
```

---

## Task 5: Block booking on the chosen calendars

**Files:**
- Modify: `lib/appointments/calendarBusy.ts:55-90`
- Test: `tests/calendar-busy.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/calendar-busy.test.ts`, add this mock after the existing `vi.mock('@/lib/supabaseAdmin', ...)` line:

```ts
const getSchedulingSettings = vi.fn(async () => ({
  hiddenCalendarIds: [] as string[],
  blockingCalendarIds: [] as string[],
}))
vi.mock('@/lib/appointments/settings', () => ({
  getSchedulingSettings: () => getSchedulingSettings(),
}))
```

Add to the existing `beforeEach` block:

```ts
  getSchedulingSettings.mockResolvedValue({ hiddenCalendarIds: [], blockingCalendarIds: [] })
```

Add this describe block at the end of the file:

```ts
describe('fetchCalendarBusy blocking calendars', () => {
  it('asks only about primary when nothing else blocks', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ calendars: { primary: { busy: [] } } }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchCalendarBusy(FROM, TO)

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.items).toEqual([{ id: 'primary' }])
  })

  it('merges busy blocks from a blocking calendar', async () => {
    getSchedulingSettings.mockResolvedValue({
      hiddenCalendarIds: [],
      blockingCalendarIds: ['personal@example.com'],
    })
    const fetchMock = vi.fn(async () => jsonResponse({
      calendars: {
        primary: { busy: [{ start: '2026-09-10T14:00:00Z', end: '2026-09-10T15:00:00Z' }] },
        'personal@example.com': {
          busy: [{ start: '2026-09-10T18:00:00Z', end: '2026-09-10T19:00:00Z' }],
        },
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchCalendarBusy(FROM, TO)).toEqual([
      { start: Date.parse('2026-09-10T14:00:00Z'), end: Date.parse('2026-09-10T15:00:00Z') },
      { start: Date.parse('2026-09-10T18:00:00Z'), end: Date.parse('2026-09-10T19:00:00Z') },
    ])
  })

  it('sends primary plus each blocking calendar', async () => {
    getSchedulingSettings.mockResolvedValue({
      hiddenCalendarIds: [],
      blockingCalendarIds: ['personal@example.com'],
    })
    const fetchMock = vi.fn(async () => jsonResponse({
      calendars: {
        primary: { busy: [] },
        'personal@example.com': { busy: [] },
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchCalendarBusy(FROM, TO)

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.items).toEqual([{ id: 'primary' }, { id: 'personal@example.com' }])
  })

  // freeBusy reports per-calendar errors rather than failing the request, so
  // ignoring them is the easy path and the wrong one. A calendar the firm
  // marked as blocking is one it asked to protect its time; dropping its error
  // quietly reopens the exact hole this feature closes, invisibly, in the one
  // direction where the cost is a double-booked client.
  it('throws when a blocking calendar reports errors', async () => {
    getSchedulingSettings.mockResolvedValue({
      hiddenCalendarIds: [],
      blockingCalendarIds: ['personal@example.com'],
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      calendars: {
        primary: { busy: [] },
        'personal@example.com': { errors: [{ domain: 'global', reason: 'notFound' }] },
      },
    })))

    await expect(fetchCalendarBusy(FROM, TO)).rejects.toBeInstanceOf(AvailabilityUnavailableError)
  })

  it('throws when a blocking calendar is missing from the response entirely', async () => {
    getSchedulingSettings.mockResolvedValue({
      hiddenCalendarIds: [],
      blockingCalendarIds: ['personal@example.com'],
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      calendars: { primary: { busy: [] } },
    })))

    await expect(fetchCalendarBusy(FROM, TO)).rejects.toBeInstanceOf(AvailabilityUnavailableError)
  })

  it('is unaffected by a calendar that does not block', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      calendars: {
        primary: { busy: [{ start: '2026-09-10T14:00:00Z', end: '2026-09-10T15:00:00Z' }] },
        'personal@example.com': { errors: [{ reason: 'notFound' }] },
      },
    })))

    expect(await fetchCalendarBusy(FROM, TO)).toEqual([
      { start: Date.parse('2026-09-10T14:00:00Z'), end: Date.parse('2026-09-10T15:00:00Z') },
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/calendar-busy.test.ts`
Expected: FAIL on "sends primary plus each blocking calendar", "merges busy blocks from a blocking calendar", and both throw cases — the request still carries only `primary`.

- [ ] **Step 3: Write the implementation**

In `lib/appointments/calendarBusy.ts`, add to the imports at the top:

```ts
import { busyCalendarIds } from './calendarSelection'
import { getSchedulingSettings } from './settings'
```

Replace the `freeBusy` request and its response handling — everything from `const r = await googleFetch(...)` through the end of the `for (const slot of calendar.busy ?? [])` loop — with:

```ts
  const { blockingCalendarIds } = await getSchedulingSettings()
  const requestedIds = busyCalendarIds(blockingCalendarIds)

  const r = await googleFetch(`${CALENDAR_BASE}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      // `primary` is the account's own calendar whatever its address is, so
      // this keeps working if the firm ever changes the Google address. The
      // rest are the calendars the firm asked to protect its time.
      items: requestedIds.map(id => ({ id })),
    }),
  })

  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    console.error('[appointments] freeBusy failed', r.status, detail.slice(0, 500))
    throw new AvailabilityUnavailableError('Could not read Google Calendar availability')
  }

  const json = (await r.json()) as {
    calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }>; errors?: unknown[] }>
  }

  // Every requested calendar must answer cleanly. freeBusy reports per-calendar
  // errors instead of failing the request, so an unchecked error reads as a free
  // calendar — which is how a client books on top of a real commitment. A
  // calendar the firm did not mark as blocking is never requested and so can
  // never reach this check.
  const busy: Interval[] = []
  for (const id of requestedIds) {
    const calendar = json.calendars?.[id]
    if (!calendar || (calendar.errors?.length ?? 0) > 0) {
      console.error('[appointments] freeBusy returned calendar errors', id, calendar?.errors)
      throw new AvailabilityUnavailableError('Could not read Google Calendar availability')
    }
    for (const slot of calendar.busy ?? []) {
      const start = slot.start ? Date.parse(slot.start) : NaN
      const end = slot.end ? Date.parse(slot.end) : NaN
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
      busy.push({ start, end })
    }
  }
  return busy
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/calendar-busy.test.ts`
Expected: PASS, all tests including the four pre-existing fail-closed cases.

- [ ] **Step 5: Prove the fatal-error rule is real**

Temporarily weaken the check to skip a bad calendar instead of throwing:

```ts
    if (!calendar || (calendar.errors?.length ?? 0) > 0) {
      continue
    }
```

Run: `npx vitest run tests/calendar-busy.test.ts`
Expected: FAIL on "throws when a blocking calendar reports errors" and "throws when a blocking calendar is missing from the response entirely".

Restore the `throw` and re-run.
Expected: PASS.

- [ ] **Step 6: Confirm booking paths still pass**

Run: `npx vitest run tests/calendar-fanout.test.ts tests/calendar-selection.test.ts && npm run typecheck`
Expected: PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/appointments/calendarBusy.ts tests/calendar-busy.test.ts
git commit -m "feat: a blocking calendar protects the firm's time, or booking fails closed"
```

---

## Task 6: Expose the account's calendars to the settings UI

The blocking editor needs the live calendar list to render names and to detect stale ids. The calendar page gets its list from the events response; the settings page has no such call.

**Files:**
- Create: `app/api/admin/scheduling/calendars/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/admin/scheduling/calendars/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { listAccountCalendars } from '@/lib/appointments/googleEvents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Every calendar on the connected Google account.
 *
 * The calendar page learns its list from the events response; the settings
 * page has no such call and needs one to name the calendars the firm is
 * choosing between, and to spot a blocking id Google no longer serves.
 *
 * Degrades to `connected: false` rather than erroring, so a Google outage
 * leaves the scheduling settings editable.
 */
export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  try {
    return NextResponse.json({ connected: true, calendars: await listAccountCalendars() })
  } catch (e) {
    console.error('[appointments] could not list Google calendars', e)
    return NextResponse.json({
      connected: false,
      calendars: [],
      error: e instanceof Error ? e.message : 'Google Calendar is unreachable',
    })
  }
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: exit 0 for both.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/scheduling/calendars/route.ts
git commit -m "feat: list the account's calendars for the settings page"
```

---

## Task 7: Accept the two arrays on the settings route

**Files:**
- Modify: `app/api/admin/scheduling/settings/route.ts`

- [ ] **Step 1: Add the fields to the request body type**

In `interface PutBody`, inside the `settings` object, after `calendlyUrls?: unknown`:

```ts
    hiddenCalendarIds?: unknown
    blockingCalendarIds?: unknown
```

- [ ] **Step 2: Pass them through to the update**

Find the `PUT` handler's call to `updateSchedulingSettings`. Add these two entries to the object it passes, alongside the existing `calendlyUrls` entry:

```ts
      hiddenCalendarIds: body.settings.hiddenCalendarIds,
      blockingCalendarIds: body.settings.blockingCalendarIds,
```

`updateSchedulingSettings` ignores `undefined` and runs `sanitizeCalendarIds` on anything else, so no validation belongs here — a client sending garbage gets an empty array, not a 500.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Verify the round trip by hand**

Start the dev server (`npm run dev`), sign in as an admin, then in the browser console on any admin page:

```js
await fetch('/api/admin/scheduling/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ settings: { blockingCalendarIds: ['test@example.com'] } }),
}).then(r => r.json())

await fetch('/api/admin/scheduling/settings').then(r => r.json()).then(j => j.settings.blockingCalendarIds)
```

Expected: `['test@example.com']`. This is the check that catches the explicit-`select` trap — if the column is missing from the select list, the read returns `[]` here even though the write succeeded.

Then clear it:

```js
await fetch('/api/admin/scheduling/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ settings: { blockingCalendarIds: [] } }),
})
```

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/scheduling/settings/route.ts
git commit -m "feat: save the calendar display and blocking choices"
```

---

## Task 8: Visibility popover on the calendar page

**Files:**
- Create: `app/admin/calendar/CalendarVisibilityPopover.tsx`
- Modify: `app/admin/calendar/CalendarClient.tsx:765-800`

- [ ] **Step 1: Write the popover**

Create `app/admin/calendar/CalendarVisibilityPopover.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ExternalCalendarRef } from './types'

interface Props {
  calendars: ExternalCalendarRef[]
  hiddenIds: string[]
  authHeaders: () => HeadersInit | undefined
  /** Called after a successful save, so the caller can refetch the range. */
  onChange: (hiddenIds: string[]) => void
}

/**
 * Which calendars show on the grid.
 *
 * A view control, so it lives where the attorney is looking. The matching
 * booking policy is in Settings → Scheduling on purpose: it changes what
 * clients can book and should not be one click from the grid.
 */
export function CalendarVisibilityPopover({ calendars, hiddenIds, authHeaders, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async (next: string[]) => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/scheduling/settings', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { hiddenCalendarIds: next } }),
      })
      if (!res.ok) throw new Error(String(res.status))
      onChange(next)
    } catch {
      toast.error('Could not save which calendars to show')
    } finally {
      setSaving(false)
    }
  }

  const toggle = (id: string, show: boolean) => {
    void save(show ? hiddenIds.filter(hidden => hidden !== id) : [...new Set([...hiddenIds, id])])
  }

  const shown = calendars.filter(c => c.isDefault || !hiddenIds.includes(c.id)).length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          title="Choose which calendars appear here"
          data-testid="calendar-visibility-trigger"
        >
          · {shown} of {calendars.length} calendars
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2">
        <p className="text-xs font-medium text-foreground">Show on this calendar</p>
        {calendars.map(calendar => (
          <label key={calendar.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={calendar.isDefault || saving}
              checked={calendar.isDefault || !hiddenIds.includes(calendar.id)}
              onChange={e => toggle(calendar.id, e.target.checked)}
            />
            <span className="truncate">{calendar.name}</span>
            {calendar.isDefault && (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">always</span>
            )}
          </label>
        ))}
        <p className="pt-1 text-xs text-muted-foreground">
          Hiding a calendar also stops Cornerstone reading it. To stop a calendar
          blocking client bookings, use Settings → Scheduling.
        </p>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Hold the hidden ids in CalendarClient**

In `app/admin/calendar/CalendarClient.tsx`, add the import beside the other local imports:

```tsx
import { CalendarVisibilityPopover } from './CalendarVisibilityPopover'
```

Add this state declaration next to `const [syncedCalendars, setSyncedCalendars] = useState<ExternalCalendarRef[]>([])`:

```tsx
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<string[]>([])
```

`listCalendarView` returns only the calendars it read, so a hidden calendar is absent from `calendarJson.calendars` and could not be un-hidden from a list built off it. Fetch the full account list once. Add this effect after the existing `load` callback:

```tsx
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [calendarsRes, settingsRes] = await Promise.all([
          fetch('/api/admin/scheduling/calendars', { headers: authHeaders() }),
          fetch('/api/admin/scheduling/settings', { headers: authHeaders() }),
        ])
        if (cancelled || !calendarsRes.ok || !settingsRes.ok) return
        const calendarsJson = await calendarsRes.json()
        const settingsJson = await settingsRes.json()
        if (cancelled) return
        setAccountCalendars(calendarsJson.calendars ?? [])
        setHiddenCalendarIds(settingsJson.settings?.hiddenCalendarIds ?? [])
      } catch {
        // The popover is a convenience; the grid renders without it.
      }
    })()
    return () => { cancelled = true }
  }, [authHeaders])
```

Add the backing state beside `hiddenCalendarIds`:

```tsx
  const [accountCalendars, setAccountCalendars] = useState<ExternalCalendarRef[]>([])
```

- [ ] **Step 3: Replace the calendars chip**

The existing `· {syncedCalendars.length} calendars` span sits **inside** the `<label>` that wraps the "Calendar events" checkbox, so a click on it currently toggles that checkbox. The popover trigger must move out of the label or it can never be clicked.

Delete this block from inside the `<label>`:

```tsx
            {showCalendar && calendarConnected && syncedCalendars.length > 1 && (
              <span title={syncedCalendars.map(c => c.name).join(', ')}>
                · {syncedCalendars.length} calendars
              </span>
            )}
```

Then, immediately **after** the closing `</label>` tag and before `<QuickBookPopover`, add:

```tsx
          {showCalendar && calendarConnected && accountCalendars.length > 1 && (
            <CalendarVisibilityPopover
              calendars={accountCalendars}
              hiddenIds={hiddenCalendarIds}
              authHeaders={authHeaders}
              onChange={next => {
                setHiddenCalendarIds(next)
                void load()
              }}
            />
          )}
```

- [ ] **Step 4: Confirm the popover primitive exists**

Run: `ls components/ui/popover.tsx`
Expected: the file exists. If it does not, run `npx shadcn@latest add popover` before continuing.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: exit 0 for both.

- [ ] **Step 6: Verify it in the running app**

Start the dev server with `npm run dev`, then use the preview tools to open `http://localhost:3002/admin/calendar` and confirm:

1. The chip reads "· N of M calendars" and opens a popover on click — it must no longer toggle the "Calendar events" checkbox.
2. The primary calendar's checkbox is disabled and marked "always".
3. Unchecking a secondary calendar removes its events from the grid.
4. Reloading the page keeps that calendar unchecked.
5. The network tab shows no `calendars/<hidden id>/events` request after the reload.

Take a screenshot of the open popover for the commit record.

- [ ] **Step 7: Commit**

```bash
git add app/admin/calendar/CalendarVisibilityPopover.tsx app/admin/calendar/CalendarClient.tsx
git commit -m "feat: choose which calendars appear on the admin calendar"
```

---

## Task 9: Blocking calendars in Settings → Scheduling

**Files:**
- Create: `app/admin/settings/BlockingCalendarsEditor.tsx`
- Modify: `app/admin/settings/SchedulingSettingsSection.tsx`

- [ ] **Step 1: Write the editor**

Create `app/admin/settings/BlockingCalendarsEditor.tsx`:

```tsx
'use client'

import type { ExternalCalendarRef } from '@/app/admin/calendar/types'
import { staleBlockingIds } from '@/lib/appointments/calendarSelection'

interface Props {
  calendars: ExternalCalendarRef[]
  connected: boolean
  blockingIds: string[]
  disabled: boolean
  onChange: (blockingIds: string[]) => void
}

/**
 * Which calendars protect the firm's time from client booking.
 *
 * Separate from the calendar page's visibility popover because this changes
 * what clients can book. Blocking is off by default for a reason worth
 * repeating in the UI: Google treats an all-day event as busy for the whole
 * day, so a holiday or birthday calendar that blocked would wipe out those
 * days entirely.
 */
export function BlockingCalendarsEditor({
  calendars,
  connected,
  blockingIds,
  disabled,
  onChange,
}: Props) {
  const stale = staleBlockingIds(calendars, blockingIds)

  const toggle = (id: string, blocks: boolean) => {
    onChange(blocks ? [...new Set([...blockingIds, id])] : blockingIds.filter(b => b !== id))
  }

  if (!connected) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">Calendars that block booking</p>
        <p className="text-sm text-muted-foreground">
          Google Calendar is not connected. Connect it from Settings → Google to
          choose which calendars protect your time.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Calendars that block booking</p>
      <p className="text-sm text-muted-foreground">
        An event on one of these makes the slot unavailable to clients. Your main
        calendar always blocks. Leave holiday and birthday calendars off — Google
        counts an all-day event as busy for the whole day.
      </p>
      {calendars.map(calendar => (
        <label key={calendar.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={calendar.isDefault || disabled}
            checked={calendar.isDefault || blockingIds.includes(calendar.id)}
            onChange={e => toggle(calendar.id, e.target.checked)}
          />
          <span className="truncate">{calendar.name}</span>
          {calendar.isDefault && (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">always</span>
          )}
        </label>
      ))}
      {stale.map(id => (
        <div
          key={id}
          className="flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-sm"
        >
          <span className="truncate text-amber-900">{id}</span>
          <span className="shrink-0 text-xs text-amber-800">
            Google no longer serves this calendar — it will block all booking until removed
          </span>
          <button
            type="button"
            className="ml-auto shrink-0 text-xs underline"
            disabled={disabled}
            onClick={() => toggle(id, false)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Mount it in the scheduling settings**

In `app/admin/settings/SchedulingSettingsSection.tsx`:

Add the import beside the other local imports:

```tsx
import { BlockingCalendarsEditor } from './BlockingCalendarsEditor'
```

Add these two fields to `interface SettingsShape`, after `dateOverrides`:

```tsx
  hiddenCalendarIds: string[]
  blockingCalendarIds: string[]
```

Add this state beside the component's other `useState` declarations:

```tsx
  const [accountCalendars, setAccountCalendars] = useState<ExternalCalendarRef[]>([])
  const [calendarsConnected, setCalendarsConnected] = useState(false)
```

Add the matching import for the type:

```tsx
import type { ExternalCalendarRef } from '@/app/admin/calendar/types'
```

Add this effect after the component's existing load effect:

```tsx
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/scheduling/calendars', { headers: authHeaders() })
        if (cancelled || !res.ok) return
        const json = await res.json()
        if (cancelled) return
        setAccountCalendars(json.calendars ?? [])
        setCalendarsConnected(Boolean(json.connected))
      } catch {
        // The rest of scheduling settings stays editable without this.
      }
    })()
    return () => { cancelled = true }
  }, [authHeaders])
```

Render the editor inside the settings form, after the existing availability controls:

```tsx
      <BlockingCalendarsEditor
        calendars={accountCalendars}
        connected={calendarsConnected}
        blockingIds={settings.blockingCalendarIds ?? []}
        disabled={saving}
        onChange={next => setSettings({ ...settings, blockingCalendarIds: next })}
      />
```

The section's existing Save button already PUTs the whole `settings` object, which now carries `blockingCalendarIds`. No new save path is needed.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: exit 0 for both.

- [ ] **Step 4: Verify it in the running app**

With `npm run dev` running, open `http://localhost:3002/admin/settings?tab=scheduling` and confirm:

1. Every calendar on the account is listed, with the primary one checked and disabled.
2. Checking a secondary calendar and saving persists across a reload.
3. With that calendar checked, a real event on it removes the matching slot from `/admin/calendar` → Quick book (and from the public booking page's availability).
4. Unchecking it restores the slot.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS. Investigate any failure before continuing — a scheduling or booking test breaking here means a real behavior change, not a stale fixture.

- [ ] **Step 6: Commit**

```bash
git add app/admin/settings/BlockingCalendarsEditor.tsx app/admin/settings/SchedulingSettingsSection.tsx
git commit -m "feat: choose which calendars block client booking"
```

---

## Task 10: Update the spec to match the built design

Task 4 and Task 5 read the setting inside `listCalendarView` and `fetchCalendarBusy` rather than taking it as a parameter, which is not what the spec describes.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-google-calendar-selection-design.md`

- [ ] **Step 1: Correct the read-path section**

Replace the first sentence of the "Read path" section:

> `listCalendarView` takes a set of hidden calendar ids and filters the account
> list returned by `fetchAccountCalendars` before fetching any events.

with:

> `listCalendarView` reads `hidden_calendar_ids` from `getSchedulingSettings()`
> itself and filters the account list returned by `fetchAccountCalendars` before
> fetching any events. It has five production callers, and reading the setting
> inside means each honors it without a signature change and without a call site
> that can forget. The 30-second settings cache makes this one read.

- [ ] **Step 2: Correct the booking-path section**

Replace the first sentence of the "Booking path" section:

> `fetchCalendarBusy` sends `items: [{ id: 'primary' }, ...blockingCalendarIds]`
> and merges the busy intervals from every calendar in the response.

with:

> `fetchCalendarBusy` reads `blocking_calendar_ids` from
> `getSchedulingSettings()` itself, sends
> `items: [{ id: 'primary' }, ...blockingCalendarIds]`, and merges the busy
> intervals from every calendar in the response. As with the read path, reading
> the setting inside covers all six `fetchAllBusy` callers at once.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-16-google-calendar-selection-design.md
git commit -m "docs: read the calendar selection inside, not through every caller"
```

---

## Verification

Before opening a PR:

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` succeeds
- [ ] `npm run check:db-columns` passes
- [ ] `npm run check:migration-drift` passes
- [ ] The two guard-removal checks in Task 2 Step 5 and Task 5 Step 5 were actually run, and each failed before being restored
