-- Scanning in the executed originals.
--
-- After the signing, the executed originals are scanned and filed to the
-- matter as documents (matter_documents, kind recorded). What the scan shows
-- is proposed as the record of the execution and confirmed by the attorney,
-- because recording an execution is a claim that a document is valid. Two
-- columns tie the record to the paper:
--
--   ceremony_documents.executed_document_id  the filed scan this record describes
--   signing_ceremonies.originals_location    where the signed originals are kept
--
-- Both are nullable: a record made before the scan, or without one, is as
-- true as it was.

alter table public.ceremony_documents
  add column if not exists executed_document_id uuid
    references public.matter_documents(id) on delete set null;

comment on column public.ceremony_documents.executed_document_id is
  'The scanned, executed original filed on the matter that this record describes.';

alter table public.signing_ceremonies
  add column if not exists originals_location text;

comment on column public.signing_ceremonies.originals_location is
  'Where the signed originals are kept (the firm vault, the client, a bank box), so the file can answer the question years later.';

NOTIFY pgrst, 'reload schema';
