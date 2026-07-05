-- Global toggle: whether outbound stored-template emails get the branded
-- AUBREY LAW wordmark header/footer wrapper. Lives on the single-row
-- firm_settings table (id = 1). Defaults ON.
alter table public.firm_settings
  add column if not exists email_logo_header boolean not null default true;
