-- Each lifecycle mutation and its success event belong to the same transaction.
CREATE TABLE public.intake_form_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.intake_form_templates(id),
  version_id uuid REFERENCES public.intake_form_versions(id) ON DELETE SET NULL,
  version_number integer CHECK (version_number IS NULL OR version_number > 0),
  action text NOT NULL CHECK (action IN ('create', 'save', 'create_next_draft', 'publish', 'retire', 'archive', 'restore', 'duplicate', 'discard')),
  actor_id uuid NOT NULL REFERENCES public.users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX intake_form_audit_events_template_time_idx
  ON public.intake_form_audit_events(template_id, occurred_at DESC);

ALTER TABLE public.intake_form_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intake_form_audit_events FROM PUBLIC, anon, authenticated;
-- Clear platform default grants before giving the application append-only access.
REVOKE ALL ON public.intake_form_audit_events FROM service_role;
GRANT SELECT, INSERT ON public.intake_form_audit_events TO service_role;

CREATE OR REPLACE FUNCTION public.create_intake_form_template(
  p_actor_id uuid, p_key text, p_name text, p_description text,
  p_definition jsonb, p_definition_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_template_id uuid;
  v_row public.intake_form_versions%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_actor_id AND role = 'admin'
  ) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.intake_form_templates (key, name, description, created_by)
    VALUES (p_key, p_name, p_description, p_actor_id) RETURNING id INTO v_template_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_template_id::text, 0));
  INSERT INTO public.intake_form_versions (template_id, version, status, definition, definition_hash, created_by)
    VALUES (v_template_id, 1, 'draft', p_definition, p_definition_hash, p_actor_id)
    RETURNING * INTO v_row;
  INSERT INTO public.intake_form_audit_events (template_id, version_id, version_number, action, actor_id)
    VALUES (v_row.template_id, v_row.id, v_row.version, 'create', p_actor_id);
  RETURN to_jsonb(v_row) - 'definition';
END;
$$;

CREATE OR REPLACE FUNCTION public.save_intake_form_draft(
  p_actor_id uuid, p_version_id uuid, p_expected_lock_version integer,
  p_definition jsonb, p_definition_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.intake_form_versions%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_actor_id AND role = 'admin'
  ) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  UPDATE public.intake_form_versions
    SET definition = p_definition, definition_hash = p_definition_hash,
        lock_version = lock_version + 1, updated_at = now()
    WHERE id = p_version_id AND status = 'draft' AND lock_version = p_expected_lock_version
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft changed; refresh and try again' USING ERRCODE = '40001'; END IF;
  INSERT INTO public.intake_form_audit_events (template_id, version_id, version_number, action, actor_id)
    VALUES (v_row.template_id, v_row.id, v_row.version, 'save', p_actor_id);
  RETURN to_jsonb(v_row) - 'definition';
END;
$$;

CREATE OR REPLACE FUNCTION public.create_next_intake_form_draft(p_actor_id uuid, p_source_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_source public.intake_form_versions%ROWTYPE;
  v_row public.intake_form_versions%ROWTYPE;
  v_next_version integer;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_actor_id AND role = 'admin'
  ) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_source FROM public.intake_form_versions
    WHERE id = p_source_version_id AND status IN ('published', 'retired');
  IF NOT FOUND THEN RAISE EXCEPTION 'Published or retired source version required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_source.template_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.intake_form_templates WHERE id = v_source.template_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Template is archived';
  END IF;
  IF EXISTS (SELECT 1 FROM public.intake_form_versions WHERE template_id = v_source.template_id AND status = 'draft') THEN
    RAISE EXCEPTION 'Template already has a draft';
  END IF;
  SELECT max(version) + 1 INTO v_next_version FROM public.intake_form_versions WHERE template_id = v_source.template_id;
  INSERT INTO public.intake_form_versions (template_id, version, status, definition, definition_hash, created_by)
    VALUES (v_source.template_id, v_next_version, 'draft', v_source.definition, v_source.definition_hash, p_actor_id)
    RETURNING * INTO v_row;
  INSERT INTO public.intake_form_audit_events (template_id, version_id, version_number, action, actor_id)
    VALUES (v_row.template_id, v_row.id, v_row.version, 'create_next_draft', p_actor_id);
  RETURN to_jsonb(v_row) - 'definition';
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_intake_form_draft(
  p_actor_id uuid, p_version_id uuid, p_expected_lock_version integer, p_expected_definition_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_template_id uuid;
  v_row public.intake_form_versions%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_actor_id AND role = 'admin'
  ) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  SELECT template_id INTO v_template_id FROM public.intake_form_versions WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft changed; refresh and try again' USING ERRCODE = '40001'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_template_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.intake_form_templates WHERE id = v_template_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Template is archived';
  END IF;
  UPDATE public.intake_form_versions
    SET status = 'published', published_by = p_actor_id, published_at = now(), updated_at = now()
    WHERE id = p_version_id AND status = 'draft' AND lock_version = p_expected_lock_version
      AND definition_hash = p_expected_definition_hash
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft changed; refresh and try again' USING ERRCODE = '40001'; END IF;
  INSERT INTO public.intake_form_audit_events (template_id, version_id, version_number, action, actor_id)
    VALUES (v_row.template_id, v_row.id, v_row.version, 'publish', p_actor_id);
  RETURN to_jsonb(v_row) - 'definition';
