-- `word_addin` joins document_versions.source.
--
-- A version saved from the Word task pane was recorded as 'user_upload'. That
-- was true as far as it went — a person uploaded the file they had — but in the
-- version history it reads exactly like a document dragged into the browser,
-- and the two are not the same event: one is an attorney's own tracked changes
-- coming back out of Word, the other is a file arriving from outside the app.
-- Which surface it came from was recorded only in
-- document_access_audit.metadata, and nothing that renders version history
-- reads the audit table.
--
-- Widening a CHECK is additive: every row that satisfied the old constraint
-- satisfies this one. The constraint is dropped and recreated because Postgres
-- has no `alter constraint` for a check expression.
--
-- Existing rows are left exactly as they are. A row saying 'user_upload'
-- records a save made before this value existed, and rewriting it would put a
-- claim in the record that was not true when it was written — the same reason
-- 20261125000000_email_provider_gmail.sql left email_log.provider = 'graph'
-- alone while narrowing the configuration column.

alter table public.document_versions
  drop constraint if exists document_versions_source_check;

alter table public.document_versions
  add constraint document_versions_source_check
  check (source = any (array[
    'upload', 'generated', 'assistant_edit', 'user_upload',
    'user_accept', 'user_reject', 'converted_pdf',
    -- New: the open document, saved from the add-in's Versions tab. Distinct
    -- from user_upload on purpose — the version history should say what kind of
    -- thing happened, and "the attorney's Word session came back" is not "a
    -- file was uploaded".
    'word_addin'
  ]));

comment on column public.document_versions.source is
  'What produced these bytes: a file uploaded to the matter (upload), the '
  'document generator (generated), an assistant edit applied in the web app '
  '(assistant_edit), a file a person uploaded over an existing document '
  '(user_upload), accepting or rejecting a tracked change (user_accept, '
  'user_reject), a PDF conversion (converted_pdf), or a save from the Word '
  'add-in (word_addin).';

notify pgrst, 'reload schema';
