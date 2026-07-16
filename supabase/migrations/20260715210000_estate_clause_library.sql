-- Immutable Massachusetts estate-clause library, independent review workflow,
-- matter overrides, and normalized generated-document provenance.

CREATE TABLE public.estate_clauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clause_key text NOT NULL UNIQUE CHECK (length(btrim(clause_key)) > 0),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  jurisdiction text NOT NULL DEFAULT 'MA' CHECK (jurisdiction = 'MA'),
  document_types text[] NOT NULL CHECK (
    cardinality(document_types) > 0
    AND document_types <@ ARRAY[
      'will', 'trust', 'durable_power_of_attorney',
      'health_care_directive', 'hipaa_authorization', 'ancillary'
    ]::text[]
  ),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.estate_clauses
  ADD CONSTRAINT estate_clauses_id_clause_key_key UNIQUE (id, clause_key);

CREATE TABLE public.estate_clause_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clause_id uuid NOT NULL REFERENCES public.estate_clauses(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  clause_text text NOT NULL CHECK (length(btrim(clause_text)) > 0),
  required_fields text[] NOT NULL DEFAULT '{}',
  nested_clause_keys text[] NOT NULL DEFAULT '{}',
  condition_field text,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  change_summary text NOT NULL CHECK (length(btrim(change_summary)) > 0),
  validation_status text NOT NULL CHECK (validation_status IN ('valid', 'invalid')),
  validation_report jsonb NOT NULL,
  author_id uuid NOT NULL REFERENCES public.users(id),
  base_published_revision_id uuid REFERENCES public.estate_clause_revisions(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clause_id, revision_number),
  UNIQUE (id, clause_id),
  UNIQUE (id, clause_id, content_hash),
  FOREIGN KEY (base_published_revision_id, clause_id)
    REFERENCES public.estate_clause_revisions(id, clause_id) ON DELETE RESTRICT
);

CREATE TABLE public.estate_clause_working_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clause_id uuid NOT NULL REFERENCES public.estate_clauses(id) ON DELETE CASCADE,
  base_published_revision_id uuid REFERENCES public.estate_clause_revisions(id) ON DELETE RESTRICT,
  clause_text text NOT NULL CHECK (length(btrim(clause_text)) > 0),
  required_fields text[] NOT NULL DEFAULT '{}',
  nested_clause_keys text[] NOT NULL DEFAULT '{}',
  condition_field text,
  change_summary text NOT NULL CHECK (length(btrim(change_summary)) > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  validation_status text NOT NULL DEFAULT 'invalid' CHECK (validation_status IN ('valid', 'invalid')),
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  author_id uuid NOT NULL REFERENCES public.users(id),
  source_review_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clause_id, author_id),
  FOREIGN KEY (base_published_revision_id, clause_id)
    REFERENCES public.estate_clause_revisions(id, clause_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_review_revision_id, clause_id)
    REFERENCES public.estate_clause_revisions(id, clause_id) ON DELETE RESTRICT
);

CREATE TABLE public.estate_clause_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clause_id uuid NOT NULL REFERENCES public.estate_clauses(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'submitted', 'changes_requested', 'approved', 'published', 'retired', 'publication_reverted'
  )),
  actor_id uuid NOT NULL REFERENCES public.users(id),
  comment text,
  validation_report jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (revision_id, clause_id)
    REFERENCES public.estate_clause_revisions(id, clause_id) ON DELETE RESTRICT,
  CHECK (
    event_type NOT IN ('changes_requested', 'retired', 'publication_reverted')
    OR (comment IS NOT NULL AND length(btrim(comment)) > 0)
  )
);

CREATE TABLE public.estate_clause_publications (
  clause_id uuid PRIMARY KEY REFERENCES public.estate_clauses(id) ON DELETE RESTRICT,
  current_revision_id uuid NOT NULL,
  published_by uuid NOT NULL REFERENCES public.users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (current_revision_id, clause_id)
    REFERENCES public.estate_clause_revisions(id, clause_id) ON DELETE RESTRICT
);

