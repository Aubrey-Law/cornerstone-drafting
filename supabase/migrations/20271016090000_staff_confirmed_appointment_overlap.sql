-- Staff can book an appointment over another one after confirming the
-- overlap warning in Quick book. Such a row carries
-- raw.staffOverlapConfirmed = true and is left out of the overlap guard;
-- every other native booking (public, portal, and unconfirmed staff
-- bookings) keeps the database-level double-booking protection. Client
-- booking still treats the confirmed row as busy time in the app.
alter table public.appointments
  drop constraint if exists appointments_no_overlap;

alter table public.appointments
  add constraint appointments_no_overlap exclude using gist
    (tstzrange(start_time, end_time) with &&)
    where (
      status = 'scheduled'
      and source in ('public', 'portal', 'admin')
      and coalesce(raw ->> 'staffOverlapConfirmed', 'false') <> 'true'
    );
