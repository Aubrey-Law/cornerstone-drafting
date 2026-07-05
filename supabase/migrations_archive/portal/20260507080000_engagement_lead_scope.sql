-- Allow engagement_agreements to be created against a lead before any matter
-- exists. The pre-existing pattern was: convert lead → matter → engagement.
-- New flow: engagement is drafted/sent against the lead; matter is created
-- when the client signs. This migration makes both states valid.
--
-- A CHECK constraint requires exactly-one-of (matter_id OR lead_id) to be
-- set, so a row is always anchored to a known scope.

ALTER TABLE public.engagement_agreements
  ALTER COLUMN matter_id DROP NOT NULL;

ALTER TABLE public.engagement_agreements
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE;

-- One scope must be set; both is allowed transiently (e.g., the convert RPC
-- writes matter_id onto an existing lead-scoped row when the matter lands).
ALTER TABLE public.engagement_agreements
  DROP CONSTRAINT IF EXISTS engagement_agreements_scope_check;
ALTER TABLE public.engagement_agreements
  ADD  CONSTRAINT engagement_agreements_scope_check
  CHECK (matter_id IS NOT NULL OR lead_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_engagement_agreements_lead_status
  ON public.engagement_agreements (lead_id, status)
  WHERE lead_id IS NOT NULL;

COMMENT ON COLUMN public.engagement_agreements.lead_id IS
  'When set, this agreement was generated against a lead pre-conversion. Cleared when the lead converts and matter_id is populated.';