CREATE TABLE public.estate_clause_preview_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clause_id uuid NOT NULL REFERENCES public.estate_clauses(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL,
  revision_content_hash text NOT NULL CHECK (revision_content_hash ~ '^[0-9a-f]{64}$'),
  template_snapshot_hash text NOT NULL CHECK (template_snapshot_hash ~ '^[0-9a-f]{64}$'),
  document_types text[] NOT NULL CHECK (cardinality(document_types) > 0),
  dependency_revision_ids jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(dependency_revision_ids) = 'object'),
  representative_matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE RESTRICT,
  validation_report jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (revision_id, clause_id, revision_content_hash)
    REFERENCES public.estate_clause_revisions(id, clause_id, content_hash) ON DELETE RESTRICT
);

CREATE TABLE public.matter_estate_clause_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  clause_id uuid NOT NULL REFERENCES public.estate_clauses(id) ON DELETE RESTRICT,
  publication_revision_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('applied', 'retired')),
  action text CHECK (action IN ('force_include', 'force_omit')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  supersedes_override_id uuid REFERENCES public.matter_estate_clause_overrides(id) ON DELETE RESTRICT,
  FOREIGN KEY (publication_revision_id, clause_id)
    REFERENCES public.estate_clause_revisions(id, clause_id) ON DELETE RESTRICT,
  CHECK (
    (event_type = 'applied' AND action IS NOT NULL)
    OR (event_type = 'retired' AND action IS NULL)
  )
);

CREATE TABLE public.generated_document_clause_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id uuid NOT NULL REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  clause_id uuid NOT NULL REFERENCES public.estate_clauses(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL REFERENCES public.estate_clause_revisions(id) ON DELETE RESTRICT,
  clause_key text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  included boolean NOT NULL,
  inclusion_position integer CHECK (inclusion_position >= 0),
  selection_reason text NOT NULL CHECK (selection_reason IN ('template_rule', 'attorney_override')),
  override_id uuid REFERENCES public.matter_estate_clause_overrides(id) ON DELETE RESTRICT,
  override_action text CHECK (override_action IN ('force_include', 'force_omit')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_version_id, clause_key),
  FOREIGN KEY (clause_id, clause_key)
    REFERENCES public.estate_clauses(id, clause_key) ON DELETE RESTRICT,
  FOREIGN KEY (revision_id, clause_id, content_hash)
    REFERENCES public.estate_clause_revisions(id, clause_id, content_hash) ON DELETE RESTRICT,
  CHECK (
    (selection_reason = 'template_rule' AND override_id IS NULL AND override_action IS NULL AND included)
    OR (selection_reason = 'attorney_override' AND override_id IS NOT NULL AND override_action IS NOT NULL)
  ),
  CHECK (
    (included AND inclusion_position IS NOT NULL)
    OR (NOT included AND inclusion_position IS NULL)
  )
);

CREATE INDEX estate_clause_revisions_clause_idx
  ON public.estate_clause_revisions (clause_id, revision_number DESC);
CREATE INDEX estate_clause_review_events_revision_idx
  ON public.estate_clause_review_events (revision_id, created_at DESC);
CREATE INDEX matter_estate_clause_overrides_matter_idx
  ON public.matter_estate_clause_overrides (matter_id);
CREATE INDEX generated_document_clause_revisions_revision_idx
  ON public.generated_document_clause_revisions (revision_id);
CREATE INDEX generated_document_clause_revisions_document_idx
  ON public.generated_document_clause_revisions (document_version_id);
CREATE UNIQUE INDEX generated_document_clause_revisions_position_idx
  ON public.generated_document_clause_revisions (document_version_id, inclusion_position)
  WHERE included;

CREATE OR REPLACE FUNCTION public.prevent_estate_clause_revision_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Estate clause revisions are immutable';
END;
$$;

CREATE TRIGGER estate_clause_revisions_immutable
BEFORE UPDATE OR DELETE ON public.estate_clause_revisions
FOR EACH ROW EXECUTE FUNCTION public.prevent_estate_clause_revision_mutation();

CREATE TRIGGER estate_clause_review_events_immutable
BEFORE UPDATE OR DELETE ON public.estate_clause_review_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_estate_clause_revision_mutation();

CREATE TRIGGER estate_clause_preview_evidence_immutable
BEFORE UPDATE OR DELETE ON public.estate_clause_preview_evidence
FOR EACH ROW EXECUTE FUNCTION public.prevent_estate_clause_revision_mutation();

CREATE TRIGGER matter_estate_clause_overrides_immutable
BEFORE UPDATE OR DELETE ON public.matter_estate_clause_overrides
FOR EACH ROW EXECUTE FUNCTION public.prevent_estate_clause_revision_mutation();

