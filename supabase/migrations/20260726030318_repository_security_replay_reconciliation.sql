-- Forward reconciliation for the hosted project after making the original
-- remediation migration independently replayable on a clean database.
alter table public.client_intake
  add column if not exists lead_status text;
