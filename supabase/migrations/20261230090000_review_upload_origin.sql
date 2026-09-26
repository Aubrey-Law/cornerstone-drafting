-- Recording reviews run from the Word add-in.
--
-- The add-in's Review tab ran a playbook and kept nothing: findings lived in
-- the pane until it closed. It now records each review the way the workbench
-- records a review of an unfiled upload, so it appears in review history with
-- its findings, citations and dispositions.
--
-- Why an upload, not the linked matter document's version: what Word reviewed
-- is the text open in Word at that moment, which may be unsaved and differ
-- from every stored version. Each review therefore keeps its own snapshot — the
-- .docx bytes and the paragraph text layer its citations index — exactly the
-- shape `review_uploads` already gives an unfiled document. Anchoring to a
-- version instead would mean either citing text that version does not contain
-- or overwriting the version's one `plain` layer, and with it the offsets
-- every earlier review of that version cites.
--
-- Two columns tell the snapshots apart from a prior plan:
--
-- - `origin`: 'workbench' for a document uploaded to be reviewed (a prior
--   plan), 'word' for a snapshot the add-in took. Only a workbench upload is a
--   prior plan a matter's Documents tab offers to file.
-- - `source_document_id`: the Cornerstone document the Word file was opened
--   from, when the pane knows it. `on delete set null`: the snapshot and its
--   review outlive the document.
--
-- Additive only: every existing row is a workbench upload, which the default
-- says, so code that predates this needs no change to stay correct.

alter table public.review_uploads
  add column if not exists origin text not null default 'workbench';

alter table public.review_uploads
  drop constraint if exists review_uploads_origin_check;
alter table public.review_uploads
  add constraint review_uploads_origin_check check (origin = any (array['workbench', 'word']));

alter table public.review_uploads
  add column if not exists source_document_id uuid references public.matter_documents(id) on delete set null;

create index if not exists review_uploads_source_document_idx on public.review_uploads (source_document_id);
