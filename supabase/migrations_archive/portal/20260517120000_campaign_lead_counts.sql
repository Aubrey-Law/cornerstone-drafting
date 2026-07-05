-- Denormalized lead counts per campaign (maintained by trigger on public.leads).

ALTER TABLE public.lead_campaigns
  ADD COLUMN IF NOT EXISTS total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hired integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.lead_campaigns.total IS
  'Count of non-archived leads tagged with this campaign.';
COMMENT ON COLUMN public.lead_campaigns.hired IS
  'Count of non-archived leads with status hired for this campaign.';

CREATE OR REPLACE FUNCTION public.sync_campaign_lead_counts(p_campaign_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.lead_campaigns
  SET
    total = (
      SELECT count(*)::integer
      FROM public.leads l
      WHERE l.campaign_id = p_campaign_id
        AND l.deleted_at IS NULL
    ),
    hired = (
      SELECT count(*)::integer
      FROM public.leads l
      WHERE l.campaign_id = p_campaign_id
        AND l.status = 'hired'
        AND l.deleted_at IS NULL
    )
  WHERE id = p_campaign_id;
$$;

CREATE OR REPLACE FUNCTION public.trg_leads_sync_campaign_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.campaign_id IS NOT NULL THEN
      PERFORM public.sync_campaign_lead_counts(OLD.campaign_id);
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.campaign_id IS DISTINCT FROM NEW.campaign_id AND OLD.campaign_id IS NOT NULL THEN
      PERFORM public.sync_campaign_lead_counts(OLD.campaign_id);
    END IF;
  END IF;

  IF NEW.campaign_id IS NOT NULL THEN
    PERFORM public.sync_campaign_lead_counts(NEW.campaign_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_campaign_counts ON public.leads;
CREATE TRIGGER trg_leads_campaign_counts
  AFTER INSERT OR UPDATE OF campaign_id, status, deleted_at OR DELETE
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_leads_sync_campaign_counts();

-- Backfill existing campaigns
UPDATE public.lead_campaigns lc
SET
  total = COALESCE((
    SELECT count(*)::integer
    FROM public.leads l
    WHERE l.campaign_id = lc.id AND l.deleted_at IS NULL
  ), 0),
  hired = COALESCE((
    SELECT count(*)::integer
    FROM public.leads l
    WHERE l.campaign_id = lc.id AND l.status = 'hired' AND l.deleted_at IS NULL
  ), 0);
