# Implement calendar enhancements (/admin/calendar)

Improve the calendar so staff can see their next action, assess workload, and book verified available time. Implement the five parts below as separate commits, in order. Follow AGENTS.md and preserve existing scheduling, calendar reconciliation, and drafting contracts.

The intended visual reference is `Calendar Enhancements.dc.html`, sections 1a, 1b, 1c, and 2a. That file was unavailable during prompt review. If it is still unavailable, use this specification and existing Cornerstone components as the design reference; report that visual comparison was not performed.

Reuse existing theme tokens, `CATEGORY_STYLE`, `BLOCK_HATCH`, shadcn Button/Dialog/Popover, and lucide icons. Use theme-aware surfaces instead of literal white fills or new hex colors.

## Implementation boundaries and shared rules

- Inspect current files rather than relying on line numbers. Primary files: `app/admin/calendar/CalendarClient.tsx`, `DayAgenda.tsx`, `CalendarVisibilityPopover.tsx`, `PlanView.tsx`, `eventCategories.ts`, `timeGrid.ts`, `types.ts`, and `page.tsx`.
- Existing date navigation is `shift(delta)`. Keep anchor and selected day coordinated: Day renders the selected day; Week's selected day must stay inside its displayed range. After Week navigation, select today if visible, otherwise the anchor day. Moving between views must retain the intended date.
- Reuse the existing scheduling timezone and date helpers. Make date keys, working hours, availability, workload, labels, and URL dates consistent. Parse date-only values as calendar dates rather than UTC instants; validate real dates. Do not introduce fixed UTC offsets or assume an eight-hour workday. Cover daylight-saving transitions.
- Use one shared, minute-updated clock for countdowns, past styling, and now markers. Refresh it on tab visibility changes and midnight; clean up timers/listeners.
- Separate fetched source data from presentation-filtered data. Category filters must not alter availability, scheduling policy, workload totals, attention items, or appointment reconciliation. Preserve deduplication of Cornerstone appointments and their Google copies.
- Reuse existing scheduling settings and availability operations. Do not derive booking permission from empty space on the displayed calendar.
- Identify an authoritative prep readiness source and a supported idempotent outbound sync retry before implementing those labels/actions. `CalendarAppointment` currently lacks prep readiness and pending-reason fields. Extend the authenticated data contract only as needed; do not infer readiness from future/past status or invent an API. Unknown readiness must be shown as unknown. If a source or operation is unavailable, report the limitation and do not ship fabricated status or a nonfunctional action.
- Calendar source metadata may be incomplete. Keep generic fallback labels and preserve externally managed appointment restrictions.
- Handle loading, empty, unavailable, and stale responses distinctly. Cancel or ignore obsolete requests when range/selection changes; handle failures without rendering old data as current.

## 1. Day by default, remembered, and linkable (2a)

- View precedence: valid URL `view` → valid saved view → `day`. Allowed values: `day`, `week`, `month`, `plan`. Invalid values fall through to the next source.
- Date precedence: valid URL `date` → valid `initialDay` → today. With no date input, saved view changes only the view, not the date.
- Keep `?view=...&date=YYYY-MM-DD` synchronized using `router.replace`, preserving unrelated parameters and avoiding unnecessary scroll changes. Resolve initial preferences before writing them back. Support client-side URL changes and browser Back/Forward without loops or the existing `initialDay` effect undoing navigation.
- Preserve `cornerstone.calendar.view` as the saved-view key. Handle unavailable/malformed localStorage safely. Preference persistence is browser-scoped; do not claim cross-device persistence.
- After the first explicit user view change, show a small theme-aware toast: “Opens on {View} next time.” Omit “Change default”: switching views already changes the remembered view. Scope the toast's seen marker to the authenticated user in this browser. Do not show it for initial hydration or URL-driven changes.
- Register shortcuts in one handler, including existing Cmd/Ctrl+Shift+K Quick book. Ignore shortcuts inside inputs, textareas, selects, editable ancestors, dialogs, and interactive popovers. Ignore composing/repeated events and unexpected modifier combinations. Prevent default only when handling a shortcut.
  - D/W/M/P: switch view.
  - T: today, updating anchor and selected day.
  - Left/Right: previous/next day in Day, week in Week, month in Month. Do not override existing Plan navigation semantics.
  - ?: shortcut-help Dialog, listing all supported keys and Cmd/Ctrl+Shift+K.
- Add unobtrusive kbd hints to view controls and Today; add “← → previous / next day · ? all shortcuts” below Day agenda.

Acceptance: fresh preferences open Day today; saved Week survives reload; URL Month overrides saved Week; invalid dates/views fall back safely; unrelated query parameters survive; Back/Forward and linked date navigation work; typing and modal interaction do not trigger shortcuts.

## 2. Simpler toolbar (1a)

