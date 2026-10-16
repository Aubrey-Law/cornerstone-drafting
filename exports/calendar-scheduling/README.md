# Calendar & appointment scheduling — extracted from Cornerstone

This folder holds Cornerstone's native scheduling system, copied out so a
different Next.js app can adopt it. Give `PROMPT.md` to the coding agent
working in the new app. It walks through installing this code.

| Item | Contents |
|---|---|
| `PROMPT.md` | The prompt to paste into Claude Code (or another agent) in the new app |
| `schema.sql` | One migration that creates every table, constraint and function the code needs |
| `source/` | ~180 files, ~21k lines. Paths match a Next.js App Router root with the `@/*` alias |
| `source/tests/` | 31 test files (238 tests) that run against this bundle |

## What it does

- **Public booking page** at `/book/[slug]`. Anyone can book a public appointment type there. It has a slot picker, first/last name, an optional second attendee, custom booking questions, and a choice of phone, video or in-person.
- **Client portal booking** at `/schedule`, for logged-in clients. It can offer non-public types.
- **Self-service manage link** at `/book/manage/[token]`. The booker can reschedule or cancel from it. The link is hashed and expires.
- **Availability engine** (`lib/appointments/availability.ts`). It combines weekly hours, per-type hours, date overrides, minimum notice, booking horizon and buffers, then subtracts busy time. Busy time comes from Google Calendar `freeBusy` on the primary calendar plus any selected blocking calendars, and from existing appointments.
- **Double-booking guard.** Before inserting, the code re-checks the slot against fresh busy data. A Postgres `EXCLUDE USING gist` constraint is the final guard against races. Staff can override it on purpose (`raw.staffOverlapConfirmed`).
- **Google Calendar sync.** Each booking creates, moves or deletes a Google event, with a Google Meet link for video meetings. A reconcile pass corrects any drift.
- **Microsoft Teams links (optional).** When Microsoft is connected, a video booking can get a Teams link through Graph instead of Meet.
- **Emails.** The booker gets a confirmation (with the manage link) and a reschedule or cancel notice. The firm gets an alert. An hourly cron sends reminders (`/api/cron/appointment-reminders`).
- **Admin calendar** at `/admin/calendar`, with month, week and day views. It shows Google events and appointments together, with category colors. It also has quick-book from an empty slot, drag/resize, a calendar-visibility popover, an open-gaps rail and a workload indicator.
- **Admin settings** (`SchedulingSettingsSection`). Staff edit hours, date overrides, notice, horizon, buffer and reminders, and pause booking. They also edit appointment types and their questions, pick which Google calendars block booking or are hidden, and connect Google or Microsoft.
- **Staff tools.** `ScheduleAppointmentDialog` books on someone's behalf with an overridable conflict or outside-hours warning. `SendSchedulingLinkDialog` sends a prefilled booking link by email or SMS.

## How the pieces connect

```
/book/[slug], /schedule ──► components/scheduling/BookingWidget + SlotPicker
        │  GET /api/scheduling/types, /api/scheduling/availability
        │  POST /api/scheduling/book        (rate-limited: lib/appointments/publicRouteGuard)
        ▼
lib/appointments/book.ts  bookAppointment / rescheduleAppointment / cancelAppointment / markNoShow
   ├─ availability.ts + calendarBusy.ts ──► googleCalendar.ts (freeBusy)
   ├─ insert appointments row (exclusion constraint)
   ├─ calendarSync.ts → googleEvents.ts (event + Meet) | teamsMeeting.ts → microsoftTeams.ts
   ├─ confirmationEmail.ts → lib/email/send.ts
   ├─ CRM hooks  ◄── Cornerstone-specific (see "Seams" below)
   └─ automation.ts runPostBookingAutomation  ◄── Cornerstone-specific

/admin/calendar ──► CalendarClient
   GET /api/admin/scheduling/calendar-events   (Google events + appointments)
   GET /api/admin/scheduling/slots, /api/admin/calendar/availability
   POST/PATCH /api/admin/scheduling/appointments   (staff book/move/cancel/no-show)
   GET /api/admin/calendar/plan?workload=1        (week workload bar)

Settings ──► GET/PUT /api/admin/scheduling/settings, GET /api/admin/scheduling/calendars
OAuth    ──► /api/admin/google/{connect,callback,status}, /api/admin/microsoft/{…}
Cron     ──► /api/cron/appointment-reminders → reminders.ts   (hourly, Bearer CRON_SECRET)
```

