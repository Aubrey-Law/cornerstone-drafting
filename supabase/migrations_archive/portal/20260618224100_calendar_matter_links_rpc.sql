-- Resolve calendar attendee emails to matter links in one database round trip.

CREATE OR REPLACE FUNCTION public.get_matter_links_by_emails(p_emails text[])
RETURNS TABLE (
  email text,
  matter_id uuid,
  matter_name text,
  stage text,
  doc_counts jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH input_emails AS (
    SELECT DISTINCT lower(trim(email)) AS email
    FROM unnest(COALESCE(p_emails, ARRAY[]::text[])) AS email
    WHERE nullif(trim(email), '') IS NOT NULL
  ),
  matched_intakes AS (
    SELECT DISTINCT ON (lower(ci.email))
      lower(ci.email) AS email,
      ci.id AS intake_id,
      ci.first_name,
      ci.last_name
    FROM public.client_intake ci
    JOIN input_emails ie ON ie.email = lower(ci.email)
    ORDER BY lower(ci.email), ci.updated_at DESC NULLS LAST, ci.created_at DESC
  ),
  matched_matters AS (
    SELECT DISTINCT ON (mi.email)
      mi.email,
      m.id AS matter_id,
      COALESCE(
        NULLIF(m.name, ''),
        NULLIF(trim(concat_ws(' ', mi.first_name, mi.last_name)), ''),
        mi.email
      ) AS matter_name,
      COALESCE(m.stage::text, 'intake') AS stage
    FROM matched_intakes mi
    JOIN public.matters m ON m.client_intake_id = mi.intake_id
    WHERE COALESCE(m.status, '') <> 'archived'
    ORDER BY mi.email, m.created_at DESC
  ),
  doc_counts AS (
    SELECT
      md.matter_id::uuid AS matter_id,
      count(*) FILTER (WHERE md.folder = 'draft') AS drafts,
      count(*) FILTER (WHERE md.folder = 'review') AS review,
      count(*) FILTER (WHERE md.folder = 'signed') AS signed,
      count(*) FILTER (WHERE md.folder = 'final') AS final
    FROM public.matter_documents md
    JOIN matched_matters mm ON mm.matter_id::text = md.matter_id
    GROUP BY md.matter_id
  )
  SELECT
    mm.email,
    mm.matter_id,
    mm.matter_name,
    mm.stage,
    jsonb_build_object(
      'drafts', COALESCE(dc.drafts, 0),
      'review', COALESCE(dc.review, 0),
      'signed', COALESCE(dc.signed, 0),
      'final', COALESCE(dc.final, 0)
    ) AS doc_counts
  FROM matched_matters mm
  LEFT JOIN doc_counts dc ON dc.matter_id = mm.matter_id;
$$;

REVOKE ALL ON FUNCTION public.get_matter_links_by_emails(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_matter_links_by_emails(text[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_matter_links_by_emails(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_matter_links_by_emails(text[]) TO service_role;