CREATE TRIGGER generated_document_clause_revisions_immutable
BEFORE UPDATE OR DELETE ON public.generated_document_clause_revisions
FOR EACH ROW EXECUTE FUNCTION public.prevent_estate_clause_revision_mutation();

CREATE OR REPLACE FUNCTION public.prevent_used_estate_clause_key_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.clause_key IS DISTINCT FROM OLD.clause_key
     AND (
       EXISTS (SELECT 1 FROM public.estate_clause_publications p WHERE p.clause_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.generated_document_clause_revisions g WHERE g.clause_id = OLD.id)
     ) THEN
    RAISE EXCEPTION 'A used estate clause key cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER estate_clause_key_stable_after_use
BEFORE UPDATE OF clause_key ON public.estate_clauses
FOR EACH ROW EXECUTE FUNCTION public.prevent_used_estate_clause_key_change();

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
  IF v_draft.validation_status <> 'valid' THEN
    RAISE EXCEPTION 'Estate clause working draft has not passed validation';
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
  IF v_revision.author_id = p_actor_id THEN
    RAISE EXCEPTION 'A different attorney or administrator must review this revision';
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
  v_author_id uuid;
  v_validation_status text;
  v_validation_report jsonb;
  v_base_published_revision_id uuid;
  v_current_revision_id uuid;
  v_latest_event text;
  v_document_types text[];
  v_preview_document_types text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;

  SELECT r.clause_id, r.author_id, r.validation_status, r.validation_report,
         r.base_published_revision_id, c.document_types
  INTO v_clause_id, v_author_id, v_validation_status, v_validation_report,
       v_base_published_revision_id, v_document_types
  FROM public.estate_clause_revisions r
  JOIN public.estate_clauses c ON c.id = r.clause_id
  WHERE r.id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estate clause revision not found';
  END IF;
  IF v_author_id = p_actor_id THEN
    RAISE EXCEPTION 'A different attorney or administrator must publish this revision';
  END IF;
  IF v_validation_status <> 'valid' THEN
    RAISE EXCEPTION 'Estate clause revision has not passed validation';
  END IF;

  SELECT pe.document_types INTO v_preview_document_types
  FROM public.estate_clause_preview_evidence pe
  WHERE pe.revision_id = p_revision_id
    AND pe.clause_id = v_clause_id
    AND pe.revision_content_hash = (
      SELECT r.content_hash FROM public.estate_clause_revisions r WHERE r.id = p_revision_id
    )
    AND pe.validation_report->>'status' = 'passed'
    AND pe.template_snapshot_hash = p_current_template_snapshot_hash
    AND COALESCE((pe.validation_report->>'missingCount')::integer, 1) = 0
    AND COALESCE((pe.validation_report->>'warningCount')::integer, 1) = 0
    AND COALESCE((pe.validation_report->>'unresolvedMarkerCount')::integer, 1) = 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each_text(pe.dependency_revision_ids) dependency(clause_key, revision_id)
      LEFT JOIN public.estate_clauses dependency_clause
        ON dependency_clause.clause_key = dependency.clause_key AND dependency_clause.is_active
      LEFT JOIN public.estate_clause_publications dependency_publication
        ON dependency_publication.clause_id = dependency_clause.id
      WHERE dependency_publication.current_revision_id::text IS DISTINCT FROM dependency.revision_id
    )
  ORDER BY pe.created_at DESC, pe.id DESC
  LIMIT 1;
  IF cardinality(v_preview_document_types) IS NULL
     OR NOT (v_preview_document_types @> v_document_types) THEN
    RAISE EXCEPTION 'Current candidate preview evidence is missing or incomplete';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_clause_id::text, 0));
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

