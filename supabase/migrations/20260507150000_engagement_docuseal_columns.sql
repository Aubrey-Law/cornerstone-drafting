-- DocuSeal columns on engagement_agreements.
--
-- We're migrating the engagement-signing pipeline from SignWell to DocuSeal
-- because DocuSeal's text-tag parsing actually works on DOCX uploads
-- (verified empirically via the DocuSeal MCP). SignWell columns stay during
-- the transition; once DocuSeal is verified end-to-end, the SignWell columns
-- can be dropped in a follow-up migration.
--
-- DocuSeal returns numeric IDs (not UUIDs), so we type these as bigint.

ALTER TABLE public.engagement_agreements
  ADD COLUMN IF NOT EXISTS docuseal_template_id   bigint,
  ADD COLUMN IF NOT EXISTS docuseal_submission_id bigint,
  ADD COLUMN IF NOT EXISTS docuseal_status        text,
  ADD COLUMN IF NOT EXISTS docuseal_audit_url     text;

CREATE UNIQUE INDEX IF NOT EXISTS engagement_agreements_docuseal_submission_id_idx
  ON public.engagement_agreements (docuseal_submission_id)
  WHERE docuseal_submission_id IS NOT NULL;
