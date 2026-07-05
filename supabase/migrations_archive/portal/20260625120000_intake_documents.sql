-- Client intake questionnaire uploads (pre- or post-matter). Stored in R2 under
-- intakes/{client_intake_id}/... Promoted to matter_documents (folder=intake) when
-- the intake is linked to a matter.

CREATE TABLE IF NOT EXISTS public.intake_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_intake_id  UUID NOT NULL REFERENCES public.client_intake(id) ON DELETE CASCADE,
  r2_key            TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  size              BIGINT NOT NULL DEFAULT 0,
  content_type      TEXT NOT NULL DEFAULT 'application/octet-stream',
  kind              TEXT NOT NULL DEFAULT 'general',
  uploaded_by       UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_documents_intake
  ON public.intake_documents(client_intake_id, created_at DESC);

ALTER TABLE public.intake_documents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.intake_documents IS
  'Supporting documents uploaded during the client intake questionnaire.';
