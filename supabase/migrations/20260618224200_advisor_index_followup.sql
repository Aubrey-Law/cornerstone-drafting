-- Safe high-value index follow-ups from Supabase performance advisor output.
-- These cover FKs used by document/call/audit/task screens and remove one
-- duplicate index reported by the advisor.

CREATE INDEX IF NOT EXISTS matter_documents_uploaded_by_idx
  ON public.matter_documents(uploaded_by)
  WHERE uploaded_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS matter_documents_reviewed_by_idx
  ON public.matter_documents(reviewed_by)
  WHERE reviewed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS lead_documents_uploaded_by_idx
  ON public.lead_documents(uploaded_by)
  WHERE uploaded_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS calls_firm_user_id_idx
  ON public.calls(firm_user_id)
  WHERE firm_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calls_assigned_by_idx
  ON public.calls(assigned_by)
  WHERE assigned_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS intake_sync_jobs_matter_id_idx
  ON public.intake_sync_jobs(matter_id)
  WHERE matter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_parent_id_idx
  ON public.tasks(parent_id)
  WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS va_task_documents_uploaded_by_idx
  ON public.va_task_documents(uploaded_by)
  WHERE uploaded_by IS NOT NULL;

DROP INDEX IF EXISTS public.idx_stage_task_template_subtasks_template;
