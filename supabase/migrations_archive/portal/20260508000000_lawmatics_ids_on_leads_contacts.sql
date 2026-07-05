-- Track Lawmatics provenance on leads and contacts so imports can de-dup.
alter table public.leads
  add column if not exists lawmatics_matter_id text;

create unique index if not exists leads_lawmatics_matter_id_key
  on public.leads(lawmatics_matter_id)
  where lawmatics_matter_id is not null;

alter table public.contacts
  add column if not exists lawmatics_contact_id text;

create unique index if not exists contacts_lawmatics_contact_id_key
  on public.contacts(lawmatics_contact_id)
  where lawmatics_contact_id is not null;
