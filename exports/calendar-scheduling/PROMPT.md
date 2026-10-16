# Prompt: add calendar & appointment scheduling to this app

> Unzip `calendar-scheduling.zip` into this repo (for example
> `unzip calendar-scheduling.zip -d vendor/`, which gives
> `vendor/calendar-scheduling/{README.md,PROMPT.md,schema.sql,source/}`). Add
> `vendor/` to this app's tsconfig `exclude` and its lint ignores while the
> work is in progress, then paste everything below the line into
> Claude Code from this repo's root. Change the path in the first paragraph if
> you put the folder somewhere else.

---

I'm adding a complete, already-built scheduling system to this app. It was
extracted from another Next.js + Supabase app, where it runs in production.
The code is in `vendor/calendar-scheduling/`. Read
`vendor/calendar-scheduling/README.md` in full before changing anything. It
lists every file, every place the code depends on the original app, the env
vars, and what was already verified.

**The goal:** this app should have:
- public booking pages (`/book/[slug]`) with a slot picker, booking questions and a choice of meeting format;
- self-service reschedule and cancel (`/book/manage/[token]`);
- an availability engine (weekly hours, date overrides, notice, horizon and buffers, minus Google Calendar busy time);
- double-booking protection (an app-level check plus a Postgres exclusion constraint);
- Google Calendar event sync with Meet links, and optionally Teams links;
- confirmation, alert and reminder emails;
- a staff calendar (`/admin/calendar`, month, week and day views) with quick-book, drag/resize and conflict warnings;
- a scheduling settings panel, and staff "book for someone" and "send booking link" dialogs.

**Ground rules**
- Treat the copied code as a working reference. Keep its behavior. Adapt the edges (auth, data model, branding, routes) to this app, and change the core logic only when this app requires it. The core logic is `lib/appointments/availability.ts`, `book.ts`, `calendarBusy.ts`, `googleEvents.ts`, `calendarSync.ts`, `calendarReconcile.ts`, `manageTokens.ts` and `reminders.ts`.
- The bundle's paths assume a Next.js App Router root with the `@/*` alias. If this app is organized differently (`src/`, other route groups, a different `@` mapping), move the files to fit and fix the imports. Don't add a second alias just to keep the original layout.
- Use this app's existing pieces wherever they exist: Supabase clients, auth guard, UI primitives (`components/ui/*`), `cn()`, email sender, toast library and theme tokens. Use a bundle copy only when this app has nothing equivalent. If this app already has shadcn components, use those and delete the bundled `components/ui/*`.
- Every file marked `// HOST ADAPTER (stub)` and every query to a non-scheduling table (README, "Seams" sections 1–2) needs a decision. Either connect it to this app's data, or remove the code path cleanly. Don't leave a query to a table this app doesn't have.
- Keep the tests. Move `vendor/calendar-scheduling/source/tests/*` into this app's test setup, and keep them green as you adapt the code. Add tests for every host adapter you implement for real.

**Before writing code**, look through this repo and then ask me only what you can't find out yourself. Most likely:
1. **Staff vs. customers.** How does this app tell staff from customers? Is there a `users.role`, or something else? The bundle's `lib/apiAuth.ts` `requireAdmin`, `lib/auth/AuthTokenProvider.tsx` (bearer-token fetches) and the RLS policies in `schema.sql` all assume `public.users.role IN ('attorney','admin')`.
2. **Linking bookings to records.** Which table should a booking link to? The original links each booking to a "lead" and a "matter" by attendee email. Should a stranger's booking create a new record here, as the original's `createLeadFromAppointment` does, or not?
3. **Scope.** Which surfaces do I want: public booking, a logged-in customer page, the staff calendar, Teams links, SMS, the Plan tab? Drop the rest.
4. **Branding.** Business name, timezone, contact details, the appointment types (keys, labels, durations, formats) and the email look.

**Then work in this order. Commit after each step and make sure it builds:**

