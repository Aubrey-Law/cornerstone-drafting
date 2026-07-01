-- supabase/migrations/20260609120000_calls.sql
--
-- Quo call logging — `calls` table, phone normalizer, and auto-assign trigger.
--
-- Notes on adaptation to this codebase:
--   * Role check goes against `public.users` (not `profiles`) — that is the
--     convention used by firm_settings, email_kill_switch, etc.
--   * There is no `public.clients` table; matter↔phone linkage runs through
--     `matters.client_intake_id` → `client_intake.phone`.
--   * `matters` has no `deleted_at`; only `leads.deleted_at` is filtered.
--   * Reuses the existing `public.set_updated_at()` from leads_initial.

-- 10-digit US phone normalizer (strips +1 country code, punctuation)
create or replace function public.normalize_us_phone(value text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  if value is null then return null; end if;
  digits := regexp_replace(value, '\D', '', 'g');
  if length(digits) = 11 and left(digits, 1) = '1' then
    return substr(digits, 2);
  end if;
  if length(digits) = 10 then
    return digits;
  end if;
  return null;
end;
$$;

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  quo_call_id text unique not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null,
  from_number text not null,
  to_number text not null,
  participant_number text not null,
  participant_digits text,
  firm_user_id uuid references auth.users(id) on delete set null,
  firm_user_email text,
  started_at timestamptz not null,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  recording_url text,
  voicemail_url text,
  transcript text,
  summary text,
  lead_id uuid references public.leads(id) on delete set null,
  matter_id uuid references public.matters(id) on delete set null,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  raw_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calls_participant_digits_idx on public.calls (participant_digits);
create index calls_started_at_idx on public.calls (started_at desc);
create index calls_lead_id_idx on public.calls (lead_id) where lead_id is not null;
create index calls_matter_id_idx on public.calls (matter_id) where matter_id is not null;
create index calls_unassigned_idx on public.calls (started_at desc)
  where lead_id is null and matter_id is null;

create or replace function public.calls_autoassign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  digits text;
  matched_lead uuid;
  matched_matter uuid;
begin
  digits := public.normalize_us_phone(new.participant_number);
  new.participant_digits := digits;

  if new.lead_id is null and new.matter_id is null and digits is not null then
    -- Prefer an existing matter whose client_intake.phone matches.
    select m.id into matched_matter
    from public.matters m
    join public.client_intake ci on ci.id = m.client_intake_id
    where public.normalize_us_phone(ci.phone) = digits
    order by m.created_at desc
    limit 1;

    if matched_matter is not null then
      new.matter_id := matched_matter;
    else
      select id into matched_lead
      from public.leads
      where deleted_at is null
        and public.normalize_us_phone(phone) = digits
      order by created_at desc
      limit 1;
      if matched_lead is not null then
        new.lead_id := matched_lead;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger calls_autoassign_trg
before insert on public.calls
for each row execute function public.calls_autoassign();

create trigger calls_updated_at_trg
before update on public.calls
for each row execute function public.set_updated_at();

alter table public.calls enable row level security;

-- Note: first migration to grant RLS access to va/staff roles (prior policies
-- gated on admin/attorney only). VAs need to triage and assign unmatched calls.
create policy calls_staff_select on public.calls
for select using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'attorney', 'va', 'staff')
  )
);

create policy calls_staff_modify on public.calls
for all using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'attorney', 'va', 'staff')
  )
) with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'attorney', 'va', 'staff')
  )
);
