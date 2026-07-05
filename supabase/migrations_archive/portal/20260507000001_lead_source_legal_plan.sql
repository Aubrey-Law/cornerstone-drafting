-- Add 'legal_plan' to the leads.source_channel CHECK constraint.
-- Existing rows are unaffected; this is purely additive.

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_source_channel_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_source_channel_check
  CHECK (source_channel IS NULL OR source_channel IN
    ('website','referral','legal_plan','lawmatics_legacy','manual'));