## Seams: what was Cornerstone-specific

The bundle typechecks and its tests pass, but some features still assume
Cornerstone's law-firm data model. They come in three kinds.

### 1. Stub files (`// HOST ADAPTER (stub)` at the top)

These modules are no-ops at the same import paths, so the core code compiles.
Swap each one for the new app's real equivalent, or leave it as a no-op.

| Stub | What Cornerstone did there |
|---|---|
| `lib/calcom/link.ts` | Linked a booking to an existing lead or client by attendee email (`findLeadByEmail`, `findMatterIdByEmail`). **This is the main one to wire to the new app's customer table.** |
| `lib/email/send.ts` | Full sender (stored templates, Gmail-as-staff, send log). Replaced here with a minimal Resend sender of the same shape |
| `lib/intake/getOrCreateClientIntake.ts` | Gave the portal `/schedule` page the logged-in client's record, for prefill and linking |
| `lib/contacts/loadSpouseContact.ts` | Prefilled the second attendee (spouse) |
| `lib/intake/standingLinks.ts` | Created an intake-questionnaire link for each new lead |
| `lib/bookings/discoveryAnchor.ts`, `pmpsAnchor.ts` | Recorded booking dates on the lead or matter to start service-level (SLA) deadline tracking |
| `lib/stage-engine/fireStageTasks.ts`, `types/database.ts` | Moved a matter to the next stage on certain bookings and created that stage's tasks |
| `lib/signing/delegateKit.ts` | Prepared a signing kit when a signing appointment was booked |
| `lib/integrations/lawmatics/jobs.ts` | Mirrored appointments to Lawmatics |
| `lib/conflicts/server.ts` | Ran a conflict-of-interest check on new leads |
| `lib/actions/*` | Approval system for outgoing actions. The stub makes confirmations send immediately, which is the intended default |
| `lib/automations/control.ts` | Cron kill-switch and run log. Only the `CRON_SECRET` check is kept |
| `lib/calendarAttention.ts` | "Needs attention" items for each day, built from matter data. Returns nothing |
| `lib/work/calendarPlan.ts` | Type for the daily work plan (Plan view). Plan route returns an empty plan |
| `lib/portalNotifications.ts`, `lib/communications/config.ts` | Portal message notice; SMS on/off (returns off) |
| `lib/clientFonts.ts`, `components/ClientErrorState.tsx` | Brand fonts; error screen |
| `types/supabase.ts` | Generated DB types → `Database = any` until regenerated |

### 2. Direct queries to Cornerstone tables inside copied files

These still query tables that won't exist in the new app. At runtime they fail
quietly (most are inside try/catch) or throw. Change them to use the new app's
tables:

| File | Tables it queries | Purpose |
|---|---|---|
| `lib/appointments/book.ts` → `createLeadFromAppointment`, `recordActivity`, link step | `client_intake`, `lead_activity`, `matter_notes`, `matter_details` | Create a lead when a stranger books; add an activity entry for each booking |
| `lib/appointments/automation.ts` | `client_intake`, `lead_activity`, `matters`, `matter_activity` | Post-booking automations (intake invite, stage advance) |
| `lib/appointments/externalCorrection.ts` | `external_bookings`, `lead_activity`, `matter_*` | Staff edits to bookings imported from Calendly, Cal.com or Lawmatics. Drop this if unused |
| `lib/appointments/bookingAttendee.ts` | `client_intake`, `matters`, `contacts` | Prefill the staff booking form from a record |
| `app/api/admin/scheduling/appointments/route.ts` | `matters`, `v_matter_pipeline` | Show the linked record's name on the admin calendar |
| `app/api/admin/calendar/people/route.ts` | `client_intake`, `v_matter_pipeline` | People search in quick-book |
| `app/api/admin/scheduling-links/send/route.ts` | `client_intake`, `v_matter_pipeline`, `messages`, `*_activity` | Send-a-booking-link dialog |

The `appointments.linked_lead_id` / `linked_matter_id` columns are plain
uuids in `schema.sql`. Use them for the new app's own record ids (for
example, a customer and a project), or rename them.