CREATE OR REPLACE FUNCTION public.record_estate_clause_preview(
  p_revision_id uuid,
  p_template_snapshot_hash text,
  p_document_types text[],
  p_dependency_revision_ids jsonb,
  p_representative_matter_id uuid,
  p_validation_report jsonb,
  p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_evidence_id uuid;
  v_clause_id uuid;
  v_content_hash text;
  v_declared_types text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;
  SELECT r.clause_id, r.content_hash, c.document_types
  INTO v_clause_id, v_content_hash, v_declared_types
  FROM public.estate_clause_revisions r
  JOIN public.estate_clauses c ON c.id = r.clause_id
  WHERE r.id = p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Estate clause revision not found'; END IF;
  IF p_validation_report->>'status' <> 'passed'
     OR COALESCE((p_validation_report->>'missingCount')::integer, 1) <> 0
     OR COALESCE((p_validation_report->>'warningCount')::integer, 1) <> 0
     OR COALESCE((p_validation_report->>'unresolvedMarkerCount')::integer, 1) <> 0
     OR NOT (p_document_types @> v_declared_types) THEN
    RAISE EXCEPTION 'Candidate preview has blockers or incomplete document-type coverage';
  END IF;
  IF jsonb_typeof(p_dependency_revision_ids) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Candidate preview dependency revisions must be a JSON object';
  END IF;
  INSERT INTO public.estate_clause_preview_evidence (
    clause_id, revision_id, revision_content_hash, template_snapshot_hash,
    document_types, dependency_revision_ids, representative_matter_id,
    validation_report, created_by
  ) VALUES (
    v_clause_id, p_revision_id, v_content_hash, p_template_snapshot_hash,
    p_document_types, p_dependency_revision_ids, p_representative_matter_id,
    p_validation_report, p_actor_id
  ) RETURNING id INTO v_evidence_id;
  RETURN v_evidence_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.retire_estate_clause_publication(
  p_clause_id uuid,
  p_expected_current_revision_id uuid,
  p_reason text,
  p_actor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_current_revision_id uuid;
  v_event_id uuid;
BEGIN
  IF length(pg_catalog.btrim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'Retirement reason is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clause_id::text, 0));
  SELECT p.current_revision_id INTO v_current_revision_id
  FROM public.estate_clause_publications p WHERE p.clause_id = p_clause_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current estate clause publication not found'; END IF;
  IF v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id THEN
    RAISE EXCEPTION 'Current estate clause revision changed; refresh and try again';
  END IF;
  INSERT INTO public.estate_clause_review_events (
    clause_id, revision_id, event_type, actor_id, comment, metadata
  ) VALUES (
    p_clause_id, v_current_revision_id, 'retired', p_actor_id, pg_catalog.btrim(p_reason),
    jsonb_build_object('expectedCurrentRevisionId', p_expected_current_revision_id)
  ) RETURNING id INTO v_event_id;
  DELETE FROM public.estate_clause_publications p WHERE p.clause_id = p_clause_id;
  RETURN v_event_id;
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
  v_target_author_id uuid;
  v_event_id uuid;
BEGIN
  IF length(pg_catalog.btrim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'Reversion reason is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;
  SELECT r.author_id INTO v_target_author_id FROM public.estate_clause_revisions r
  WHERE r.id = p_target_revision_id AND r.clause_id = p_clause_id AND r.validation_status = 'valid';
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.estate_clause_review_events e
    WHERE e.clause_id = p_clause_id AND e.revision_id = p_target_revision_id AND e.event_type = 'published'
  ) THEN RAISE EXCEPTION 'Target revision has no approved publication history'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.estate_clause_preview_evidence pe
    WHERE pe.clause_id = p_clause_id
      AND pe.revision_id = p_target_revision_id
      AND pe.template_snapshot_hash = p_current_template_snapshot_hash
      AND pe.validation_report->>'status' = 'passed'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_each_text(pe.dependency_revision_ids) dependency(clause_key, revision_id)
        LEFT JOIN public.estate_clauses dependency_clause
          ON dependency_clause.clause_key = dependency.clause_key AND dependency_clause.is_active
        LEFT JOIN public.estate_clause_publications dependency_publication
          ON dependency_publication.clause_id = dependency_clause.id
        WHERE dependency_publication.current_revision_id::text IS DISTINCT FROM dependency.revision_id
      )
  ) THEN RAISE EXCEPTION 'Current preview evidence is required before publication reversion'; END IF;
  IF v_target_author_id = p_actor_id THEN RAISE EXCEPTION 'A different attorney or administrator must revert this revision'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clause_id::text, 0));
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

