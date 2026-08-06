-- Working copies for the Template Builder assistant workflow: a DOCX is
-- uploaded from the Library, revised in place by assistant tools (merge-field
-- conversion), then registered as a custom template or staged as a master
-- version. Files live in the document-template-versions bucket under builder/.
-- RLS-locked: accessed only by server-side service-role clients.

CREATE TABLE IF NOT EXISTS public.template_builder_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  original_storage_path text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 15728640),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  revision integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS template_builder_uploads_recent_idx
  ON public.template_builder_uploads (created_at DESC);

ALTER TABLE public.template_builder_uploads ENABLE ROW LEVEL SECURITY;
