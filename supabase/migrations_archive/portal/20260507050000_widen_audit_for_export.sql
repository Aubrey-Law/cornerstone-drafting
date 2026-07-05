-- Add 'export' to the document_access_audit.action CHECK so the matter
-- export endpoint can record a Mass. R.P.C. 1.16(d) file-return event.

ALTER TABLE public.document_access_audit
  DROP CONSTRAINT IF EXISTS document_access_audit_action_check;

ALTER TABLE public.document_access_audit
  ADD CONSTRAINT document_access_audit_action_check
  CHECK (action = ANY (ARRAY['view'::text, 'download'::text, 'folder_change'::text, 'delete'::text, 'export'::text]));
