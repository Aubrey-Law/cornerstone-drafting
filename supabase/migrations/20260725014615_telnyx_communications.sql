alter table public.sms_messages drop constraint if exists sms_messages_provider_check;
alter table public.sms_messages
  add constraint sms_messages_provider_check check (provider in ('twilio', 'telnyx'));

alter table public.calls drop constraint if exists calls_provider_check;
alter table public.calls
  add constraint calls_provider_check check (provider in ('twilio', 'telnyx', 'retell'));

create table if not exists public.telephony_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('twilio', 'telnyx', 'retell')),
  provider_event_id text not null,
  event_type text not null,
  occurred_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

alter table public.telephony_webhook_events enable row level security;
revoke all on public.telephony_webhook_events from public, anon, authenticated;