CREATE OR REPLACE FUNCTION public.upsert_matter_estate_clause_override(
  p_matter_id uuid,
  p_clause_id uuid,
  p_expected_current_revision_id uuid,
  p_action text,
  p_reason text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_revision_id uuid;
  v_condition_field text;
  v_override public.matter_estate_clause_overrides%ROWTYPE;
BEGIN
  IF p_action NOT IN ('force_include', 'force_omit') THEN
    RAISE EXCEPTION 'Invalid estate clause override action';
  END IF;
  IF length(pg_catalog.btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Estate clause override reason must be at least 10 characters';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.matters m WHERE m.id = p_matter_id) THEN
    RAISE EXCEPTION 'Matter not found';
  END IF;

  SELECT p.current_revision_id, r.condition_field
  INTO v_current_revision_id, v_condition_field
  FROM public.estate_clause_publications p
  JOIN public.estate_clause_revisions r
    ON r.id = p.current_revision_id AND r.clause_id = p.clause_id
  JOIN public.estate_clauses c ON c.id = p.clause_id
  WHERE p.clause_id = p_clause_id
    AND c.is_active
  FOR UPDATE OF p;

  IF NOT FOUND OR v_condition_field IS NULL OR length(pg_catalog.btrim(v_condition_field)) = 0 THEN
    RAISE EXCEPTION 'Estate clause is not a current active conditional publication';
  END IF;
  IF v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id THEN
    RAISE EXCEPTION 'Current estate clause revision changed; refresh and try again';
  END IF;

  INSERT INTO public.matter_estate_clause_overrides (
    matter_id, clause_id, publication_revision_id, event_type, action,
    reason, created_by, supersedes_override_id
  ) VALUES (
    p_matter_id, p_clause_id, v_current_revision_id, 'applied', p_action,
    pg_catalog.btrim(p_reason), p_actor_id,
    (SELECT o.id FROM public.matter_estate_clause_overrides o
     WHERE o.matter_id = p_matter_id AND o.clause_id = p_clause_id
     ORDER BY o.created_at DESC, o.id DESC LIMIT 1)
  )
  RETURNING * INTO v_override;

  RETURN pg_catalog.to_jsonb(v_override);
END;
$$;

CREATE OR REPLACE FUNCTION public.retire_matter_estate_clause_override(
  p_matter_id uuid,
  p_clause_id uuid,
  p_reason text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current public.matter_estate_clause_overrides%ROWTYPE;
  v_retirement public.matter_estate_clause_overrides%ROWTYPE;
BEGIN
  IF length(pg_catalog.btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Estate clause override retirement reason must be at least 10 characters';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_matter_id::text || ':' || p_clause_id::text, 0));
  SELECT o.* INTO v_current
  FROM public.matter_estate_clause_overrides o
  WHERE o.matter_id = p_matter_id AND o.clause_id = p_clause_id
  ORDER BY o.created_at DESC, o.id DESC LIMIT 1;
  IF NOT FOUND OR v_current.event_type <> 'applied' THEN
    RAISE EXCEPTION 'Active estate clause override not found';
  END IF;
  INSERT INTO public.matter_estate_clause_overrides (
    matter_id, clause_id, publication_revision_id, event_type, action,
    reason, created_by, supersedes_override_id
  ) VALUES (
    p_matter_id, p_clause_id, v_current.publication_revision_id, 'retired', NULL,
    pg_catalog.btrim(p_reason), p_actor_id, v_current.id
  ) RETURNING * INTO v_retirement;
  RETURN pg_catalog.to_jsonb(v_retirement);
END;
$$;

CREATE OR REPLACE FUNCTION public.load_estate_clause_generation_snapshot(p_matter_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH publications AS MATERIALIZED (
    SELECT p.clause_id, p.current_revision_id, c.clause_key, c.title,
           c.jurisdiction, c.document_types, r.revision_number, r.clause_text,
           r.required_fields, r.nested_clause_keys, r.condition_field, r.content_hash
    FROM public.estate_clause_publications p
    JOIN public.estate_clauses c ON c.id = p.clause_id AND c.is_active
    JOIN public.estate_clause_revisions r
      ON r.id = p.current_revision_id AND r.clause_id = p.clause_id
  ), latest_override AS MATERIALIZED (
    SELECT DISTINCT ON (o.clause_id) o.*
    FROM public.matter_estate_clause_overrides o
    WHERE o.matter_id = p_matter_id
    ORDER BY o.clause_id, o.created_at DESC, o.id DESC
  )
  SELECT jsonb_build_object(
    'publications', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.clause_key) FROM publications p), '[]'::jsonb),
    'overrides', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'clause_id', o.clause_id, 'clause_key', p.clause_key,
        'publication_revision_id', o.publication_revision_id, 'action', o.action,
        'reason', o.reason, 'created_by', o.created_by, 'created_at', o.created_at
      ) ORDER BY p.clause_key)
      FROM latest_override o JOIN publications p ON p.clause_id = o.clause_id
      WHERE o.event_type = 'applied' AND o.publication_revision_id = p.current_revision_id
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.persist_generated_estate_document(
  p_document jsonb,
  p_manifest jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    matter_id, r2_key, name, size, content_type, folder, uploaded_by,
    generation_id, generation_engine, marker_count, missing_count,
    template_id, template_version_id
  ) VALUES (
    v_matter_id::text,
    p_document->>'r2_key',
    p_document->>'name',
    COALESCE((p_document->>'size')::bigint, 0),
    COALESCE(p_document->>'content_type', 'application/octet-stream'),
    COALESCE(p_document->>'folder', 'draft'),
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
$$;

ALTER TABLE public.estate_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estate_clause_working_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estate_clause_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estate_clause_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estate_clause_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estate_clause_preview_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_estate_clause_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_document_clause_revisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.estate_clauses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.estate_clause_working_drafts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.estate_clause_revisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.estate_clause_review_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.estate_clause_publications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.estate_clause_preview_evidence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.matter_estate_clause_overrides FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.generated_document_clause_revisions FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.estate_clauses TO authenticated;
GRANT SELECT ON public.estate_clause_working_drafts TO authenticated;
GRANT SELECT ON public.estate_clause_revisions TO authenticated;
GRANT SELECT ON public.estate_clause_review_events TO authenticated;
GRANT SELECT ON public.estate_clause_publications TO authenticated;
GRANT SELECT ON public.estate_clause_preview_evidence TO authenticated;
GRANT SELECT ON public.matter_estate_clause_overrides TO authenticated;
GRANT SELECT ON public.generated_document_clause_revisions TO authenticated;

GRANT ALL ON public.estate_clauses TO service_role;
GRANT ALL ON public.estate_clause_working_drafts TO service_role;
GRANT ALL ON public.estate_clause_revisions TO service_role;
GRANT ALL ON public.estate_clause_review_events TO service_role;
GRANT ALL ON public.estate_clause_publications TO service_role;
GRANT ALL ON public.estate_clause_preview_evidence TO service_role;
GRANT ALL ON public.matter_estate_clause_overrides TO service_role;
GRANT ALL ON public.generated_document_clause_revisions TO service_role;

CREATE POLICY estate_clauses_staff_read
  ON public.estate_clauses FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin', 'va', 'staff')
  ));

