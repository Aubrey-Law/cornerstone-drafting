-- Cal.com bookings get the same read-only calendar mirror Calendly has: one
-- public.appointments row per Cal.com booking uid, upserted on
-- (source, external_booking_uid) by the webhook. Only the source allowlist
-- changes; appointments_no_overlap already excludes external sources, and the
-- unique constraint and index from 20260821171449 cover the new source.

alter table public.appointments
  drop constraint if exists appointments_source_check;

alter table public.appointments
  add constraint appointments_source_check
  check (source in ('public', 'portal', 'admin', 'calendly', 'calcom'));

comment on column public.appointments.external_booking_uid is
  'Provider booking id for a read-only external calendar mirror (Calendly invitee uid or Cal.com booking uid).';

notify pgrst, 'reload schema';
