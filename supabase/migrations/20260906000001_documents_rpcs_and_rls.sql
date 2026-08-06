-- Task 14: move the database's own logic off matter_documents.folder.
--
-- Three RPCs and two RLS policies still referenced `folder`; they are redefined
-- here in terms of the two replacement columns:
--   shared_at timestamptz | null -- client visibility (the only rule)
--   source    text              -- provenance ('firm' | 'client' | 'meeting-notes')
--
-- Nothing is dropped irreversibly: every function is CREATE OR REPLACE and the
-- policies are DROP POLICY IF EXISTS + CREATE POLICY.

-- ---------------------------------------------------------------------------
-- 1. drafting_hub_draft_rollups: firm-authored documents instead of folder='draft'
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drafting_hub_draft_rollups(p_matter_ids text[])
 RETURNS TABLE(matter_id text, current_draft_count integer, superseded_draft_count integer, recent_drafts jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    WHERE d.source = 'firm'
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
$function$;

-- ---------------------------------------------------------------------------
-- 2. get_matter_links_by_emails: two counts (drafts / shared) instead of four folders
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_matter_links_by_emails(p_emails text[])
 RETURNS TABLE(email text, matter_id uuid, matter_name text, stage text, doc_counts jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
      count(*) FILTER (WHERE md.source = 'firm' AND md.shared_at IS NULL) AS drafts,
      count(*) FILTER (WHERE md.shared_at IS NOT NULL) AS shared
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
      'shared', COALESCE(dc.shared, 0)
    ) AS doc_counts
  FROM matched_matters mm
  LEFT JOIN doc_counts dc ON dc.matter_id = mm.matter_id;
$function$;

-- ---------------------------------------------------------------------------
-- 3. persist_generated_estate_document: stop writing `folder`
--    The column defaults (source = 'firm', shared_at = null) are correct for a
--    generated draft.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.persist_generated_estate_document(p_document jsonb, p_manifest jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_document_id uuid;
  v_document_version_id uuid;
  v_matter_id uuid;
  v_manifest_entry jsonb;
  v_clause_id uuid;
  v_revision_id uuid;
  v_override_id uuid;
  v_selection_reason text;
  v_included boolean;
  v_override_action text;
BEGIN
  IF jsonb_typeof(p_document) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Document metadata must be a JSON object';
  END IF;
  IF jsonb_typeof(p_manifest) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Clause manifest must be a JSON array';
  END IF;
  IF length(pg_catalog.btrim(COALESCE(p_document->>'r2_key', ''))) = 0
     OR length(pg_catalog.btrim(COALESCE(p_document->>'name', ''))) = 0 THEN
    RAISE EXCEPTION 'Document R2 key and name are required';
  END IF;
  IF COALESCE(p_document->>'generation_engine', '') <> 'node' THEN
    RAISE EXCEPTION 'Database estate clause provenance requires the Node generation engine';
  END IF;
  IF COALESCE((p_document->>'size')::bigint, -1) < 0
     OR COALESCE((p_document->>'marker_count')::integer, -1) < 0
     OR COALESCE((p_document->>'missing_count')::integer, -1) < 0 THEN
    RAISE EXCEPTION 'Document size and marker counts must be non-negative';
  END IF;

  v_matter_id := (p_document->>'matter_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.matters m WHERE m.id = v_matter_id) THEN
    RAISE EXCEPTION 'Matter not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (p_document->>'actor_id')::uuid
      AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or administrator actor required';
  END IF;

  INSERT INTO public.matter_documents (
    matter_id, r2_key, name, size, content_type, uploaded_by,
    generation_id, generation_engine, marker_count, missing_count,
    template_id, template_version_id
  ) VALUES (
    v_matter_id::text,
    p_document->>'r2_key',
    p_document->>'name',
    COALESCE((p_document->>'size')::bigint, 0),
    COALESCE(p_document->>'content_type', 'application/octet-stream'),
    (p_document->>'actor_id')::uuid,
    (p_document->>'generation_id')::uuid,
    COALESCE(p_document->>'generation_engine', 'node'),
    (p_document->>'marker_count')::integer,
    (p_document->>'missing_count')::integer,
    p_document->>'template_id',
    (p_document->>'template_version_id')::uuid
  )
  RETURNING id INTO v_document_id;

  INSERT INTO public.document_versions (
    document_id, r2_key, source, version_number, filename, file_type,
    size_bytes, created_by
  ) VALUES (
    v_document_id,
    p_document->>'r2_key',
    'generated',
    1,
    p_document->>'name',
    p_document->>'content_type',
    COALESCE((p_document->>'size')::bigint, 0),
    (p_document->>'actor_id')::uuid
  )
  RETURNING id INTO v_document_version_id;

  FOR v_manifest_entry IN SELECT value FROM jsonb_array_elements(p_manifest)
  LOOP
    IF jsonb_typeof(v_manifest_entry) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Each clause manifest entry must be a JSON object';
    END IF;

    v_clause_id := (v_manifest_entry->>'clauseId')::uuid;
    v_revision_id := (v_manifest_entry->>'revisionId')::uuid;
    v_override_id := NULLIF(v_manifest_entry->>'overrideId', '')::uuid;
    v_selection_reason := v_manifest_entry->>'selectionReason';
    v_included := COALESCE((v_manifest_entry->>'included')::boolean, true);
    v_override_action := NULLIF(v_manifest_entry->>'overrideAction', '');

    IF NOT EXISTS (
      SELECT 1
      FROM public.estate_clause_revisions r
      JOIN public.estate_clauses c ON c.id = r.clause_id
      WHERE r.id = v_revision_id
        AND r.clause_id = v_clause_id
        AND r.content_hash = v_manifest_entry->>'contentHash'
        AND c.clause_key = v_manifest_entry->>'clauseKey'
    ) THEN
      RAISE EXCEPTION 'Clause manifest revision, clause key, or content hash is invalid';
    END IF;

    -- The immutable revision only needs to have been published when the frozen
    -- generation snapshot was loaded. A newer publication may become current
    -- while a DOCX is rendering; that race must not make the exact generated
    -- artifact impossible to register.
    IF NOT EXISTS (
      SELECT 1
      FROM public.estate_clause_review_events e
      WHERE e.clause_id = v_clause_id
        AND e.revision_id = v_revision_id
        AND e.event_type = 'published'
    ) THEN
      RAISE EXCEPTION 'Clause manifest revision has no publication history';
    END IF;

    IF v_selection_reason = 'template_rule' AND (v_override_id IS NOT NULL OR NOT v_included) THEN
      RAISE EXCEPTION 'Template-rule selections cannot reference an override';
    ELSIF v_selection_reason = 'attorney_override' THEN
      IF v_override_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.matter_estate_clause_overrides o
        WHERE o.id = v_override_id
          AND o.matter_id = v_matter_id
          AND o.clause_id = v_clause_id
          AND o.event_type = 'applied'
          AND o.publication_revision_id = v_revision_id
          AND o.action = v_override_action
          AND o.action = CASE WHEN v_included THEN 'force_include' ELSE 'force_omit' END
      ) THEN
        RAISE EXCEPTION 'Attorney override does not belong to the matter and clause';
      END IF;
    ELSIF v_selection_reason NOT IN ('template_rule', 'attorney_override') THEN
      RAISE EXCEPTION 'Invalid clause selection reason';
    END IF;

    INSERT INTO public.generated_document_clause_revisions (
      document_version_id, clause_id, revision_id, clause_key, content_hash,
      included, inclusion_position, selection_reason, override_id, override_action
    ) VALUES (
      v_document_version_id, v_clause_id, v_revision_id,
      v_manifest_entry->>'clauseKey', v_manifest_entry->>'contentHash',
      v_included, NULLIF(v_manifest_entry->>'inclusionPosition', '')::integer,
      v_selection_reason, v_override_id, v_override_action
    );
  END LOOP;

  UPDATE public.matter_documents
  SET current_version_id = v_document_version_id
  WHERE id = v_document_id;

  RETURN jsonb_build_object(
    'documentId', v_document_id,
    'documentVersionId', v_document_version_id
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. RLS policies: client visibility is shared_at, or the client's own upload
-- ---------------------------------------------------------------------------
drop policy if exists client_read_visible_matter_documents on public.matter_documents;
create policy client_read_visible_matter_documents
  on public.matter_documents for select
  to authenticated
  using (
    (shared_at is not null or uploaded_by = auth.uid())
    and (
      exists (select 1 from matters m where m.id::text = matter_documents.matter_id and m.client_id = auth.uid())
      or exists (
        select 1 from v_matter_pipeline v
        where v.matter_id::text = matter_documents.matter_id
          and v.client_email = (select u.email from auth.users u where u.id = auth.uid())::text
      )
    )
  );

drop policy if exists client_insert_own_client_folder_documents on public.matter_documents;
drop policy if exists client_insert_own_documents on public.matter_documents;
create policy client_insert_own_documents
  on public.matter_documents for insert
  to authenticated
  with check (
    source = 'client'
    and (
      exists (select 1 from matters m where m.id::text = matter_documents.matter_id and m.client_id = auth.uid())
      or exists (
        select 1 from v_matter_pipeline v
        where v.matter_id::text = matter_documents.matter_id
          and v.client_email = (select users.email from auth.users where users.id = auth.uid())::text
      )
    )
  );
