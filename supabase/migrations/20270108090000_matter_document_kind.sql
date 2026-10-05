-- What a generated document is, recorded when it is generated.
--
-- The signing checklist used to guess each document's kind from its filename,
-- and about a third of the live table did not classify. The generator knows
-- exactly which template it rendered, so the kind is written here at
-- generation time and the filename guess becomes the fallback for documents
-- that arrived some other way (an upload, an import).
--
-- `other` marks a generated document that is not an instrument anyone signs
-- at the table (a plan summary, funding instructions), so the signing view
-- can leave it out rather than asking the attorney to place it.

alter table public.matter_documents
  add column if not exists document_kind text
    check (document_kind is null or document_kind = any (array[
      'will', 'trust', 'dpoa', 'health_care_proxy', 'hipaa_authorization',
      'advance_directive', 'deed', 'homestead_declaration', 'certificate_of_trust',
      'assignment_of_personal_property', 'personal_property_memorandum',
      'parental_guardian_appointment', 'other'
    ]));

comment on column public.matter_documents.document_kind is
  'The execution kind the generator recorded (lib/execution/requirements.ts), or other for a document nobody signs. Null means unknown: fall back to the filename.';

NOTIFY pgrst, 'reload schema';
