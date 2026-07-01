-- Track how a matter task was created so template checklist items can be
-- grouped separately from ad-hoc / AI-created tasks in the UI.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_source_check;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_source_check
  CHECK (source IS NULL OR source IN ('template', 'manual', 'ai'));

-- Backfill template source for tasks that match active stage templates.
UPDATE public.tasks t
SET source = 'template'
WHERE t.source IS NULL
  AND t.parent_id IS NULL
  AND t.stage IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.stage_task_templates stt
    WHERE stt.title = t.title
      AND stt.stage = t.stage
      AND stt.is_active = true
  );

CREATE INDEX IF NOT EXISTS tasks_client_source_idx
  ON public.tasks (client_id, source)
  WHERE parent_id IS NULL;