### 3. Trimmed files (marked `// EXTRACTED:`)

- `app/api/admin/calendar/plan/route.ts` keeps the Google/appointment workload calculation. It drops tasks and the work graph and returns an empty `today` plan. The Plan tab still renders.
- `app/api/admin/calendar/events/[id]/route.ts` keeps the appointment and its attendees. It drops the matter panel (stage, estate-tax estimate, tasks, documents).

## Branding and firm-specific values to change

- `lib/firmConfig.ts` / `lib/firmSettings.ts`: name, phone, address and email. They come from `firm_settings` or the `NEXT_PUBLIC_FIRM_*` env vars. The env-var fallbacks still default to "Aubrey Law" / Scott Aubrey.
- Hard-coded "Aubrey Law" text and contact details: `lib/appointments/confirmationEmail.ts` (`FIRM` block), `lib/appointments/googleEvents.ts` (event description), `components/scheduling/BookingWidget.tsx` and `app/book/manage/[token]/ManageBookingClient.tsx` (default `firmName` prop), and `lib/auth/ensureUserProfile.ts` (`FIRM_EMAIL_DOMAIN`, the staff email domain). Run `grep -rniE "aubrey" source/` to find every one.
- `lib/scheduling.ts`: Cal.com URLs for `aubreylaw`, used only as an external-link fallback.
- `lib/firmDate.ts` / `lib/utils.ts`: `FIRM_TIMEZONE = 'America/New_York'`. The booking engine uses `scheduling_settings.timezone`; the admin calendar uses this constant in places.
- The roles `'attorney' | 'admin'`, in `lib/apiAuth.ts` and the RLS policies.
- The `appointment_types` seed rows in `schema.sql`.
- Wording and colors in `confirmationEmail.ts` and `emailFormat.ts`.

## Environment variables

| Var | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Everything |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` | Google Calendar (redirect → `/api/admin/google/callback`) |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`, `MICROSOFT_TENANT_ID` | Optional Teams links (redirect → `/api/admin/microsoft/callback`) |
| `RESEND_API_KEY`, `RESEND_FROM` | Emails (without them, sends are skipped and logged) |
| `CRON_SECRET` | Reminder cron |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_PORTAL_URL` | Absolute links in emails (`lib/urls.ts`) |
| `ADMIN_EMAIL` | Address for the firm's new-booking alert |
| `NEXT_PUBLIC_FIRM_NAME`, `_PHONE`, `_EMAIL`, `_CITY`, `_ATTORNEY_NAME`, `_ATTORNEY_SHORT_NAME` | Branding fallback |

The Google OAuth request (`lib/googleCalendar.ts` `SCOPES`) also asks for
`gmail.send` and `gmail.modify`, because Cornerstone sends email as the
attorney. Remove those two scopes if the new app doesn't need them.

Cron (Vercel): `{ "path": "/api/cron/appointment-reminders", "schedule": "0 * * * *" }`.

## npm dependencies

```
next@^16  react@19  react-dom@19  @supabase/supabase-js@^2.100  @supabase/ssr@^0.9
resend@^6  sonner@^1.7  lucide-react@^0.564  server-only  zod@^3.25
@radix-ui/react-dialog@1.1.15  @radix-ui/react-label@2.1.8  @radix-ui/react-popover@1.1.15
@radix-ui/react-slot@1.2.4  class-variance-authority@^0.7  clsx@^2  tailwind-merge@^3
dev: vitest@^4  @testing-library/react@^16  jsdom  typescript@5.7
```

Styling uses Tailwind with shadcn-style theme tokens (`bg-background`,
`text-muted-foreground`, `border-border`, …), plus the custom font sizes
`text-micro` and `text-compact`. Map these to the new app's theme.

## Verification done before export

- `tsc --noEmit` on `source/` alone (with its own `tsconfig.json`): **0 errors**.
- `vitest run` in `source/`: **31 files, 238 passed, 2 skipped**. The 2 skipped tests depend on stubbed features (intake invite, spouse prefill) and say so.
- `schema.sql` was applied to a clean Postgres 16 with a stub `auth` schema. Checks: an overlapping booking is rejected; a staff-confirmed overlap is allowed; `rate_limit_consume` counts.
- **Not verified:** running the app end to end, live Google or Microsoft OAuth, and email delivery. These need the new app's credentials.
