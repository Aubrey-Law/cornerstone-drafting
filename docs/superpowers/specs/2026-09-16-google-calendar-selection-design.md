# Google Calendar Selection Design

**Date:** 2026-09-16
**Status:** Approved design, awaiting written-spec review

## Objective

Let the firm choose which of the connected Google account's calendars appear on
the admin calendar, and — separately — which of them protect the firm's time
from client booking.

These are two different questions about the same list, and today the app answers
both by itself: it displays every calendar it can read, and it blocks booking on
the primary calendar alone.

## The gap this closes

The display path and the booking path currently disagree about which calendars
matter.

`listCalendarView` (`lib/appointments/googleEvents.ts`) reads the primary
calendar plus every other calendar on the account, best-effort, tagging each
event with its `calendarId` and `calendarName`. The admin grid renders all of
it.

`fetchCalendarBusy` (`lib/appointments/calendarBusy.ts`) sends a `freeBusy`
query for `items: [{ id: 'primary' }]` and nothing else.

So an event on a secondary calendar is visible to the attorney and invisible to
the booking flow. A client offered that slot books straight over a commitment
the attorney can see on screen. Adding a per-calendar blocking choice is what
closes this, and it is the reason booking is in scope rather than a later
follow-up.

## Selected direction

Store only the deviations from a default, in `scheduling_settings`.

Two array columns record the exceptions:

- `hidden_calendar_ids` — calendars excluded from the admin grid
- `blocking_calendar_ids` — calendars consulted by `freeBusy`

Google's `calendarList` remains the source of truth for which calendars exist.
Cornerstone stores no mirror of that list, so the two stay in sync with no
reconciliation step.

### Why overrides rather than a synced row per calendar

A table with one row per calendar and explicit `visible` / `blocks_booking`
booleans is more queryable, but every calendar-list read becomes a
reconcile-and-upsert, and a calendar deleted in Google forces a decision about
what its orphaned row means.

With override arrays, a newly-subscribed calendar is absent from both arrays and
therefore lands on its defaults automatically — which is exactly the desired
behavior. A calendar deleted in Google leaves an id that matches nothing and is
inert. The firm has roughly five calendars; the table is machinery without a
payer.

Storing the choice client-side was rejected outright: blocking policy must be
server-side to reach `freeBusy` at all.

### Why `scheduling_settings` rather than `firm_settings`

Both are single-row (`id = 1`) typed-column tables with a 30-second cache.
`scheduling_settings` is the right one because:

- It already holds availability policy — `booking_paused`, `buffer_minutes`,
  `weekly_hours`, `min_notice_hours`.
- `SchedulingSettingsSection` already reads and writes it, so the settings UI
  needs no new transport.
- `updateSchedulingSettings` already nulls `settingsCache` on write, so a
  blocking-policy change takes effect on the next read rather than up to 30
  seconds later.
- `__resetSchedulingCaches` already exists as a test hook.

`firm_settings` holds firm identity and the email signature. Calendar selection
is not firm identity.

## Defaults

| | Visible | Blocks booking |
|---|---|---|
| Primary calendar | Always, not togglable | Always, not togglable |
| A calendar Cornerstone has not seen | Yes | No |

A calendar is "not seen" when its id appears in neither array — the state of
every calendar on first connect, and of any calendar subscribed to later.

Visible-by-default means a new calendar announces itself on the grid rather than
hiding. Blocking-off-by-default is the safety choice: Google's `freeBusy` treats
an all-day event as busy for the whole day, so a "Birthdays" or "US Holidays"
calendar that blocked by default would silently make the attorney unbookable on
every one of those days. Blocking is opted into per calendar.

The primary calendar is exempt from both toggles. It is what "connected" means:
`listCalendarView` reads it first and treats a failure there as fatal, and
`fetchCalendarBusy` has always consulted it.

Hidden-and-blocking is a legal, meaningful combination: block the time, keep the
grid clean.

## Read path

`listCalendarView` takes a set of hidden calendar ids and filters the account
list returned by `fetchAccountCalendars` before fetching any events. A hidden
calendar is never fetched — deselecting does not merely hide events after
paying for them.

This has a second effect worth stating, because it is a reason to deselect
rather than an incidental saving. The existing `MAX_SECONDARY_CALENDARS` cap and
`SECONDARY_CALENDAR_BUDGET_MS` budget apply to whatever calendars survive the
filter. Today a noisy subscribed calendar can consume the budget and push a
calendar the attorney cares about into `skipped`. After this change, hiding the
noise is how the attorney keeps real calendars out of `skipped`.

Primary is never filtered, whatever `hidden_calendar_ids` contains.

