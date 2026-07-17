-- Isolated binary artifacts produced by Cornerstone workflow runs.
CREATE TABLE IF NOT EXISTS public.work_run_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.work_runs(id) ON DELETE CASCADE,
  artifact_kind text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  r2_key text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  promotion_status text NOT NULL DEFAULT 'pending'
    CHECK (promotion_status IN ('pending', 'promoted', 'cancelled')),
  promoted_document_id uuid REFERENCES public.matter_documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,
  UNIQUE (run_id, artifact_kind)
);

CREATE INDEX IF NOT EXISTS idx_work_run_artifacts_run ON public.work_run_artifacts(run_id, created_at);

ALTER TABLE public.work_run_artifacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_work_run_artifacts') THEN
    CREATE POLICY "admin_all_work_run_artifacts"
      ON public.work_run_artifacts FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_run_artifacts TO authenticated;
COMMENT ON TABLE public.work_run_artifacts IS 'R2-backed workflow outputs isolated until attorney confirmation.';
