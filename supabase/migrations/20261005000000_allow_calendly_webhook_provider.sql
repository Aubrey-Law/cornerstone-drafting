-- The payment-provider migration widened the shared webhook dedupe ledger but
-- accidentally dropped Calendly from the provider allowlist. Restore it while
-- preserving every existing telephony, calendar, and payment provider.

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
    'lawpay'::text
  ]));

comment on table public.telephony_webhook_events is
  'Shared webhook dedupe ledger for telephony, scheduling, and payment providers.';

notify pgrst, 'reload schema';
