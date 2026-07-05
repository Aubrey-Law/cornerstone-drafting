-- Same shape as the engagement_agreements lead-scope change: conflict
-- checks now run against a lead, before any matter exists. Existing
-- matter-scoped rows are left alone.

ALTER TABLE public.matter_conflict_checks
  ALTER COLUMN matter_id DROP NOT NULL;

ALTER TABLE public.matter_conflict_checks
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.matter_conflict_checks
  DROP CONSTRAINT IF EXISTS matter_conflict_checks_scope_check;
ALTER TABLE public.matter_conflict_checks
  ADD  CONSTRAINT matter_conflict_checks_scope_check
  CHECK (matter_id IS NOT NULL OR lead_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_matter_conflict_checks_lead_active
  ON public.matter_conflict_checks (lead_id)
  WHERE lead_id IS NOT NULL AND superseded_at IS NULL;

COMMENT ON COLUMN public.matter_conflict_checks.lead_id IS
  'Set when the conflict check was performed pre-conversion. The matter detail page reads checks via matters.lead_id for carry-over history view.';
