-- Lawmatics bookings get the read-only calendar mirror Calendly and Cal.com
-- have. Lawmatics has no appointment webhook, so lib/integrations/lawmatics/
-- inbound.ts pulls events from its API (on a schedule, and when a booking form's
-- form-submitted webhook fires) and records each through the shared booking
-- sync. Only the provider allowlists change.

-- external_bookings: one row per Lawmatics event id.
alter table public.external_bookings
  drop constraint if exists external_bookings_provider_check;

alter table public.external_bookings
  add constraint external_bookings_provider_check
  check (provider in ('calcom', 'calendly', 'lawmatics'));

-- appointments: the calendar mirror row (source = 'lawmatics').
alter table public.appointments
  drop constraint if exists appointments_source_check;

alter table public.appointments
  add constraint appointments_source_check
  check (source in ('public', 'portal', 'admin', 'calendly', 'calcom', 'lawmatics'));

comment on column public.appointments.external_booking_uid is
  'Provider booking id for a read-only external calendar mirror (Calendly invitee uid, Cal.com booking uid, or Lawmatics event id).';

-- Shared dedupe ledger: form-submitted webhook deliveries and each observed
-- Lawmatics event state are claimed here so a change is processed once.
alter table public.telephony_webhook_events
  drop constraint if exists telephony_webhook_events_provider_check;

alter table public.telephony_webhook_events
  add constraint telephony_webhook_events_provider_check
  check (provider = any (array[
    'twilio'::text,
    'telnyx'::text,
    'retell'::text,
    'calcom'::text,
    'calendly'::text,
    'stripe'::text,
    'lawpay'::text,
    'lawmatics'::text
  ]));

notify pgrst, 'reload schema';
