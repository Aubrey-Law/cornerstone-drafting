-- Filing a reviewed prior plan as one of its matter's documents.
--
-- 20261228090000_review_upload_matter_link.sql links an upload to a matter
-- without putting it in the matter's file. Filing is the separate, deliberate
-- step that does: the root app copies the upload's bytes to a matter document
-- key and inserts a `matter_documents` row (unshared, source 'client', since
-- the client brought it in). This column records which document that was, so
-- the same upload is not filed twice and both screens can say where it went.
--
-- A copy, not a shared key: deleting or editing the matter document must not
-- touch the bytes the upload's recorded reviews cite, and nothing that lists a
-- matter's documents may read under `review-uploads/`.
--
-- `on delete set null`: deleting the filed document makes the upload fileable
-- again rather than pointing at a row that is gone. When it was filed is the
-- document's own `created_at`; a separate stamp here would outlive the link.
--
-- Additive only: one nullable column and its index.

alter table public.review_uploads
  add column if not exists filed_document_id uuid references public.matter_documents(id) on delete set null;

create index if not exists review_uploads_filed_document_idx on public.review_uploads (filed_document_id);
