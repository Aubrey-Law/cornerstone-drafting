CREATE OR REPLACE FUNCTION public.request_estate_clause_changes(
  p_revision_id uuid,
  p_actor_id uuid,
  p_comment text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_revision public.estate_clause_revisions%ROWTYPE;
  v_event_id uuid;
  v_latest_event text;
BEGIN
  IF length(pg_catalog.btrim(COALESCE(p_comment, ''))) = 0 THEN
    RAISE EXCEPTION 'A reviewer comment is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;

  SELECT r.*
  INTO v_revision
  FROM public.estate_clause_revisions r
  WHERE r.id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estate clause revision not found';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_revision.clause_id::text, 0));
  SELECT e.event_type INTO v_latest_event
  FROM public.estate_clause_review_events e
  WHERE e.revision_id = p_revision_id
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 1;
  IF v_latest_event IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'Estate clause revision is not awaiting review';
  END IF;

  INSERT INTO public.estate_clause_review_events (
    clause_id, revision_id, event_type, actor_id, comment
  ) VALUES (
    v_revision.clause_id, p_revision_id, 'changes_requested', p_actor_id, p_comment
  )
  RETURNING id INTO v_event_id;

  -- Restore the immutable submitted text into an author-owned working draft.
  -- The author can continue from the reviewed proposal. Never overwrite a
  -- newer draft the author may already have started while review was pending.
  INSERT INTO public.estate_clause_working_drafts (
    clause_id, base_published_revision_id, clause_text, required_fields,
    nested_clause_keys, condition_field, change_summary, content_hash,
    validation_status, validation_report, author_id, source_review_revision_id
  ) VALUES (
    v_revision.clause_id, v_revision.base_published_revision_id,
    v_revision.clause_text, v_revision.required_fields,
    v_revision.nested_clause_keys, v_revision.condition_field,
    v_revision.change_summary, v_revision.content_hash,
    v_revision.validation_status, v_revision.validation_report,
    v_revision.author_id, v_revision.id
  )
  ON CONFLICT (clause_id, author_id) DO NOTHING;

  RETURN v_event_id;
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
  v_validation_status text;
  v_validation_report jsonb;
  v_base_published_revision_id uuid;
  v_current_revision_id uuid;
  v_latest_event text;
  v_document_types text[];
  v_preview_document_types text[];
  v_nested_clause_keys text[];
  v_dependency_revision_ids jsonb;
  v_template_publication_revision_ids jsonb;
  v_dependency_missing boolean;
  v_dependency_cycle boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;

  SELECT r.clause_id, r.validation_status, r.validation_report,
         r.base_published_revision_id, c.document_types, r.nested_clause_keys, c.clause_key
  INTO v_clause_id, v_validation_status, v_validation_report,
       v_base_published_revision_id, v_document_types, v_nested_clause_keys,
       v_clause_key
  FROM public.estate_clause_revisions r
  JOIN public.estate_clauses c ON c.id = r.clause_id
  WHERE r.id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estate clause revision not found';
  END IF;
  IF v_validation_status <> 'valid' THEN
    RAISE EXCEPTION 'Estate clause revision has not passed validation';
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

  SELECT COALESCE(jsonb_object_agg(p.template_id, p.version_id::text ORDER BY p.template_id), '{}'::jsonb)
  INTO v_template_publication_revision_ids
  FROM public.document_template_publications p
  WHERE p.template_id LIKE 'estate-%';

  SELECT pe.document_types INTO v_preview_document_types
  FROM public.estate_clause_preview_evidence pe
  WHERE pe.revision_id = p_revision_id
    AND pe.clause_id = v_clause_id
    AND pe.revision_content_hash = (
      SELECT r.content_hash FROM public.estate_clause_revisions r WHERE r.id = p_revision_id
    )
    AND pe.validation_report->>'status' = 'passed'
    AND pe.template_snapshot_hash = p_current_template_snapshot_hash
    AND pe.dependency_revision_ids = v_dependency_revision_ids
    AND pe.template_publication_revision_ids = v_template_publication_revision_ids
    AND COALESCE((pe.validation_report->>'missingCount')::integer, 1) = 0
    AND COALESCE((pe.validation_report->>'warningCount')::integer, 1) = 0
    AND COALESCE((pe.validation_report->>'unresolvedMarkerCount')::integer, 1) = 0
  ORDER BY pe.created_at DESC, pe.id DESC
  LIMIT 1;
  IF cardinality(v_preview_document_types) IS NULL
     OR NOT (v_preview_document_types @> v_document_types) THEN
    RAISE EXCEPTION 'Current candidate preview evidence is missing or incomplete';
  END IF;

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

CREATE OR REPLACE FUNCTION public.revert_estate_clause_publication(
  p_clause_id uuid,
  p_target_revision_id uuid,
  p_expected_current_revision_id uuid,
  p_current_template_snapshot_hash text,
  p_reason text,
  p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_current_revision_id uuid;
  v_event_id uuid;
  v_clause_key text;
  v_nested_clause_keys text[];
  v_dependency_revision_ids jsonb;
  v_template_publication_revision_ids jsonb;
  v_dependency_missing boolean;
  v_dependency_cycle boolean;
BEGIN
  IF length(pg_catalog.btrim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'Reversion reason is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;
  SELECT r.nested_clause_keys, c.clause_key
  INTO v_nested_clause_keys, v_clause_key
  FROM public.estate_clause_revisions r
  JOIN public.estate_clauses c ON c.id = r.clause_id
  WHERE r.id = p_target_revision_id AND r.clause_id = p_clause_id AND r.validation_status = 'valid';
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.estate_clause_review_events e
    WHERE e.clause_id = p_clause_id AND e.revision_id = p_target_revision_id AND e.event_type = 'published'
  ) THEN RAISE EXCEPTION 'Target revision has no approved publication history'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-clause-publications', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clause_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-template-publications', 0)
  );
  WITH RECURSIVE dependency_graph(clause_key, nested_keys, path, cycle, available, revision_id) AS (
    SELECT v_clause_key, v_nested_clause_keys, ARRAY[v_clause_key]::text[], false, true, p_target_revision_id
    UNION ALL
    SELECT child.clause_key, COALESCE(r.nested_clause_keys, '{}'::text[]),
           graph.path || child.clause_key, child.clause_key = ANY(graph.path),
           c.id IS NOT NULL AND p.current_revision_id IS NOT NULL, p.current_revision_id
    FROM dependency_graph graph
    CROSS JOIN LATERAL unnest(graph.nested_keys) child(clause_key)
    LEFT JOIN public.estate_clauses c ON c.clause_key = child.clause_key AND c.is_active
    LEFT JOIN public.estate_clause_publications p ON p.clause_id = c.id
    LEFT JOIN public.estate_clause_revisions r ON r.id = p.current_revision_id AND r.clause_id = c.id
    WHERE NOT graph.cycle AND graph.available
  )
  SELECT COALESCE(bool_or(NOT available), false), COALESCE(bool_or(cycle), false),
         COALESCE(jsonb_object_agg(clause_key, revision_id::text)
           FILTER (WHERE clause_key <> v_clause_key AND available AND NOT cycle), '{}'::jsonb)
  INTO v_dependency_missing, v_dependency_cycle, v_dependency_revision_ids
  FROM dependency_graph;
  IF v_dependency_missing THEN RAISE EXCEPTION 'Estate clause dependency has no current publication'; END IF;
  IF v_dependency_cycle THEN RAISE EXCEPTION 'Estate clause dependency graph contains a cycle'; END IF;
  PERFORM 1 FROM public.estate_clause_publications p
  JOIN public.estate_clauses c ON c.id = p.clause_id
  WHERE c.clause_key IN (SELECT jsonb_object_keys(v_dependency_revision_ids))
  FOR SHARE OF p;
  SELECT COALESCE(jsonb_object_agg(p.template_id, p.version_id::text ORDER BY p.template_id), '{}'::jsonb)
  INTO v_template_publication_revision_ids
  FROM public.document_template_publications p WHERE p.template_id LIKE 'estate-%';
  IF NOT EXISTS (
    SELECT 1 FROM public.estate_clause_preview_evidence pe
    WHERE pe.clause_id = p_clause_id
      AND pe.revision_id = p_target_revision_id
      AND pe.template_snapshot_hash = p_current_template_snapshot_hash
      AND pe.dependency_revision_ids = v_dependency_revision_ids
      AND pe.template_publication_revision_ids = v_template_publication_revision_ids
      AND pe.validation_report->>'status' = 'passed'
  ) THEN RAISE EXCEPTION 'Current preview evidence is required before publication reversion'; END IF;
  SELECT p.current_revision_id INTO v_current_revision_id
  FROM public.estate_clause_publications p WHERE p.clause_id = p_clause_id FOR UPDATE;
  IF v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id THEN
    RAISE EXCEPTION 'Current estate clause revision changed; refresh and try again';
  END IF;
  INSERT INTO public.estate_clause_publications (clause_id, current_revision_id, published_by, published_at, updated_at)
  VALUES (p_clause_id, p_target_revision_id, p_actor_id, now(), now())
  ON CONFLICT (clause_id) DO UPDATE SET current_revision_id = EXCLUDED.current_revision_id,
    published_by = EXCLUDED.published_by, published_at = EXCLUDED.published_at, updated_at = EXCLUDED.updated_at;
  INSERT INTO public.estate_clause_review_events (
    clause_id, revision_id, event_type, actor_id, comment, metadata
  ) VALUES (
    p_clause_id, p_target_revision_id, 'publication_reverted', p_actor_id, pg_catalog.btrim(p_reason),
    jsonb_build_object('expectedCurrentRevisionId', p_expected_current_revision_id, 'previousRevisionId', v_current_revision_id)
  ) RETURNING id INTO v_event_id;
  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_estate_clause_changes(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_estate_clause_changes(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.publish_estate_clause_revision(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_estate_clause_revision(uuid, uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.revert_estate_clause_publication(uuid, uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_estate_clause_publication(uuid, uuid, uuid, text, text, uuid) TO service_role;
