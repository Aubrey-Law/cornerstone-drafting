-- Single round-trip for /admin/dashboard matter table (top N by days open).
-- Replaces v_matter_pipeline select + matters + matter_alerts + matter_activity fan-out.

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
    WHERE COALESCE(p.client_status, '') IS DISTINCT FROM 'lead'
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

REVOKE ALL ON FUNCTION public.get_admin_dashboard_matter_list(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_dashboard_matter_list(int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_matter_list(int) TO service_role;

COMMENT ON FUNCTION public.get_admin_dashboard_matter_list(int) IS
  'Admin dashboard matter table: pipeline rows with matter_number, sorted by days open desc, paginated.';
