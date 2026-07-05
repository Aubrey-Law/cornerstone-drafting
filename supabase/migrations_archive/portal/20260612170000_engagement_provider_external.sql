-- Record skill-sent engagements on engagement_agreements.
--
-- Engagement agreements are sent through two channels:
--   1. The in-app DocuSeal pipeline (app/api/admin/engagement/route.ts), which
--      already tracks full status, drives engagement_pending attention, and
--      auto-converts lead → matter via app/docuseal/callback.
--   2. A Claude Cowork skill that sends via SignWell — currently the firm's
--      MAIN channel — which is completely invisible to the app.
--
-- The SignWell columns were dropped in 20260510030000 when SignWell's own
-- webhook/client were removed. We are NOT bringing those back: the skill now
-- writes back through POST /api/admin/engagement/external, which records a
-- provider-tagged row. These columns let that row carry the SignWell document
-- id and audit link without re-introducing a SignWell integration in-app.

ALTER TABLE public.engagement_agreements
  ADD COLUMN IF NOT EXISTS provider     text NOT NULL DEFAULT 'docuseal',
  ADD COLUMN IF NOT EXISTS external_id  text,
  ADD COLUMN IF NOT EXISTS external_url text;

-- ADD COLUMN ... NOT NULL DEFAULT already backfills existing rows to
-- 'docuseal'; the explicit UPDATE makes the intent unambiguous and covers any
-- rows that somehow predate the default.
UPDATE public.engagement_agreements SET provider = 'docuseal' WHERE provider IS NULL;

ALTER TABLE public.engagement_agreements
  DROP CONSTRAINT IF EXISTS engagement_agreements_provider_check;

ALTER TABLE public.engagement_agreements
  ADD  CONSTRAINT engagement_agreements_provider_check
  CHECK (provider IN ('docuseal', 'signwell'));

-- external_id is the SignWell document id. Unique only among SignWell rows so
-- the write-back endpoint stays idempotent (re-POST returns the existing row)
-- without constraining DocuSeal rows, which leave it NULL.
CREATE UNIQUE INDEX IF NOT EXISTS engagement_agreements_signwell_external_id_idx
  ON public.engagement_agreements (external_id)
  WHERE provider = 'signwell' AND external_id IS NOT NULL;
