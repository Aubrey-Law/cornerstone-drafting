-- Track when staff last acknowledged intake questionnaire uploads.

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS uploads_reviewed_at timestamptz;

COMMENT ON COLUMN public.client_intake.uploads_reviewed_at IS
  'When staff last opened/reviewed questionnaire uploads; uploads after this timestamp are unreviewed.';
