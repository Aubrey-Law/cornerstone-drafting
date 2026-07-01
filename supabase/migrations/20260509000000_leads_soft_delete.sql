/*
  # Soft delete for leads

  Adds `deleted_at` to public.leads and excludes archived rows from
  v_leads_pipeline. UI and API treat a non-null deleted_at as archived.
*/

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_deleted_at
  ON public.leads (deleted_at)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_leads_pipeline AS
SELECT
  l.id, l.first_name, l.last_name, l.email, l.phone,
  l.status, l.status_changed_at, l.practice_area_interest,
  l.estimated_estate_value, l.urgency,
  l.source_channel, l.created_at,
  EXTRACT(DAY FROM NOW() - l.status_changed_at)::INT AS days_in_stage,
  (SELECT MAX(created_at) FROM public.lead_activity WHERE lead_id = l.id) AS last_activity_at,
  (SELECT COUNT(*) FROM public.lead_tasks
    WHERE lead_id = l.id AND status = 'open' AND due_date < CURRENT_DATE) AS overdue_task_count
FROM public.leads l
WHERE l.status NOT IN ('hired','lost')
  AND l.deleted_at IS NULL;
