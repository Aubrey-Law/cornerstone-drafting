-- Microsoft Teams meetings on appointments.
--
-- The calendar stays on Google. Microsoft 365 comes back for one job only:
-- creating a Teams meeting whose join link is attached to the Google event, so
-- a client can be sent a Teams link instead of a Meet link.
--
-- 1. calendar_connections may hold a 'microsoft' row again. That row carries a
--    Graph token scoped to OnlineMeetings.ReadWrite, not a calendar; the
--    20261215000000 migration narrowed the check to Google-only because nothing
--    could refresh a Microsoft token then, and lib/microsoftTeams.ts now can.
-- 2. appointments record which service produced online_meeting_url, so emails
--    and the admin calendar name the right one, and the Teams meeting id, so a
--    reschedule or cancel can find the meeting again.

alter table public.calendar_connections
  drop constraint if exists calendar_connections_provider_check;

alter table public.calendar_connections
  add constraint calendar_connections_provider_check
  check (provider in ('google', 'microsoft'));

alter table public.appointments
  add column if not exists online_meeting_provider text
    check (online_meeting_provider in ('google_meet', 'microsoft_teams')),
  add column if not exists teams_meeting_id text;

-- Existing links were all produced by Google Meet.
update public.appointments
  set online_meeting_provider = 'google_meet'
  where online_meeting_url is not null
    and online_meeting_provider is null;
