-- SignWell columns on engagement_agreements.
--
-- Replaces the in-app /sign/[token] flow with SignWell-hosted e-signature.
-- The legacy signing_token column stays — older agreements created before
-- this migration still resolve via /sign/[token].

ALTER TABLE public.engagement_agreements
  ADD COLUMN IF NOT EXISTS signwell_document_id text,
  ADD COLUMN IF NOT EXISTS signwell_status      text,
  ADD COLUMN IF NOT EXISTS signwell_audit_url   text;

CREATE UNIQUE INDEX IF NOT EXISTS engagement_agreements_signwell_document_id_idx
  ON public.engagement_agreements (signwell_document_id)
  WHERE signwell_document_id IS NOT NULL;
