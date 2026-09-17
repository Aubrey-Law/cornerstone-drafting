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
