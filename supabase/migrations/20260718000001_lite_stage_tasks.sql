-- Cornerstone Lite — attorney stage tasks (SLA checklists)

CREATE TABLE IF NOT EXISTS public.stage_tasks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  stage_key text NOT NULL,
  stage_entered_at timestamptz NOT NULL,
  title text NOT NULL,
  task_type text NOT NULL CHECK (task_type IN ('single', 'checklist')),
  soft_due_at timestamptz,
  hard_due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'archived')),
  batch_tag text,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matter_id, stage_key, stage_entered_at)
);

CREATE INDEX IF NOT EXISTS idx_stage_tasks_open ON public.stage_tasks (status, hard_due_at)
  WHERE status = 'open';

ALTER TABLE public.stage_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attorneys_all_stage_tasks"
  ON public.stage_tasks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

NOTIFY pgrst, 'reload schema';
