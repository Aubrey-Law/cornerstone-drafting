-- Canonical ownership for participant composition and citizenship.
--
-- Existing records remain nullable until an attorney confirms the legal fact.
-- The conservative citizenship backfill deliberately distinguishes a known
-- non-US answer from a specific immigration status that intake never asked.

alter table public.matters
  add column if not exists matter_type text;

alter table public.matters
  drop constraint if exists matters_matter_type_check;

alter table public.matters
  add constraint matters_matter_type_check
  check (matter_type is null or matter_type in ('individual', 'couple'));

comment on column public.matters.matter_type is
  'Attorney-confirmed participant composition: individual or couple. Independent of marital status.';

alter table public.client_intake
  add column if not exists citizenship_status text;

alter table public.contacts
  add column if not exists citizenship_status text;

alter table public.client_intake
  drop constraint if exists client_intake_citizenship_status_check;

alter table public.client_intake
  add constraint client_intake_citizenship_status_check
  check (
    citizenship_status is null
    or citizenship_status in (
      'unknown',
      'us_citizen',
      'permanent_resident',
      'nonresident_alien',
      'non_us_unspecified',
      'other'
    )
  );

alter table public.contacts
  drop constraint if exists contacts_citizenship_status_check;

alter table public.contacts
  add constraint contacts_citizenship_status_check
  check (
    citizenship_status is null
    or citizenship_status in (
      'unknown',
      'us_citizen',
      'permanent_resident',
      'nonresident_alien',
      'non_us_unspecified',
      'other'
    )
  );

update public.client_intake
set citizenship_status = case
  when is_us_citizen is true then 'us_citizen'
  when is_us_citizen is false then 'non_us_unspecified'
  else 'unknown'
end
where citizenship_status is null;

update public.contacts
set citizenship_status = case
  when is_us_citizen is true then 'us_citizen'
  when is_us_citizen is false then 'non_us_unspecified'
  else 'unknown'
end
where citizenship_status is null;

comment on column public.client_intake.citizenship_status is
  'Canonical citizenship/immigration-status answer. is_us_citizen is retained temporarily for compatibility.';

comment on column public.contacts.citizenship_status is
  'Canonical citizenship/immigration-status answer. is_us_citizen is retained temporarily for compatibility.';