CREATE POLICY estate_clause_publications_staff_read
  ON public.estate_clause_publications FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin', 'va', 'staff')
  ));

CREATE POLICY estate_clause_revisions_authorized_read
  ON public.estate_clause_revisions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.estate_clause_publications p ON p.current_revision_id = estate_clause_revisions.id
      WHERE u.id = auth.uid() AND u.role IN ('va', 'staff')
    )
  );

CREATE POLICY estate_clause_drafts_attorney_read
  ON public.estate_clause_working_drafts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
  ));

CREATE POLICY estate_clause_review_events_attorney_read
  ON public.estate_clause_review_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
  ));

CREATE POLICY estate_clause_preview_evidence_attorney_read
  ON public.estate_clause_preview_evidence FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
  ));

CREATE POLICY matter_estate_clause_overrides_attorney_read
  ON public.matter_estate_clause_overrides FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
  ));

CREATE POLICY generated_document_clause_revisions_staff_read
  ON public.generated_document_clause_revisions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin', 'va', 'staff')
  ));

REVOKE ALL ON FUNCTION public.submit_estate_clause_revision(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_estate_clause_changes(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_estate_clause_revision(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_estate_clause_preview(uuid, text, text[], jsonb, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retire_estate_clause_publication(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revert_estate_clause_publication(uuid, uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_matter_estate_clause_override(uuid, uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retire_matter_estate_clause_override(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.load_estate_clause_generation_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_generated_estate_document(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_estate_clause_revision(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_estate_clause_changes(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_estate_clause_revision(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_estate_clause_preview(uuid, text, text[], jsonb, uuid, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.retire_estate_clause_publication(uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_estate_clause_publication(uuid, uuid, uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_matter_estate_clause_override(uuid, uuid, uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.retire_matter_estate_clause_override(uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.load_estate_clause_generation_snapshot(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_generated_estate_document(jsonb, jsonb) TO service_role;
