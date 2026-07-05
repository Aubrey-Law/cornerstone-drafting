-- Replace Quo-specific external id with provider-agnostic naming for Twilio call logging.

alter table public.calls rename column quo_call_id to external_call_id;

alter table public.calls
  add column if not exists provider text not null default 'twilio';

alter table public.calls
  drop constraint if exists calls_provider_check;

alter table public.calls
  add constraint calls_provider_check check (provider in ('twilio', 'quo'));

comment on column public.calls.external_call_id is
  'Provider call identifier (Twilio CallSid, legacy Quo call id).';
comment on column public.calls.provider is
  'Call logging source: twilio (current) or quo (legacy rows).';
