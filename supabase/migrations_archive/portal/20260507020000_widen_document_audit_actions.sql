-- Widen document_access_audit.action to include folder_change and delete.
-- The PATCH and DELETE handlers in app/api/documents/[id]/route.ts now write
-- audit rows for folder promotions and deletions; the prior CHECK constraint
-- (view|download only) would reject those inserts and force the routes into
-- their compensating-revert path.

ALTER TABLE public.document_access_audit
  DROP CONSTRAINT IF EXISTS document_access_audit_action_check;

ALTER TABLE public.document_access_audit
  ADD CONSTRAINT document_access_audit_action_check
  CHECK (action = ANY (ARRAY['view'::text, 'download'::text, 'folder_change'::text, 'delete'::text]));
