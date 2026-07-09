-- Cornerstone Lite — matter_details columns used by matter create + setup blockers
-- The drafting baseline created a minimal matter_details table; the lite app writes more fields.

ALTER TABLE public.matter_details
  ADD COLUMN IF NOT EXISTS matter_number text,
  ADD COLUMN IF NOT EXISTS plan_type text,
  ADD COLUMN IF NOT EXISTS matter_status text,
  ADD COLUMN IF NOT EXISTS jurisdiction_state text DEFAULT 'MA',
  ADD COLUMN IF NOT EXISTS jurisdiction_county text,
  ADD COLUMN IF NOT EXISTS responsible_attorney text,
  ADD COLUMN IF NOT EXISTS co_counsel text,
  ADD COLUMN IF NOT EXISTS paralegal_assigned text,
  ADD COLUMN IF NOT EXISTS legal_plan text,
  ADD COLUMN IF NOT EXISTS legal_plan_id text,
  ADD COLUMN IF NOT EXISTS legal_plan_type text,
  ADD COLUMN IF NOT EXISTS target_close_date date,
  ADD COLUMN IF NOT EXISTS closed_date date,
  ADD COLUMN IF NOT EXISTS scheduled_signing_date date,
  ADD COLUMN IF NOT EXISTS signing_date date,
  ADD COLUMN IF NOT EXISTS documents_filed_date date,
  ADD COLUMN IF NOT EXISTS est_estate_value numeric,
  ADD COLUMN IF NOT EXISTS tax_exposure text,
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS matter_status_notes text;

-- Probate setup blockers (matter create for Probate practice area)
ALTER TABLE public.matter_details
  ADD COLUMN IF NOT EXISTS pb_decedent_name text,
  ADD COLUMN IF NOT EXISTS pb_court_name text,
  ADD COLUMN IF NOT EXISTS pb_probate_type text;

NOTIFY pgrst, 'reload schema';