- Make the displayed date/range the single page h1 next to previous/next controls. Example: “October 4 – 10, 2026” for Week; “Wednesday, October 7” for Day. Avoid duplicating the large heading in DayAgenda. Format ranges correctly across month/year boundaries.
- Extend `CalendarVisibilityPopover`; replace Show calendar, the calendar-count link, and inline warnings with one Calendars popover button.
- Treat Cornerstone appointments as one always-on source. Count that source plus all discovered Google calendars consistently in the shown/total label. Primary Google calendar is always on; secondary calendars retain existing server-persisted visibility settings.
- Show a theme-aware warning dot with an accessible label for disconnection, request errors, skipped calendars, or truncation. Put account-wide connection/error/truncation warnings in an account-level section. Attribute skipped-calendar warnings to the affected entry where identifiers can be resolved; retain a generic warning otherwise.
- Preserve save-in-progress disabling, failure feedback, and refetch after successful visibility changes. Render discovery failures as unavailable rather than “0 calendars.” Removing the global Show calendar control must not disable primary-calendar reads or reconciliation.
- Keep footer: “Hiding a calendar also stops Cornerstone reading it. To stop a calendar blocking client bookings, use Settings → Scheduling.” Link Scheduling where practical. Do not change booking blocking policy from this menu.
- Replace the legend with category filter chips plus Blocked. Chips show counts before category filtering, for the current displayed range, after source visibility and deduplication. Use the existing classification and block rules. Hidden chips have strikethrough and no filled background, with aria-pressed conveying visibility. Persist validated hidden categories locally and tolerate storage failures.
- Apply category filtering consistently to event presentation in Day/Week/Month and event lists; preserve Plan's workload and task presentation. Clearly label summaries as total counts before category filtering. Keep workload, available gaps, and attention based on their authoritative unfiltered data.
- Right-align a responsive summary, e.g. “9 appointments · 4 calendar events this week.” Avoid counting cancelled appointments as scheduled appointments; distinguish no-shows/rescheduled records according to existing lifecycle semantics.

Acceptance: source controls reuse existing settings; the primary calendar remains read; warnings remain available; filtering a busy event does not create a bookable gap or reduce workload.

## 3. Clearer events in Week (1b)

- Remove Busy pills. Busy is the default. For explicitly free appointments (`calendarShowAsBusy === false`) and transparent Google events (`showAs === 'free'`), use an unfilled theme-aware surface and dashed category border. Free styling takes precedence over source styling; do not assume tentative means free.
- Cornerstone appointments retain category fill and a 3px category left border. Google events use a theme-aware surface with a neutral border and “{time range} · Google” subtitle, preserving calendar attribution in accessible details.
- Build deterministic overlap clusters across appointments and timed external events together. Sort by start/end/stable source-qualified ID; use half-open intervals [start, end), so adjacent events do not conflict. Assign stable lanes and consistent widths/offsets per cluster, leaving small gutters.
- BLOCK holds remain noninteractive background shading, not event lanes. All-day events remain in the header. Preserve existing early/late grid expansion. Split/clip multi-day timed events to the displayed day's boundaries correctly.
- Account for minimum rendered card height so adjacent short events do not visually obscure each other. Timed cards must not cover another timed card. Narrow lanes may truncate text, but retain an accessible way to inspect full details.
- In today's visible column, show a theme-token now line, dot, and gutter time label. Show no line outside the grid bounds. Keep the overlay noninteractive and avoid obscuring hour labels.
- Past means end time has passed, not start time. Use subdued surfaces/borders while preserving text contrast; do not apply 55% opacity to the whole card if it fails contrast.
- For 30-minute cards, keep title and time compact on one line. Show the matter chip only when rendered height is at least 70px. Preserve full labels in accessible details.

Acceptance: simultaneous, nested, chained, adjacent, very short, and multi-day events remain reachable without card collisions; all-day/header/block behavior and expanded grid bounds remain intact; now line is correct and updates without navigation.

## 4. Day load and Next up (1c)

- Fetch workload for the entire displayed week in Day and Week, rather than only when entering Plan. The current Plan endpoint returns ten working days; adapt or add a range-aware authenticated workload read that covers all seven displayed dates without changing Plan's existing contract unnecessarily.
- Reuse Plan's aggregation and firm target source. Load utilization and over-target status compare `clientMinutes + internalMinutes` with `targetMinutes`. Show client minutes and scheduled appointment count separately, e.g. “3h client · 3 appts”; make total load accessible. Do not substitute presentation-filtered event counts for authoritative workload.
- Under each Week header, show a 4px utilization bar. Cap the visual fill at 100%; show an amber over-target label using existing tokens. Missing workload hides the bar and reports unavailable state; zero target must not divide by zero or imply normal capacity.
- Replace the Week day panel with a responsive Next up panel for the selected day. Make day headers keyboard-accessible selection controls and mark the selected day.
- Fetch attention and availability in Week as well as Day; retain date-scoped dismissals and prevent stale selected-day results.
- Next up prioritizes an in-progress scheduled meeting, then the earliest upcoming scheduled meeting on the selected day. Today shows countdown/in-progress state; other dates show their date/time, not a misleading live countdown. Past days show historical state; days without a next meeting show an explicit empty state.
- Show authoritative prep status and supported Prep pack, Join, or Open matter actions. Respect externally managed restrictions and missing matter/join links. Reuse existing detail/prep flows.
- Include the same attention data/actions used by AttentionBand, later events, and verified open slots with Quick book actions. Use “Later today” only for today; otherwise use a date-appropriate label. Display availability failures separately from “no available slots.”

