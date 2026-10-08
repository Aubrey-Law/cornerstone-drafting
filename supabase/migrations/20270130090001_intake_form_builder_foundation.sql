-- Foundation only: no intake creation path pins a version in this slice.
CREATE TABLE public.intake_form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  description text CHECK (description IS NULL OR char_length(description) <= 600),
  archived_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.intake_form_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.intake_form_templates(id),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  definition_hash text NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  created_by uuid NOT NULL REFERENCES public.users(id),
  published_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (template_id, version),
  CHECK ((status = 'draft' AND published_at IS NULL AND published_by IS NULL)
    OR (status IN ('published', 'retired') AND published_at IS NOT NULL AND published_by IS NOT NULL))
);

CREATE UNIQUE INDEX intake_form_versions_one_draft_idx
  ON public.intake_form_versions(template_id) WHERE status = 'draft';

ALTER TABLE public.client_intake
  ADD COLUMN form_version_id uuid REFERENCES public.intake_form_versions(id);

ALTER TABLE public.intake_form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_form_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intake_form_templates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.intake_form_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.intake_form_templates FROM service_role;
REVOKE ALL ON public.intake_form_versions FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intake_form_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intake_form_versions TO service_role;

-- This guard runs even for service_role writes. Only retirement and its timestamp
-- may change after publication; audit metadata and the artifact remain fixed.
CREATE FUNCTION public.guard_intake_form_version_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status IN ('published', 'retired') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Published and retired form versions cannot be deleted';
    END IF;
    IF NEW.definition IS DISTINCT FROM OLD.definition
      OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash
      OR NEW.template_id IS DISTINCT FROM OLD.template_id
      OR NEW.version IS DISTINCT FROM OLD.version
      OR (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM
         (to_jsonb(OLD) - 'status' - 'updated_at') THEN
      RAISE EXCEPTION 'Published and retired form versions are immutable';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
      AND NOT (OLD.status = 'published' AND NEW.status = 'retired') THEN
      RAISE EXCEPTION 'Only published to retired is an allowed version transition';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'Only draft to published is an allowed draft transition';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER intake_form_versions_immutability
  BEFORE UPDATE OR DELETE ON public.intake_form_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_intake_form_version_immutability();
REVOKE ALL ON FUNCTION public.guard_intake_form_version_immutability() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_intake_form_template(
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
  RETURN to_jsonb(v_row) - 'definition';
END;
$$;

CREATE FUNCTION public.save_intake_form_draft(
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
  RETURN to_jsonb(v_row) - 'definition';
END;
$$;

CREATE FUNCTION public.create_next_intake_form_draft(p_actor_id uuid, p_source_version_id uuid)
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
  RETURN to_jsonb(v_row) - 'definition';
END;
$$;

CREATE FUNCTION public.publish_intake_form_draft(
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
  RETURN to_jsonb(v_row) - 'definition';
END;
$$;

CREATE FUNCTION public.retire_intake_form_version(p_actor_id uuid, p_version_id uuid)
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
  RETURN to_jsonb(v_row) - 'definition';
END;
$$;

CREATE FUNCTION public.archive_intake_form_template(p_actor_id uuid, p_template_id uuid, p_archived boolean DEFAULT true)
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
  RETURN to_jsonb(v_row);
END;
$$;

CREATE FUNCTION public.discard_intake_form_draft(p_actor_id uuid, p_version_id uuid, p_expected_lock_version integer)
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
  DELETE FROM public.intake_form_versions
    WHERE id = p_version_id AND status = 'draft' AND lock_version = p_expected_lock_version
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft changed; refresh and try again' USING ERRCODE = '40001'; END IF;
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
GRANT EXECUTE ON FUNCTION public.create_intake_form_template(uuid, text, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_intake_form_draft(uuid, uuid, integer, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_next_intake_form_draft(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_intake_form_draft(uuid, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.retire_intake_form_version(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_intake_form_template(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.discard_intake_form_draft(uuid, uuid, integer) TO service_role;