1. **Schema.** Turn `vendor/calendar-scheduling/schema.sql` into a migration in this app's format. Adjust roles, the `linked_*_id` columns (add FKs to this app's tables if useful) and the seeded appointment types. Skip `firm_settings` if this app already stores business settings, and read them from there instead. Apply it locally. Regenerate DB types and replace the `Database = any` stub.
2. **Infrastructure.** Supabase clients, `requireAdmin`/auth, `cn`, UI primitives, `lib/urls.ts`, `lib/firmConfig.ts`/`firmSettings.ts`, the email sender (`lib/email/send.ts`: keep the `sendEmail({ category, to, cc, replyTo, subject, html, leadId, matterId })` call shape, and implement it on this app's mailer), and the rate limiter. Point each at this app's own version.
3. **Booking engine.** Move `lib/appointments/*`, `lib/scheduling.ts`, `lib/googleCalendar.ts`, `lib/calendarConnections.ts`, `lib/microsoftTeams.ts` (if Teams is wanted) and the small helpers (`firmDate`, `calendarDay`, `calendarAvailability`, `calendarProductivity`, `clientIp`, `phone`, `bookings/prefill`, `bookings/provider`, `calendly/links`). Then handle the seams:
   - `lib/calcom/link.ts` `findLeadByEmail` / `findMatterIdByEmail` → look up this app's records by email, or always return null.
   - In `book.ts`, change `createLeadFromAppointment` and `recordActivity` so they write to this app's tables (or do nothing). Delete the discovery/PMPS anchor calls, the Lawmatics enqueue and the conflict check unless this app has an equivalent. Keep `sendConfirmationEmails`, the slot re-check and the exclusion-constraint handling exactly as they are.
   - `automation.ts` (`runPostBookingAutomation`) → keep the function as this app's "after a booking" hook. Replace its body with whatever this app should do, or nothing. Remove `types/database.ts`, `stage-engine`, `signing` and `intake/standingLinks` if they end up unused.
   - `delegateConfirmation.ts` → with the stubs in place, confirmations send directly, which is what we want. Remove the delegation layer, and call `buildAppointmentConfirmationEmail` + `sendEmail` inline.
   - Remove `externalCorrection.ts` and the `calendly` / `calcom` / `lawmatics` source values, unless I say this app imports bookings from those schedulers.
4. **Public and customer routes.** `app/api/scheduling/*`, `app/book/**`, and the customer `/schedule` page if wanted. `lib/intake/getOrCreateClientIntake.ts` → return the logged-in customer's name, email and phone from this app's data.
5. **Google and Microsoft connections.** `app/api/admin/google/*` and `app/api/admin/microsoft/*`, with `lib/auth/oauthState.ts`. Keep the state-cookie binding exactly as it is: the callback must store tokens only for the browser and staff user that started the connect, and must never take a session or bearer token from `state`. The tests in `google-oauth-callback-route.test.ts` and `oauth-state-binding.test.ts` cover this; keep them passing. `SCOPES` asks for the calendar only; add Gmail scopes only if this app sends email as the user. Make sure `lib/auth/safeRedirect.ts` and `lib/requestOrigin.ts` fit this app's domains.
6. **Staff surfaces.** `app/api/admin/scheduling/*`, `app/api/admin/calendar/*`, `app/admin/calendar/**`, the settings section (`SchedulingSettingsSection` + `WeeklyHoursEditor`, `BookingQuestionsEditor`, `BlockingCalendarsEditor`, mounted on this app's settings page), and `components/scheduling/ScheduleAppointmentDialog` / `SendSchedulingLinkDialog` wherever staff view a customer. Point `people/route.ts` and the linked-record names in `scheduling/appointments/route.ts` at this app's tables. The staff pages need `AuthTokenProvider` (or this app's equivalent) above them, because they send fetches with a bearer token. Then either remove the Plan tab, the attention band and the prep drawer's matter panel, or connect them to this app's own task data.
7. **Reminder cron.** `app/api/cron/appointment-reminders` runs hourly with `Authorization: Bearer $CRON_SECRET`. Add it to this app's scheduler (`vercel.json`/`vercel.ts` crons or equivalent).
8. **Branding pass.** Run `grep -rniE "aubrey|scott" .` across the moved code and replace every name, domain, phone number, Cal.com URL and the "Booked through the … scheduling page" text. Set `FIRM_TIMEZONE` and the `scheduling_settings.timezone` default to this app's timezone.
9. **Env vars.** Add every variable in the README's env table to `.env.example` (or this app's equivalent), with a comment for each.

**Definition of done**
- Lint, typecheck and the full test suite pass. That includes the moved scheduling tests, with the two `it.skip` host-adapter tests either re-enabled against real implementations or deleted along with the feature they cover.
- No import points to a stub that's still a no-op, unless you and I decided it should be one. `grep -rn "HOST ADAPTER" .` comes back empty or lists only those agreed no-ops.
- No query references a table this app lacks. Check by searching `.from('…')` across the moved code against this app's schema.
- Walking through it locally works. Without Google connected, availability reports "unavailable" and nothing breaks. With Google connected: book a public slot; a second booking of the same slot is rejected; reschedule and cancel from the manage link; and the event appears in, moves in and leaves Google Calendar.
- Tell me which seams you connected, which you removed, and anything you couldn't verify, such as live OAuth or email delivery.
