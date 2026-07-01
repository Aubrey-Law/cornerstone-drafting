-- Lead-scoped documents (pre-conversion). Stored in R2 under leads/{lead_id}/...

CREATE TABLE IF NOT EXISTS public.lead_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  size          BIGINT NOT NULL DEFAULT 0,
  content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
  uploaded_by   UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_documents_lead
  ON public.lead_documents(lead_id, created_at DESC);

ALTER TABLE public.lead_documents ENABLE ROW LEVEL SECURITY;
