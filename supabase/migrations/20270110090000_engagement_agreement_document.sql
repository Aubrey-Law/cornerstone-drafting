-- The engagement agreement's editable Word document.
--
-- Until now the DOCX of an engagement agreement lived only inside each
-- revision's render_snapshot, so it could be downloaded but never edited and
-- brought back: estate-planning drafts are edited as matter_documents rows (the
-- in-app redline viewer, and the Word add-in's "save as version"), and the
-- agreement had no such row.
--
-- Each agreement now owns one matter_documents row that every generated
-- revision writes a new document_versions entry to. Edits made in the viewer or
-- in Word land on that row, and the workspace builds the next signing revision
-- from it. Nullable: agreements drafted before this, and any generated where R2
-- was unavailable, simply have none until their next generate.

alter table public.engagement_agreements
  add column if not exists document_id uuid references public.matter_documents(id) on delete set null;

create index if not exists engagement_agreements_document_id_idx
  on public.engagement_agreements(document_id)
  where document_id is not null;

notify pgrst, 'reload schema';
