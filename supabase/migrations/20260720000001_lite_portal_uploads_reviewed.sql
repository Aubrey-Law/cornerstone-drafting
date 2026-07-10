-- Track when staff last acknowledged client portal uploads (matter_documents folder = client).

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS portal_uploads_reviewed_at timestamptz;

COMMENT ON COLUMN public.matters.portal_uploads_reviewed_at IS
  'When staff last reviewed client portal uploads; uploads after this timestamp are unreviewed.';
