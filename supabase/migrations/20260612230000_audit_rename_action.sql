-- Add 'rename' to the document_access_audit.action CHECK so renaming a
-- document's title is captured in the same audit trail as folder changes,
-- downloads, deletes, and review sign-offs.

ALTER TABLE public.document_access_audit
  DROP CONSTRAINT IF EXISTS document_access_audit_action_check;

ALTER TABLE public.document_access_audit
  ADD CONSTRAINT document_access_audit_action_check
  CHECK (action = ANY (ARRAY['view'::text, 'download'::text, 'folder_change'::text, 'delete'::text, 'export'::text, 'review'::text, 'rename'::text]));
