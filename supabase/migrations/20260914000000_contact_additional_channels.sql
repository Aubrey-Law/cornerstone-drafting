-- Cornerstone — additional emails and phone numbers for a person.
--
-- `client_intake.email/phone` and `contacts.email/phone` hold exactly one of
-- each, so a client with a work address alongside a personal one, or a spouse
-- reachable on a mobile and a landline, had nowhere to record the second. The
-- firm's answer until now was to bury it in qualification notes, where no
-- composer, template or reminder can find it.
--
-- Shape: a JSONB array of {"label": "...", "value": "..."} objects, held to
-- that shape by a check constraint rather than a side table. Two reasons:
--
--   • These are attributes of one person, always read with the row and never
--     queried on their own — a join table would buy nothing and cost a read on
--     every contact panel and every compose-context call.
--   • The primary email/phone keep their own columns. Everything that already
--     reads `email` keeps working untouched; only surfaces that opt in see the
--     extras. Nothing here changes which address a send defaults to.
--
-- Normalization (trimming, de-duplication against the primary, the 6-entry cap,
-- phone formatting) lives in lib/contacts/additionalChannels.ts, which every
-- writer goes through. The constraint below is the floor, not the policy: it
-- rejects a shape the readers could not parse, and leaves judgement to the app.

create or replace function public.is_contact_channel_list(value jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    jsonb_typeof(value) = 'array'
    and jsonb_array_length(value) <= 6
    and not exists (
      select 1
      from jsonb_array_elements(value) as entry
      where jsonb_typeof(entry) <> 'object'
        or jsonb_typeof(entry -> 'value') <> 'string'
        or coalesce(entry ->> 'value', '') = ''
        or (entry ? 'label' and jsonb_typeof(entry -> 'label') <> 'string')
    );
$$;

comment on function public.is_contact_channel_list(jsonb) is
  'True when the value is an array (max 6) of {label?: string, value: string} objects with a non-empty value.';

alter table public.client_intake
  add column if not exists additional_emails jsonb not null default '[]'::jsonb,
  add column if not exists additional_phones jsonb not null default '[]'::jsonb;

alter table public.contacts
  add column if not exists additional_emails jsonb not null default '[]'::jsonb,
  add column if not exists additional_phones jsonb not null default '[]'::jsonb;

comment on column public.client_intake.additional_emails is
  'Secondary email addresses for the client, beyond client_intake.email.';
comment on column public.client_intake.additional_phones is
  'Secondary phone numbers for the client, beyond client_intake.phone.';
comment on column public.contacts.additional_emails is
  'Secondary email addresses for this contact, beyond contacts.email.';
comment on column public.contacts.additional_phones is
  'Secondary phone numbers for this contact, beyond contacts.phone.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_intake_additional_emails_shape'
  ) then
    alter table public.client_intake
      add constraint client_intake_additional_emails_shape
      check (public.is_contact_channel_list(additional_emails));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'client_intake_additional_phones_shape'
  ) then
    alter table public.client_intake
      add constraint client_intake_additional_phones_shape
      check (public.is_contact_channel_list(additional_phones));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'contacts_additional_emails_shape'
  ) then
    alter table public.contacts
      add constraint contacts_additional_emails_shape
      check (public.is_contact_channel_list(additional_emails));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'contacts_additional_phones_shape'
  ) then
    alter table public.contacts
      add constraint contacts_additional_phones_shape
      check (public.is_contact_channel_list(additional_phones));
  end if;
end
$$;

notify pgrst, 'reload schema';
