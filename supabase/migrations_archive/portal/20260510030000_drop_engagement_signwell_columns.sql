-- Drop SignWell columns from engagement_agreements.
--
-- Migration 20260507150000 (DocuSeal columns) noted that SignWell columns
-- would stay during the transition and could be dropped once DocuSeal was
-- verified end-to-end. DocuSeal has been the only engagement provider since
-- PR #93, with PRs #94 and #99 hardening the path. The webhook receiver and
-- client (app/signwell/callback, lib/signwell) are also being removed in this
-- change, so nothing in the codebase reads or writes these columns anymore.

DROP INDEX IF EXISTS public.engagement_agreements_signwell_document_id_idx;

ALTER TABLE public.engagement_agreements
  DROP COLUMN IF EXISTS signwell_document_id,
  DROP COLUMN IF EXISTS signwell_status,
  DROP COLUMN IF EXISTS signwell_audit_url;
