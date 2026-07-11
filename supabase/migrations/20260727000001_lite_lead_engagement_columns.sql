-- Lead tracking on standalone client_intake rows (a lead = an intake with no
-- matter yet; matters.client_intake_id already requires an intake per matter,
-- and client_intake.matter_id is nullable).
-- Engagement e-sign state mirrors matter_details' engagement columns so a
-- lead's engagement can be sent pre-matter and converted on signing.

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS engagement_provider    text,
  ADD COLUMN IF NOT EXISTS engagement_envelope_id text,
  ADD COLUMN IF NOT EXISTS engagement_status      text,
  ADD COLUMN IF NOT EXISTS engagement_sent_at     timestamptz,
  ADD COLUMN IF NOT EXISTS engagement_signed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS engagement_fee_quoted  numeric;

CREATE UNIQUE INDEX IF NOT EXISTS client_intake_engagement_envelope_id_idx
  ON public.client_intake (engagement_envelope_id)
  WHERE engagement_envelope_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
