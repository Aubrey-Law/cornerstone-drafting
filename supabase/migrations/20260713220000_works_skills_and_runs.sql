-- Cornerstone Works — reusable SKILL.md workflows and attorney-reviewed runs.
-- Idempotent for the shared firm database.

CREATE TABLE IF NOT EXISTS public.work_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  skill_md text NOT NULL,
  skill_type text NOT NULL DEFAULT 'assistant'
    CHECK (skill_type IN ('assistant', 'tabular')),
  execution_mode text NOT NULL DEFAULT 'chat'
    CHECK (execution_mode IN ('chat', 'run')),
  practice text,
  jurisdictions text[] NOT NULL DEFAULT ARRAY['General']::text[],
  allowed_context text[] NOT NULL DEFAULT ARRAY['matter', 'documents']::text[],
  columns_config jsonb,
  source text NOT NULL DEFAULT 'custom'
    CHECK (source IN ('custom', 'system', 'imported')),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_skills_owner ON public.work_skills(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_skills_active ON public.work_skills(is_active, skill_type);

CREATE TABLE IF NOT EXISTS public.work_skill_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES public.work_skills(id) ON DELETE CASCADE,
  shared_with_email text NOT NULL,
  allow_edit boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, shared_with_email)
);

CREATE INDEX IF NOT EXISTS idx_work_skill_shares_email
  ON public.work_skill_shares(lower(shared_with_email));

CREATE TABLE IF NOT EXISTS public.work_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES public.work_skills(id) ON DELETE RESTRICT,
  matter_id text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  execution_mode text NOT NULL CHECK (execution_mode IN ('chat', 'run')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'running', 'completed', 'failed', 'awaiting_confirmation', 'confirmed', 'cancelled')),
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_text text,
  error_message text,
  confirmation_state text NOT NULL DEFAULT 'not_required'
    CHECK (confirmation_state IN ('not_required', 'pending', 'confirmed', 'rejected')),
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_runs_skill ON public.work_runs(skill_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_runs_matter ON public.work_runs(matter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_runs_status ON public.work_runs(status, updated_at DESC);

ALTER TABLE public.work_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_skill_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_work_skills') THEN
    CREATE POLICY "admin_all_work_skills"
      ON public.work_skills FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_work_skill_shares') THEN
    CREATE POLICY "admin_all_work_skill_shares"
      ON public.work_skill_shares FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_work_runs') THEN
    CREATE POLICY "admin_all_work_runs"
      ON public.work_runs FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_skills TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_skill_shares TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_runs TO authenticated;

COMMENT ON TABLE public.work_skills IS 'Reusable attorney-authored or system SKILL.md workflows.';
COMMENT ON TABLE public.work_runs IS 'Matter-scoped skill executions; output is isolated until attorney confirmation.';
