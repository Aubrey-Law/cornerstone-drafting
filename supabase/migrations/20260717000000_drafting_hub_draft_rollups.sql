-- Per-matter draft rollups for the drafting hub list (counts + recent current drafts).
-- Avoids loading every draft row firm-wide when rendering /admin/drafting.

CREATE OR REPLACE FUNCTION public.drafting_hub_draft_rollups(p_matter_ids uuid[])
RETURNS TABLE (
  matter_id uuid,
  current_draft_count integer,
  superseded_draft_count integer,
  recent_drafts jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH docs AS (
    SELECT
      d.matter_id,
      d.id,
      d.name,
      d.size,
      d.created_at,
      d.generation_id,
      d.generation_engine,
      d.marker_count,
      d.missing_count,
      d.superseded_at,
      d.reviewed_at,
      d.reviewed_by
    FROM public.matter_documents d
    WHERE d.folder = 'draft'
      AND d.matter_id = ANY (p_matter_ids)
  ),
  counts AS (
    SELECT
      docs.matter_id,
      COUNT(*) FILTER (WHERE docs.superseded_at IS NULL)::integer AS current_draft_count,
      COUNT(*) FILTER (WHERE docs.superseded_at IS NOT NULL)::integer AS superseded_draft_count
    FROM docs
    GROUP BY docs.matter_id
  ),
  current_ranked AS (
    SELECT
      docs.*,
      ROW_NUMBER() OVER (
        PARTITION BY docs.matter_id
        ORDER BY docs.created_at DESC
      ) AS row_num
    FROM docs
    WHERE docs.superseded_at IS NULL
  ),
  recent AS (
    SELECT
      current_ranked.matter_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', current_ranked.id,
            'name', current_ranked.name,
            'size', current_ranked.size,
            'created_at', current_ranked.created_at,
            'generationId', current_ranked.generation_id,
            'generationEngine', current_ranked.generation_engine,
            'markerCount', current_ranked.marker_count,
            'missingCount', current_ranked.missing_count,
            'supersededAt', current_ranked.superseded_at,
            'reviewedAt', current_ranked.reviewed_at,
            'reviewedBy', current_ranked.reviewed_by
          )
          ORDER BY current_ranked.created_at DESC
        ),
        '[]'::jsonb
      ) AS recent_drafts
    FROM current_ranked
    WHERE current_ranked.row_num <= 5
    GROUP BY current_ranked.matter_id
  )
  SELECT
    counts.matter_id,
    counts.current_draft_count,
    counts.superseded_draft_count,
    COALESCE(recent.recent_drafts, '[]'::jsonb) AS recent_drafts
  FROM counts
  LEFT JOIN recent ON recent.matter_id = counts.matter_id;
$$;

GRANT EXECUTE ON FUNCTION public.drafting_hub_draft_rollups(uuid[]) TO service_role;
