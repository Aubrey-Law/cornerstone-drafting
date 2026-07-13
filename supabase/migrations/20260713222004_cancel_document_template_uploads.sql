-- Cancel unpublished template uploads without losing their audit history.

ALTER TABLE public.document_template_versions
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_by uuid REFERENCES public.users(id);

ALTER TABLE public.document_template_versions
  DROP CONSTRAINT IF EXISTS document_template_versions_validation_status_check;

ALTER TABLE public.document_template_versions
  ADD CONSTRAINT document_template_versions_validation_status_check
  CHECK (validation_status IN ('pending', 'valid', 'invalid', 'canceled'));

ALTER TABLE public.document_template_versions
  DROP CONSTRAINT IF EXISTS document_template_versions_template_id_sha256_key;

CREATE UNIQUE INDEX IF NOT EXISTS document_template_versions_live_hash_idx
  ON public.document_template_versions (template_id, sha256)
  WHERE validation_status <> 'canceled';

ALTER TABLE public.document_template_events
  DROP CONSTRAINT IF EXISTS document_template_events_event_type_check;

ALTER TABLE public.document_template_events
  ADD CONSTRAINT document_template_events_event_type_check
  CHECK (event_type IN (
    'uploaded', 'validated', 'validation_failed', 'published', 'rolled_back', 'canceled'
  ));

CREATE OR REPLACE FUNCTION public.cancel_document_template_version(
  p_template_id text,
  p_version_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version public.document_template_versions%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_template_id, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrator role required';
  END IF;

  SELECT * INTO v_version
  FROM public.document_template_versions v
  WHERE v.id = p_version_id AND v.template_id = p_template_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Template version not found'; END IF;
  IF v_version.validation_status = 'canceled' THEN
    RAISE EXCEPTION 'Template version is already canceled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.document_template_publications p
    WHERE p.template_id = p_template_id AND p.version_id = p_version_id
  ) THEN
    RAISE EXCEPTION 'The active template version cannot be canceled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.document_template_events e
    WHERE e.template_id = p_template_id
      AND e.version_id = p_version_id
      AND e.event_type IN ('published', 'rolled_back')
  ) THEN
    RAISE EXCEPTION 'A previously published template version cannot be canceled';
  END IF;

  UPDATE public.document_template_versions
  SET validation_status = 'canceled',
      canceled_at = now(),
      canceled_by = p_actor_id
  WHERE id = p_version_id;

  INSERT INTO public.document_template_events (
    template_id, version_id, event_type, actor_id, metadata
  ) VALUES (
    p_template_id,
    p_version_id,
    'canceled',
    p_actor_id,
    jsonb_build_object(
      'filename', v_version.original_filename,
      'storagePath', v_version.storage_path,
      'sha256', v_version.sha256
    )
  );

  RETURN jsonb_build_object(
    'templateId', p_template_id,
    'versionId', p_version_id,
    'storagePath', v_version.storage_path
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_document_template_version(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_document_template_version(text, uuid, uuid)
  TO service_role;
