-- Allow administrators/attorneys to publish document templates and estate
-- clauses without first running validation or representative-matter preview.
-- Confirmation, role checks, optimistic concurrency, and dependency integrity
-- remain enforced.

CREATE OR REPLACE FUNCTION public.publish_document_template_version(
  p_template_id text,
  p_version_id uuid,
  p_expected_active_version_id uuid,
  p_actor_id uuid,
  p_confirmation text,
  p_event_type text DEFAULT 'published'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current uuid;
  v_status text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_template_id, 0));

  IF p_event_type NOT IN ('published', 'rolled_back') THEN
    RAISE EXCEPTION 'Invalid publication event type';
  END IF;

  IF p_confirmation IS DISTINCT FROM p_template_id THEN
    RAISE EXCEPTION 'Template confirmation does not match';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrator role required';
  END IF;

  SELECT v.validation_status INTO v_status
  FROM public.document_template_versions v
  WHERE v.id = p_version_id AND v.template_id = p_template_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'Template version not found'; END IF;

  SELECT p.version_id INTO v_current
  FROM public.document_template_publications p
  WHERE p.template_id = p_template_id
  FOR UPDATE;

  IF v_current IS DISTINCT FROM p_expected_active_version_id THEN
    RAISE EXCEPTION 'Active template version changed; refresh and try again';
  END IF;

  INSERT INTO public.document_template_publications (
    template_id, version_id, published_by, published_at, updated_at
  ) VALUES (
    p_template_id, p_version_id, p_actor_id, now(), now()
  )
  ON CONFLICT (template_id) DO UPDATE SET
    version_id = EXCLUDED.version_id,
    published_by = EXCLUDED.published_by,
    published_at = EXCLUDED.published_at,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO public.document_template_events (
    template_id, version_id, previous_version_id, event_type, actor_id, metadata
  ) VALUES (
    p_template_id,
    p_version_id,
    v_current,
    p_event_type,
    p_actor_id,
    jsonb_build_object('expectedActiveVersionId', p_expected_active_version_id)
  );

  RETURN jsonb_build_object(
    'templateId', p_template_id,
    'versionId', p_version_id,
    'previousVersionId', v_current
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_estate_clause_revision(
  p_working_draft_id uuid,
  p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft public.estate_clause_working_drafts%ROWTYPE;
  v_revision_id uuid;
  v_revision_number integer;
  v_clause_key text;
  v_dependency_missing boolean;
  v_dependency_cycle boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.estate_clause_working_drafts d
  WHERE d.id = p_working_draft_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estate clause working draft not found';
  END IF;
  IF v_draft.author_id <> p_actor_id THEN
    RAISE EXCEPTION 'Only the working draft author may submit it';
  END IF;

  SELECT c.clause_key INTO v_clause_key FROM public.estate_clauses c WHERE c.id = v_draft.clause_id;
  WITH RECURSIVE dependency_graph(clause_key, nested_keys, path, cycle, available) AS (
    SELECT v_clause_key, v_draft.nested_clause_keys, ARRAY[v_clause_key]::text[], false, true
    UNION ALL
    SELECT child.clause_key,
           COALESCE(r.nested_clause_keys, '{}'::text[]),
           graph.path || child.clause_key,
           child.clause_key = ANY(graph.path),
           c.id IS NOT NULL AND p.current_revision_id IS NOT NULL
    FROM dependency_graph graph
    CROSS JOIN LATERAL unnest(graph.nested_keys) child(clause_key)
    LEFT JOIN public.estate_clauses c ON c.clause_key = child.clause_key AND c.is_active
    LEFT JOIN public.estate_clause_publications p ON p.clause_id = c.id
    LEFT JOIN public.estate_clause_revisions r
      ON r.id = p.current_revision_id AND r.clause_id = c.id
    WHERE NOT graph.cycle AND graph.available
  )
  SELECT COALESCE(bool_or(NOT available), false), COALESCE(bool_or(cycle), false)
  INTO v_dependency_missing, v_dependency_cycle
  FROM dependency_graph;
  IF v_dependency_missing THEN
    RAISE EXCEPTION 'Estate clause dependency has no current publication';
  END IF;
  IF v_dependency_cycle THEN
    RAISE EXCEPTION 'Estate clause dependency graph contains a cycle';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_draft.clause_id::text, 0));
  SELECT COALESCE(MAX(r.revision_number), 0) + 1
  INTO v_revision_number
  FROM public.estate_clause_revisions r
  WHERE r.clause_id = v_draft.clause_id;

  INSERT INTO public.estate_clause_revisions (
    clause_id, revision_number, clause_text, required_fields, nested_clause_keys,
    condition_field, content_hash, change_summary, validation_status,
    validation_report, author_id, base_published_revision_id
  ) VALUES (
    v_draft.clause_id, v_revision_number, v_draft.clause_text,
    v_draft.required_fields, v_draft.nested_clause_keys, v_draft.condition_field,
    v_draft.content_hash, v_draft.change_summary, v_draft.validation_status,
    v_draft.validation_report, p_actor_id, v_draft.base_published_revision_id
  )
  RETURNING id INTO v_revision_id;

  INSERT INTO public.estate_clause_review_events (
    clause_id, revision_id, event_type, actor_id, validation_report
  ) VALUES (
    v_draft.clause_id, v_revision_id, 'submitted', p_actor_id, v_draft.validation_report
  );

  DELETE FROM public.estate_clause_working_drafts
  WHERE id = p_working_draft_id;

  RETURN v_revision_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_estate_clause_revision(
  p_revision_id uuid,
  p_actor_id uuid,
  p_expected_current_revision_id uuid,
  p_current_template_snapshot_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clause_id uuid;
  v_clause_key text;
  v_validation_report jsonb;
  v_base_published_revision_id uuid;
  v_current_revision_id uuid;
  v_latest_event text;
  v_nested_clause_keys text[];
  v_dependency_revision_ids jsonb;
  v_dependency_missing boolean;
  v_dependency_cycle boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;

  SELECT r.clause_id, r.validation_report,
         r.base_published_revision_id, r.nested_clause_keys, c.clause_key
  INTO v_clause_id, v_validation_report,
       v_base_published_revision_id, v_nested_clause_keys, v_clause_key
  FROM public.estate_clause_revisions r
  JOIN public.estate_clauses c ON c.id = r.clause_id
  WHERE r.id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estate clause revision not found';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-clause-publications', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_clause_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-template-publications', 0)
  );

  WITH RECURSIVE dependency_graph(clause_key, nested_keys, path, cycle, available, revision_id) AS (
    SELECT v_clause_key, v_nested_clause_keys, ARRAY[v_clause_key]::text[],
           false, true, p_revision_id
    UNION ALL
    SELECT child.clause_key, COALESCE(r.nested_clause_keys, '{}'::text[]),
           graph.path || child.clause_key, child.clause_key = ANY(graph.path),
           c.id IS NOT NULL AND p.current_revision_id IS NOT NULL, p.current_revision_id
    FROM dependency_graph graph
    CROSS JOIN LATERAL unnest(graph.nested_keys) child(clause_key)
    LEFT JOIN public.estate_clauses c ON c.clause_key = child.clause_key AND c.is_active
    LEFT JOIN public.estate_clause_publications p ON p.clause_id = c.id
    LEFT JOIN public.estate_clause_revisions r
      ON r.id = p.current_revision_id AND r.clause_id = c.id
    WHERE NOT graph.cycle AND graph.available
  )
  SELECT COALESCE(bool_or(NOT available), false), COALESCE(bool_or(cycle), false),
         COALESCE(jsonb_object_agg(clause_key, revision_id::text)
           FILTER (WHERE clause_key <> v_clause_key AND available AND NOT cycle), '{}'::jsonb)
  INTO v_dependency_missing, v_dependency_cycle, v_dependency_revision_ids
  FROM dependency_graph;
  IF v_dependency_missing THEN RAISE EXCEPTION 'Estate clause dependency has no current publication'; END IF;
  IF v_dependency_cycle THEN RAISE EXCEPTION 'Estate clause dependency graph contains a cycle'; END IF;

  PERFORM 1
  FROM public.estate_clause_publications p
  JOIN public.estate_clauses c ON c.id = p.clause_id
  WHERE c.clause_key IN (SELECT jsonb_object_keys(v_dependency_revision_ids))
  FOR SHARE OF p;

  SELECT e.event_type INTO v_latest_event
  FROM public.estate_clause_review_events e
  WHERE e.revision_id = p_revision_id
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 1;
  IF v_latest_event IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'Estate clause revision is not awaiting review';
  END IF;

  SELECT p.current_revision_id INTO v_current_revision_id
  FROM public.estate_clause_publications p
  WHERE p.clause_id = v_clause_id
  FOR UPDATE;

  IF v_base_published_revision_id IS DISTINCT FROM p_expected_current_revision_id THEN
    RAISE EXCEPTION 'Estate clause revision was drafted from a different publication';
  END IF;
  IF v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id THEN
    RAISE EXCEPTION 'Current estate clause revision changed; refresh and try again';
  END IF;
  IF v_base_published_revision_id IS DISTINCT FROM v_current_revision_id THEN
    RAISE EXCEPTION 'Estate clause revision base is no longer current';
  END IF;

  INSERT INTO public.estate_clause_publications (
    clause_id, current_revision_id, published_by, published_at, updated_at
  ) VALUES (
    v_clause_id, p_revision_id, p_actor_id, now(), now()
  )
  ON CONFLICT (clause_id) DO UPDATE SET
    current_revision_id = EXCLUDED.current_revision_id,
    published_by = EXCLUDED.published_by,
    published_at = EXCLUDED.published_at,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO public.estate_clause_review_events (
    clause_id, revision_id, event_type, actor_id, validation_report
  ) VALUES
    (v_clause_id, p_revision_id, 'approved', p_actor_id, v_validation_report),
    (v_clause_id, p_revision_id, 'published', p_actor_id, v_validation_report);

  RETURN jsonb_build_object(
    'clauseId', v_clause_id,
    'revisionId', p_revision_id,
    'previousRevisionId', v_current_revision_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_document_template_version(text, uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_estate_clause_revision(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_estate_clause_revision(uuid, uuid, uuid, text) TO service_role;
