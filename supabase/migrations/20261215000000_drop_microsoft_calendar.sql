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
--
-- Three statements, in this order, because the column was created by
-- 20260712000000_lite_communications.sql as
--   provider text not null default 'microsoft' check (provider in ('microsoft','google'))
-- so both the default and any surviving row would violate the new check:
--
--   1. Drop the old check first — a 'microsoft' row cannot be rewritten or
--      removed while a constraint naming it is still being enforced against
--      the intermediate state.
--   2. Retarget the default. Leaving it at 'microsoft' would mean every insert
--      that omits `provider` fails the new check — the column's own default
--      violating its own constraint.
--   3. Clear any stale rows before adding the check, or `add constraint` fails
--      outright on a database that still holds one. Production holds none, so
--      this is a no-op there; it keeps the migration deterministic anywhere
--      else. The rows are unreadable regardless: nothing in the app can
--      refresh or use a Microsoft token any more.
alter table public.calendar_connections
  drop constraint if exists calendar_connections_provider_check;

alter table public.calendar_connections
  alter column provider set default 'google';

delete from public.calendar_connections where provider <> 'google';

alter table public.calendar_connections
  add constraint calendar_connections_provider_check
  check (provider = 'google');
