-- Firm-wide contact book: allow contacts that aren't tied to a client intake
-- (referrers, professionals, and other people added from the Contacts page).
alter table public.contacts alter column client_intake_id drop not null;
