-- Active matters should appear on /admin/matters, /admin/pipeline, and the
-- dashboard regardless of the deprecated matter_details.client_status value.
-- Older matter creation paths wrote client_status='lead', and list queries later
-- filtered those rows out, making valid active matters disappear.

UPDATE public.matter_details md
   SET client_status = 'active'
  FROM public.matters m
 WHERE md.client_id = m.id
   AND m.status = 'active'
   AND md.client_status = 'lead';

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_cards()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH pipeline AS (
    SELECT
      p.matter_id,
      p.matter_name,
      p.stage,
      p.opened_at,
      p.matter_created,
      p.next_appointment,
      p.next_appointment_type,
      GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(p.opened_at, p.matter_created))) / 86400)
      )::int AS days_open
    FROM v_matter_pipeline p
  ),
  active AS (
    SELECT *
    FROM pipeline
    WHERE stage NOT IN ('closed', 'post_execution')
  ),
  attention_rows AS (
    SELECT
      matter_id,
      matter_name,
      stage,
      days_open
    FROM active
    WHERE days_open > 14
    ORDER BY days_open DESC, matter_name ASC
    LIMIT 3
  ),
  appointment_rows AS (
    SELECT
      matter_id,
      matter_name,
      stage,
      next_appointment,
      next_appointment_type
    FROM pipeline
    WHERE next_appointment IS NOT NULL
      AND next_appointment::date >= CURRENT_DATE
      AND next_appointment::date <= CURRENT_DATE + 7
    ORDER BY next_appointment ASC
    LIMIT 5
  ),
  signing_rows AS (
    SELECT
      md.client_id AS matter_id,
      COALESCE(m.name, 'Untitled matter') AS matter_name,
      md.scheduled_signing_date
    FROM matter_details md
    LEFT JOIN matters m ON m.id = md.client_id
    WHERE md.scheduled_signing_date IS NOT NULL
      AND md.scheduled_signing_date::date >= CURRENT_DATE
    ORDER BY md.scheduled_signing_date ASC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'matter_stats', jsonb_build_object(
      'activeMatters', (SELECT count(*)::int FROM active),
      'needAttention', (SELECT count(*)::int FROM active WHERE days_open > 14),
      'upcomingSignings', (SELECT count(*)::int FROM pipeline WHERE stage = 'signing_scheduled'),
      'avgDaysOpen', COALESCE((SELECT round(avg(days_open))::int FROM active), 0)
    ),
    'attention', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'matterId', matter_id,
            'matterName', matter_name,
            'stage', stage,
            'days', days_open
          )
          ORDER BY days_open DESC
        )
        FROM attention_rows
      ),
      '[]'::jsonb
    ),
    'upcoming_appointments', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'matterId', matter_id,
            'matterName', matter_name,
            'date', next_appointment,
            'type', COALESCE(next_appointment_type, 'Appointment'),
            'isSigning', (stage = 'signing_scheduled')
          )
          ORDER BY next_appointment ASC
        )
        FROM appointment_rows
      ),
      '[]'::jsonb
    ),
    'upcoming_signings', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'matterId', matter_id,
            'matterName', matter_name,
            'date', scheduled_signing_date
          )
          ORDER BY scheduled_signing_date ASC
        )
        FROM signing_rows
      ),
      '[]'::jsonb
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_matter_list(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      p.*,
      mat.matter_number
    FROM v_matter_pipeline p
    LEFT JOIN matters mat ON mat.id = p.matter_id
  ),
  page AS (
    SELECT *
    FROM filtered
    ORDER BY COALESCE(opened_at, matter_created) ASC NULLS LAST,
             matter_created ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::int FROM filtered),
    'matters', COALESCE(
      (
        SELECT jsonb_agg(row_to_json(page)::jsonb ORDER BY COALESCE(page.opened_at, page.matter_created) ASC NULLS LAST, page.matter_created ASC)
        FROM page
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_admin_dashboard_cards() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_dashboard_cards() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_cards() TO service_role;

REVOKE ALL ON FUNCTION public.get_admin_dashboard_matter_list(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_dashboard_matter_list(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_matter_list(int) TO service_role;
