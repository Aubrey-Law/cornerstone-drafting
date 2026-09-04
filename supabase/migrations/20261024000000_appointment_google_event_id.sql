-- Google Calendar event id on appointments.
--
-- Sits alongside microsoft_event_id rather than replacing it, and that is the
-- point: cancel and reschedule must go back to whichever calendar actually
-- holds the event. Routing those by the firm's *current* provider instead would
-- orphan every appointment booked before the switchover — a bug that surfaces a
-- week later as a client turning up to a meeting the attorney thought they had
-- cancelled.
--
-- Nothing is backfilled. Existing rows carry microsoft_event_id and keep routing
-- to Outlook; new bookings take whichever provider is connected.

alter table public.appointments
  add column if not exists google_event_id text;

comment on column public.appointments.google_event_id is
  'Google Calendar event id. Mutually exclusive with microsoft_event_id in practice: an appointment is created in one calendar and cancelled or moved in that same one.';

create index if not exists appointments_google_event_id_idx
  on public.appointments (google_event_id)
  where google_event_id is not null;