Failure behavior is unchanged. A primary-calendar failure is fatal inside
`listCalendarView`; the `calendar-events` route catches it and degrades the whole
response to `connected: false`, leaving the calendar page usable. A secondary
calendar that Google refuses is recorded in `skipped` and never takes the view
down.

## Booking path

`fetchCalendarBusy` sends `items: [{ id: 'primary' }, ...blockingCalendarIds]`
and merges the busy intervals from every calendar in the response.

**A blocking calendar's error is fatal, exactly as primary's is.**

`freeBusy` returns per-calendar `errors` rather than failing the request, so
ignoring them is the easy path and the wrong one. The function's existing
contract is to fail closed — the code comment states that offering a slot it
could not verify is how a client books over something already on the calendar.
A calendar marked as blocking is one the firm has explicitly asked to protect
its time. Dropping its errors quietly would reopen the precise hole this feature
exists to close, and it would do so invisibly, in the one direction where the
cost is a double-booked client.

So any calendar in the request coming back with errors — primary or blocking —
raises `AvailabilityUnavailableError`. The trade is deliberate: the booking page
shows "availability unavailable" instead of offering a slot that may already be
taken.

A calendar that is not marked blocking is never sent to `freeBusy` and therefore
cannot trigger this.

A blocking id that no longer exists in Google is a stale entry that will produce
an error and, under the rule above, will take availability down. The settings UI
prevents this from accumulating by rendering blocking ids that no longer match a
live calendar as removable stale rows.

## UI

The two toggles are split by intent.

**Visibility — on the calendar page.** `CalendarClient` already holds
`syncedCalendars` state and renders a `· N calendars` chip. That chip becomes
the trigger for a popover with a checkbox per calendar; the primary calendar's
row is checked and disabled with a short explanation. Toggling writes
`hidden_calendar_ids` and refetches the range. This is a view control, and it
belongs where the attorney is looking.

**Blocking — in Settings → Scheduling.** `SchedulingSettingsSection` gains a
"Calendars that block booking" list beside the other availability rules, with
the primary calendar shown as always-on. This is a policy that changes what
clients can book, so it should not be one click from the grid.

This list is also where stale blocking ids are cleared. An id in
`blocking_calendar_ids` that matches no calendar in the live `calendarList` is
rendered as a flagged row — named by its raw id, with a remove action and a note
that Google no longer serves it. Under the fail-closed rule above a stale id
takes availability down, so the surface that creates them is the surface that
has to make them visible and removable.

`CalendarClient` is already 1401 lines. The popover is added as its own
component file rather than inline, and the calendar-list fetch it needs is
lifted into a small hook, so this feature does not deepen that file's problem.

## Testing

Unit tests on the logic, per the project's preference for proving a guard by
removing it:

- A hidden calendar is absent from the fetch list, not merely filtered from the
  results.
- The primary calendar survives filtering when its id is in `hidden_calendar_ids`.
- A calendar in neither array resolves to visible, non-blocking.
- `freeBusy` receives primary plus exactly the blocking ids, and merges busy
  intervals across them.
- A blocking calendar returning `errors` raises `AvailabilityUnavailableError`.
  This test is validated by deleting the error check and confirming it fails —
  an assertion that passes against its own assumption proves nothing.
- A non-blocking calendar's absence from the request means its state cannot
  affect availability.

## Out of scope

- **Microsoft calendars.** `lib/microsoftCalendar.ts` is a separate path with
  its own connection rows. Nothing here changes it.
- **Raising `MAX_SECONDARY_CALENDARS`.** This change makes the cap less likely
  to bite by giving the attorney a way to spend the budget deliberately. Whether
  the cap itself is right is a separate question.
- **Per-user selection.** Storage is firm-wide, matching the solo-practice
  assumption already stated in `getAnyConnectionForProvider`. A second
  practitioner would need this revisited.
- **Writing events to a non-primary calendar.** Cornerstone continues to create
  and update its own bookings on `calendars/primary`.

## Migration

One migration adds to `scheduling_settings`:

```sql
alter table public.scheduling_settings
  add column if not exists hidden_calendar_ids   text[] not null default '{}',
  add column if not exists blocking_calendar_ids text[] not null default '{}';
```

Both default to empty, so every existing calendar keeps its current visible
state and the booking path keeps consulting primary alone until the firm opts a
calendar in. There is no backfill and no behavior change on deploy.

`getSchedulingSettings` selects an explicit column list rather than `*`. Both
new columns must be added to that list and to `SchedulingSettingsRow`, or they
read as `undefined` and fall through to the defaults — the arrays would appear
to save and then quietly do nothing. The same applies to
`UpdateSchedulingSettingsInput` and the `patch` assembly in
`updateSchedulingSettings`.

Per the project's note on migration history, verify the columns exist in the
database itself after applying, rather than trusting `schema_migrations`.
