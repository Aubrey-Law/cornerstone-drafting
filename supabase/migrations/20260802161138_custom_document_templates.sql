-- Attorney-uploaded one-off DOCX templates rendered exclusively through the
-- Quick Draft flow (never the package pipeline). Files live in the existing
-- document-template-versions bucket under custom/. RLS-locked: accessed only
-- by server-side service-role clients via authenticated app route handlers.

CREATE TABLE IF NOT EXISTS public.custom_document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  output_filename text NOT NULL CHECK (output_filename ~ '\.docx$'),
  storage_path text NOT NULL UNIQUE,
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 15728640),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- Static extraction report captured at upload time (template-variable paths
  -- and include_clause ids) so the UI can show what the template needs without
  -- re-parsing the DOCX.
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  clauses jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS custom_document_templates_active_idx
  ON public.custom_document_templates (created_at DESC)
  WHERE archived_at IS NULL;

ALTER TABLE public.custom_document_templates ENABLE ROW LEVEL SECURITY;
