-- Calendly is the source of truth for these appointments, but Cornerstone's
-- calendar renders from public.appointments. Keep one read-only mirror row per
-- Calendly invitee so created/rescheduled/cancelled webhooks update the same
-- calendar item instead of living only in external_bookings.

alter table public.appointments
  add column if not exists external_booking_uid text;

alter table public.appointments
  drop constraint if exists appointments_source_check;

alter table public.appointments
  add constraint appointments_source_check
  check (source in ('public', 'portal', 'admin', 'calendly'));

-- Null external ids remain valid for native appointments. A named constraint
-- (rather than a partial index) lets PostgREST use
-- onConflict=source,external_booking_uid for idempotent webhook upserts.
alter table public.appointments
  drop constraint if exists appointments_source_external_booking_uid_key;

alter table public.appointments
  add constraint appointments_source_external_booking_uid_key
  unique (source, external_booking_uid);

-- A Calendly booking may legitimately arrive after the same time was already
-- occupied in Cornerstone. Preserve that conflict visibly on the calendar;
-- native/public booking races still retain the database-level overlap guard.
alter table public.appointments
  drop constraint if exists appointments_no_overlap;

alter table public.appointments
  add constraint appointments_no_overlap exclude using gist
    (tstzrange(start_time, end_time) with &&)
    where (
      status = 'scheduled'
      and source in ('public', 'portal', 'admin')
    );

create index if not exists appointments_external_booking_uid_idx
  on public.appointments (external_booking_uid)
  where external_booking_uid is not null;

comment on column public.appointments.external_booking_uid is
  'Provider invitee/booking id for a read-only external calendar mirror. Currently used by Calendly.';

notify pgrst, 'reload schema';