END;
$$;

CREATE OR REPLACE FUNCTION public.retire_intake_form_version(p_actor_id uuid, p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_template_id uuid;
  v_row public.intake_form_versions%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_actor_id AND role = 'admin'
  ) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  SELECT template_id INTO v_template_id FROM public.intake_form_versions WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Published version required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_template_id::text, 0));
  UPDATE public.intake_form_versions SET status = 'retired', updated_at = now()
    WHERE id = p_version_id AND status = 'published' RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Published version required'; END IF;
  INSERT INTO public.intake_form_audit_events (template_id, version_id, version_number, action, actor_id)
    VALUES (v_row.template_id, v_row.id, v_row.version, 'retire', p_actor_id);
  RETURN to_jsonb(v_row) - 'definition';
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_intake_form_template(p_actor_id uuid, p_template_id uuid, p_archived boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.intake_form_templates%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_actor_id AND role = 'admin'
  ) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  IF p_archived IS NULL THEN RAISE EXCEPTION 'Archive flag is required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_template_id::text, 0));
  UPDATE public.intake_form_templates
    SET archived_at = CASE WHEN p_archived THEN coalesce(archived_at, now()) ELSE NULL END, updated_at = now()
    WHERE id = p_template_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template not found'; END IF;
  INSERT INTO public.intake_form_audit_events (template_id, action, actor_id)
    VALUES (v_row.id, CASE WHEN p_archived THEN 'archive' ELSE 'restore' END, p_actor_id);
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.discard_intake_form_draft(p_actor_id uuid, p_version_id uuid, p_expected_lock_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_template_id uuid;
  v_row public.intake_form_versions%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_actor_id AND role = 'admin'
  ) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  SELECT template_id INTO v_template_id FROM public.intake_form_versions WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft changed; refresh and try again' USING ERRCODE = '40001'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_template_id::text, 0));
  -- Capture the locked draft's number while the version FK still resolves.
  SELECT * INTO v_row FROM public.intake_form_versions
    WHERE id = p_version_id AND status = 'draft' AND lock_version = p_expected_lock_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft changed; refresh and try again' USING ERRCODE = '40001'; END IF;
  INSERT INTO public.intake_form_audit_events (template_id, version_id, version_number, action, actor_id)
    VALUES (v_row.template_id, v_row.id, v_row.version, 'discard', p_actor_id);
  UPDATE public.intake_form_templates SET updated_at = now() WHERE id = v_row.template_id;
  DELETE FROM public.intake_form_versions WHERE id = v_row.id;
  RETURN to_jsonb(v_row) - 'definition';
END;
$$;

CREATE FUNCTION public.duplicate_intake_form_template(
  p_actor_id uuid, p_source_version_id uuid, p_key text, p_name text, p_description text,
  p_expected_lock_version integer, p_expected_definition_hash text,
  p_definition jsonb, p_definition_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_source public.intake_form_versions%ROWTYPE;
  v_template_id uuid;
  v_row public.intake_form_versions%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_actor_id AND role = 'admin'
  ) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_source FROM public.intake_form_versions
    WHERE id = p_source_version_id AND status IN ('draft', 'published', 'retired') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source version required'; END IF;
  IF v_source.lock_version IS DISTINCT FROM p_expected_lock_version
    OR v_source.definition_hash IS DISTINCT FROM p_expected_definition_hash THEN
    RAISE EXCEPTION 'Source changed; refresh and try again' USING ERRCODE = '40001';
  END IF;
  IF p_definition IS NULL OR p_key IS NULL
    OR p_definition->'key' IS DISTINCT FROM to_jsonb(p_key) THEN
    RAISE EXCEPTION 'Definition key must match template key';
  END IF;
  INSERT INTO public.intake_form_templates (key, name, description, created_by)
    VALUES (p_key, p_name, p_description, p_actor_id) RETURNING id INTO v_template_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_template_id::text, 0));
  INSERT INTO public.intake_form_versions (template_id, version, status, definition, definition_hash, created_by)
    VALUES (v_template_id, 1, 'draft', p_definition, p_definition_hash, p_actor_id)
    RETURNING * INTO v_row;
  INSERT INTO public.intake_form_audit_events (template_id, version_id, version_number, action, actor_id, metadata)
    VALUES (v_row.template_id, v_row.id, v_row.version, 'duplicate', p_actor_id,
      jsonb_build_object('source_template_id', v_source.template_id, 'source_version_id', v_source.id));
  RETURN to_jsonb(v_row) - 'definition';
END;
$$;

REVOKE ALL ON FUNCTION public.create_intake_form_template(uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_intake_form_draft(uuid, uuid, integer, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_next_intake_form_draft(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_intake_form_draft(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retire_intake_form_version(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_intake_form_template(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discard_intake_form_draft(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.duplicate_intake_form_template(uuid, uuid, text, text, text, integer, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_intake_form_template(uuid, text, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_intake_form_draft(uuid, uuid, integer, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_next_intake_form_draft(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_intake_form_draft(uuid, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.retire_intake_form_version(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_intake_form_template(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.discard_intake_form_draft(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.duplicate_intake_form_template(uuid, uuid, text, text, text, integer, text, jsonb, text) TO service_role;
