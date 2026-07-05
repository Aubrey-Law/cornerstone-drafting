-- Add 'review' to the document_access_audit.action CHECK so the attorney
-- draft-review toggle (WP3) records who signed off on a draft and when, in the
-- same audit trail as folder changes and downloads.

ALTER TABLE public.document_access_audit
  DROP CONSTRAINT IF EXISTS document_access_audit_action_check;

ALTER TABLE public.document_access_audit
  ADD CONSTRAINT document_access_audit_action_check
  CHECK (action = ANY (ARRAY['view'::text, 'download'::text, 'folder_change'::text, 'delete'::text, 'export'::text, 'review'::text]));
