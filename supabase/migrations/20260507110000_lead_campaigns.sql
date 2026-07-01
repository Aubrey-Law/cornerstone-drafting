-- Lead campaigns: a small admin-managed list used to tag leads by marketing
-- campaign (e.g., "Spring 2026 Webinar", "Estate Planning Awareness Month").
-- The existing leads.source_channel column stays as the high-level source
-- (website / referral / etc.) — UI labels rename "Channel" → "Source", and
-- this table provides the new "Campaign" sub-classification.

CREATE TABLE IF NOT EXISTS public.lead_campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.lead_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_campaign_id
  ON public.leads (campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE public.lead_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attorney_manage_lead_campaigns" ON public.lead_campaigns;
CREATE POLICY "attorney_manage_lead_campaigns" ON public.lead_campaigns
  FOR ALL TO authenticated
  USING (is_attorney_or_staff()) WITH CHECK (is_attorney_or_staff());

COMMENT ON TABLE public.lead_campaigns IS
  'Admin-managed marketing campaigns used to classify leads. Mirrors the referral_sources pattern.';
