-- Server-side filtering and pagination for the admin Documents page.
-- The API calls this with the service role key; keep the RPC unavailable to
-- browser Supabase clients so document metadata stays behind admin routes.

CREATE OR REPLACE FUNCTION public.get_admin_documents(
  p_search text DEFAULT NULL,
  p_folder text DEFAULT 'all',
  p_type text DEFAULT 'all',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  source text,
  matter_id uuid,
  lead_id uuid,
  matter_name text,
  client_name text,
  name text,
  size bigint,
  content_type text,
  folder text,
  uploaded_by_name text,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH unified AS (
    SELECT
      md.id,
      'matter'::text AS source,
      md.matter_id::uuid AS matter_id,
      NULL::uuid AS lead_id,
      vmp.matter_name,
      vmp.client_name,
      md.name,
      md.size::bigint AS size,
      md.content_type,
      md.folder::text AS folder,
      COALESCE(u.display_name, u.email) AS uploaded_by_name,
      md.created_at
    FROM public.matter_documents md
    LEFT JOIN public.v_matter_pipeline vmp ON vmp.matter_id::text = md.matter_id
    LEFT JOIN public.users u ON u.id = md.uploaded_by
    WHERE
      (
        COALESCE(p_folder, 'all') = 'all'
        OR (p_folder = 'with-client' AND md.folder IN ('review', 'signed', 'final'))
        OR (p_folder <> 'lead' AND p_folder <> 'with-client' AND md.folder::text = p_folder)
      )
      AND (
        COALESCE(p_type, 'all') = 'all'
        OR (p_type = 'pdf' AND (md.content_type ILIKE '%pdf%' OR md.name ILIKE '%.pdf'))
        OR (p_type = 'docx' AND (md.content_type ILIKE '%word%' OR md.name ILIKE '%.doc' OR md.name ILIKE '%.docx'))
        OR (
          p_type = 'other'
          AND NOT (md.content_type ILIKE '%pdf%' OR md.name ILIKE '%.pdf')
          AND NOT (md.content_type ILIKE '%word%' OR md.name ILIKE '%.doc' OR md.name ILIKE '%.docx')
        )
      )

    UNION ALL

    SELECT
      ld.id,
      'lead'::text AS source,
      NULL::uuid AS matter_id,
      ld.lead_id,
      COALESCE(l.practice_area_interest || ' lead', 'Lead') AS matter_name,
      COALESCE(NULLIF(trim(concat_ws(' ', l.first_name, l.last_name)), ''), l.email) AS client_name,
      ld.name,
      ld.size::bigint AS size,
      ld.content_type,
      'lead'::text AS folder,
      COALESCE(u.display_name, u.email) AS uploaded_by_name,
      ld.created_at
    FROM public.lead_documents ld
    LEFT JOIN public.leads l ON l.id = ld.lead_id
    LEFT JOIN public.users u ON u.id = ld.uploaded_by
    WHERE
      COALESCE(p_folder, 'all') IN ('all', 'lead')
      AND (
        COALESCE(p_type, 'all') = 'all'
        OR (p_type = 'pdf' AND (ld.content_type ILIKE '%pdf%' OR ld.name ILIKE '%.pdf'))
        OR (p_type = 'docx' AND (ld.content_type ILIKE '%word%' OR ld.name ILIKE '%.doc' OR ld.name ILIKE '%.docx'))
        OR (
          p_type = 'other'
          AND NOT (ld.content_type ILIKE '%pdf%' OR ld.name ILIKE '%.pdf')
          AND NOT (ld.content_type ILIKE '%word%' OR ld.name ILIKE '%.doc' OR ld.name ILIKE '%.docx')
        )
      )
  ),
  filtered AS (
    SELECT *
    FROM unified
    WHERE
      NULLIF(trim(COALESCE(p_search, '')), '') IS NULL
      OR name ILIKE '%' || trim(p_search) || '%'
      OR client_name ILIKE '%' || trim(p_search) || '%'
      OR matter_name ILIKE '%' || trim(p_search) || '%'
      OR uploaded_by_name ILIKE '%' || trim(p_search) || '%'
  )
  SELECT
    filtered.*,
    count(*) OVER () AS total_count
  FROM filtered
  ORDER BY created_at DESC, id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.get_admin_documents(text, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_documents(text, text, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_documents(text, text, text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_documents(text, text, text, integer, integer) TO service_role;