Acceptance: workload matches Plan for identical dates/data, including internal work; weekend/missing/zero-target handling is explicit; Week selection refreshes attention/slots; empty and past-day panels remain useful.

## 5. Day agenda improvements (2a)

- Add seven day cards above the agenda: weekday, date, shared workload bar, client minutes, and scheduled appointment count. Fetch complete week summary data independently of the selected-day event range. Use distinct, accessible today and selected states; clicking updates anchor and selected day together.
- Summary: separate appointments and external calendar events; define booked time as the union of busy intervals clipped to working hours, avoiding double-counting overlaps. Report remaining open time for today, full-day open time for a future date, and historical wording for a past date. Labels must make these definitions clear.
- Calculate gaps from effective working-hour intervals, date overrides, and authoritative busy data, including blocking calendars hidden from display. Merge busy intervals, clip to hours, handle all-day blocks, and ignore free events. Today starts at now; split working-hour intervals must remain separate. Do not sum overlapping availability-slot candidates as open time.
- Insert chronologically placed dashed gap rows for intervals at least 30 minutes long. Example: “Open · 12:00–2:00 PM · 2h.” Gap rows describe free time; Book opens Quick book at a candidate start and revalidates the chosen type, format, duration, and buffers through the existing availability flow. If authoritative availability/hours cannot be obtained, do not fabricate gap rows.
- Remove Open time today from the side panel once inline gap functionality is verified. Keep Dates this week and Follow-ups owed.
- Show the now divider only on today. Keep ongoing events distinguishable from completed ones, place the marker at the appropriate chronological boundary, and show the next attendee/countdown only when a future scheduled meeting exists.
- Remove category strip headers; use a compact category pill beside the matter chip. Remove Busy pills and the unconditional calendar-synced line.
- Show exceptions: actual overlaps, unsynced eligible appointments, and authoritative prep pending reasons. Use “Not synced to Google Calendar. External bookings may not reflect this appointment.” Offer Retry sync only through the supported idempotent action; display pending/error/success and refresh state.
- Footer status must reflect lifecycle and prep state accurately. Do not label no-show, cancelled, or rescheduled records as meeting complete just because they are in the past. Actions align right; Join is primary when applicable. Preserve existing reschedule and after-meeting actions.
- Google events become compact rows: title, time/all-day label, “Google · {calendar}” or a generic fallback, and an actual overlap note when applicable. Preserve access to full details.

Acceptance: gaps respect busy calendars even when filtered/hidden, buffers and booking validation remain enforced, summaries avoid double-counting, now markers/countdowns update, and prep/sync/lifecycle labels are truthful.

## Verification and completion

- Add meaningful unit tests for preference/date resolution, deterministic lane placement, clipped/merged busy intervals and gaps, and shared workload presentation.
- Cover malformed/unavailable storage; linked dates and Back/Forward; filtered busy events; transparent events; all-day and multi-day blocks; adjacent/nested/chained overlaps; minimum card heights; timezone/DST changes; split working hours and date overrides; unavailable/truncated calendars; zero/missing targets; selected-day request races; and status/action eligibility.
- Extend relevant existing calendar tests, including visibility, day color coding, grid bounds, workload/productivity, and mapping/deduplication tests. Update assertions intentionally changed by the new design while preserving their behavioral coverage.
- Run `npm run lint`, `npm run typecheck`, and `npm test`. Distinguish existing failures from regressions using a clean-checkout comparison where necessary.
- Verify browser flows on a crowded week, Day gaps/Quick book, date/view navigation, source/category filters, attention dismissals, and supported prep/sync actions. Check narrow screens, keyboard-only interaction, both themes, and 4.5:1 contrast for normal text, including subdued past events. Apply appropriate contrast and focus requirements to controls and indicators.
- If local services or the visual reference are unavailable, report exactly which runtime/design checks remain unverified. Do not claim browser verification from static inspection.
- Finish with the implemented behavior, verification results, and material limitations. Do not deploy or claim production completion without the requested deployment scope and evidence.
