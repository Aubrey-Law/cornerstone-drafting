-- Add 'calcom' to the leads.source_channel CHECK constraint.
-- Cal.com-created leads should be distinguishable from manual intake.

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_source_channel_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_source_channel_check
  CHECK (source_channel IS NULL OR source_channel IN
    ('website','referral','legal_plan','calcom','lawmatics_legacy','manual'));
