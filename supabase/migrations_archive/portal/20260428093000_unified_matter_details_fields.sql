-- Fields required by the unified /admin/matters/[id] editable Details tab.
-- All columns are additive and safe to re-run.

ALTER TABLE public.matter_details
  ADD COLUMN IF NOT EXISTS billing_type text,
  ADD COLUMN IF NOT EXISTS clio_matter_number text,
  ADD COLUMN IF NOT EXISTS matter_status_notes text,
  ADD COLUMN IF NOT EXISTS iolta_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS intake_date date,
  ADD COLUMN IF NOT EXISTS hired_date date,
  ADD COLUMN IF NOT EXISTS design_meeting_date date,
  ADD COLUMN IF NOT EXISTS draft_sent_date date,
  ADD COLUMN IF NOT EXISTS drafts_approved_date date,
  ADD COLUMN IF NOT EXISTS client_review_date date,
  ADD COLUMN IF NOT EXISTS revisions_sent_date date,
  ADD COLUMN IF NOT EXISTS execution_date date,
  ADD COLUMN IF NOT EXISTS trust_type text,
  ADD COLUMN IF NOT EXISTS credit_shelter_provisions text,
  ADD COLUMN IF NOT EXISTS trust_funding_status text,
  ADD COLUMN IF NOT EXISTS deed_recorded boolean DEFAULT false;
