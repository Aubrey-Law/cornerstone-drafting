-- Retire the Microsoft 365 calendar path. The firm runs on Google.
--
-- Safe to drop now because the legacy path is already inert: no
-- `calendar_connections` row has provider 'microsoft', so the code that read
-- this column could not reach Outlook even when it tried. Every appointment
-- carrying a `microsoft_event_id` is in the past (latest 2026-08-14), so no
-- future event is stranded by forgetting its id.

alter table public.appointments
  drop column if exists microsoft_event_id;

-- Google is the only provider that can be stored from here on. Narrowing the
-- check keeps a stale deploy or a hand-written insert from re-creating a
-- connection nothing in the app knows how to refresh.
alter table public.calendar_connections
  drop constraint if exists calendar_connections_provider_check;

alter table public.calendar_connections
  add constraint calendar_connections_provider_check
  check (provider = 'google');
