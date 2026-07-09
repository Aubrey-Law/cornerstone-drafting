-- Run in Supabase SQL Editor if matter create fails with missing matter_details columns
-- (e.g. jurisdiction_state, plan_type). Safe to re-run.

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
  ADD COLUMN IF NOT EXISTS matter_status_notes text,
  ADD COLUMN IF NOT EXISTS pb_decedent_name text,
  ADD COLUMN IF NOT EXISTS pb_court_name text,
  ADD COLUMN IF NOT EXISTS pb_probate_type text;

NOTIFY pgrst, 'reload schema';

-- Optional: record migration if you applied manually (skip if `supabase db push` already did)
INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('20260713000000')
ON CONFLICT DO NOTHING;

-- Backfill matter_details for matters created before columns existed
INSERT INTO public.matter_details (
  client_id,
  practice_area,
  plan_type,
  matter_status,
  client_status,
  jurisdiction_state,
  matter_number
)
SELECT
  m.id,
  ci.practice_area,
  'TBD',
  'Active',
  'active',
  'MA',
  m.matter_number
FROM public.matters m
JOIN public.client_intake ci ON ci.id = m.client_intake_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.matter_details md WHERE md.client_id = m.id
);
