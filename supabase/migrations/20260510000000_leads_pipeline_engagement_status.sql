/*
  # v_leads_pipeline: include hired/lost + engagement status

  - Drops the `status NOT IN ('hired','lost')` filter so the view can serve
    all three buckets the leads page already requests (active / hired /
    lost). Soft-delete filter (`deleted_at IS NULL`) is retained.
  - Adds `converted_matter_id` so the UI can deep-link to the matter.
  - Adds `engagement_status` — the status of the most-recent
    engagement_agreement row for the lead's converted matter, or NULL when
    the lead has no matter or no agreement yet.

  Callers that previously relied on the view excluding hired/lost rows
  must now pass an explicit status filter; `fetchLeadsPipeline` is updated
  in the same PR to add an "active" default.

  Uses DROP + CREATE rather than CREATE OR REPLACE because the column
  order changes (`converted_matter_id` is inserted mid-list); Postgres
  rejects the latter with `cannot change name of view column`. No other
  views or functions depend on v_leads_pipeline.
*/

DROP VIEW IF EXISTS public.v_leads_pipeline;

CREATE VIEW public.v_leads_pipeline AS
SELECT
  l.id, l.first_name, l.last_name, l.email, l.phone,
  l.status, l.status_changed_at, l.practice_area_interest,
  l.estimated_estate_value, l.urgency,
  l.source_channel, l.created_at,
  l.converted_matter_id,
  EXTRACT(DAY FROM NOW() - l.status_changed_at)::INT AS days_in_stage,
  (SELECT MAX(created_at) FROM public.lead_activity WHERE lead_id = l.id) AS last_activity_at,
  (SELECT COUNT(*) FROM public.lead_tasks
    WHERE lead_id = l.id AND status = 'open' AND due_date < CURRENT_DATE) AS overdue_task_count,
  (SELECT ea.status FROM public.engagement_agreements ea
    WHERE ea.matter_id = l.converted_matter_id
    ORDER BY ea.created_at DESC
    LIMIT 1) AS engagement_status
FROM public.leads l
WHERE l.deleted_at IS NULL;
