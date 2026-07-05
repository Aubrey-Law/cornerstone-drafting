/*
  # Lead tasks — priority, stage, subtasks, expanded status
*/

ALTER TABLE public.lead_tasks
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium';

ALTER TABLE public.lead_tasks
  DROP CONSTRAINT IF EXISTS lead_tasks_priority_check;

ALTER TABLE public.lead_tasks
  ADD CONSTRAINT lead_tasks_priority_check
  CHECK (priority IN ('low', 'medium', 'high', 'urgent'));

ALTER TABLE public.lead_tasks
  ADD COLUMN IF NOT EXISTS stage text;

ALTER TABLE public.lead_tasks
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.lead_tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_lead_tasks_parent
  ON public.lead_tasks(parent_id);

-- Expand status values (matter-aligned workflow)
ALTER TABLE public.lead_tasks
  DROP CONSTRAINT IF EXISTS lead_tasks_status_check;

ALTER TABLE public.lead_tasks
  ADD CONSTRAINT lead_tasks_status_check
  CHECK (status IN ('open', 'in_progress', 'blocked', 'done', 'cancelled'));

-- Map legacy open/done unchanged; no data migration needed

-- ─── Lead task templates ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lead_task_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_stage     text NOT NULL,
  title          text NOT NULL,
  priority       text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  default_status text NOT NULL DEFAULT 'open' CHECK (default_status IN ('open', 'in_progress', 'blocked', 'done')),
  sort_order     integer NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_task_template_subtasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.lead_task_templates(id) ON DELETE CASCADE,
  title       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_task_templates_stage_idx
  ON public.lead_task_templates(lead_stage, sort_order);

CREATE INDEX IF NOT EXISTS lead_task_template_subtasks_template_idx
  ON public.lead_task_template_subtasks(template_id, sort_order);

CREATE OR REPLACE FUNCTION set_lead_task_templates_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lead_task_templates_set_updated_at ON public.lead_task_templates;
CREATE TRIGGER lead_task_templates_set_updated_at
  BEFORE UPDATE ON public.lead_task_templates
  FOR EACH ROW
  EXECUTE FUNCTION set_lead_task_templates_updated_at();

DROP TRIGGER IF EXISTS lead_task_template_subtasks_set_updated_at ON public.lead_task_template_subtasks;
CREATE TRIGGER lead_task_template_subtasks_set_updated_at
  BEFORE UPDATE ON public.lead_task_template_subtasks
  FOR EACH ROW
  EXECUTE FUNCTION set_lead_task_templates_updated_at();

ALTER TABLE public.lead_task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_task_template_subtasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attorneys_manage_lead_task_templates ON public.lead_task_templates;
CREATE POLICY attorneys_manage_lead_task_templates
  ON public.lead_task_templates
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
    )
  );

DROP POLICY IF EXISTS attorneys_manage_lead_task_template_subtasks ON public.lead_task_template_subtasks;
CREATE POLICY attorneys_manage_lead_task_template_subtasks
  ON public.lead_task_template_subtasks
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
    )
  );

-- Seed default templates per pipeline stage
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.lead_task_templates LIMIT 1) THEN
    INSERT INTO public.lead_task_templates (lead_stage, title, priority, default_status, sort_order)
    VALUES
      ('new', 'Initial outreach call', 'high', 'open', 10),
      ('new', 'Review intake source / referral', 'medium', 'open', 20),
      ('contacted', 'Send firm overview / intake info', 'medium', 'open', 10),
      ('contacted', 'Schedule consult', 'high', 'open', 20),
      ('consult_booked', 'Send consult confirmation', 'medium', 'open', 10),
      ('consult_booked', 'Prepare consult notes', 'medium', 'open', 20),
      ('consult_held', 'Send follow-up email', 'high', 'open', 10),
      ('consult_held', 'Draft engagement letter', 'high', 'open', 20),
      ('proposal_sent', 'Follow up on proposal', 'high', 'open', 10);
  END IF;
END $$;
