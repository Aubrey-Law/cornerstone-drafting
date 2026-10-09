-- Created by `supabase migration new`; ordered after the future-dated builder
-- foundation/audit migrations. Rollout is OFF until a separate activation.
CREATE SCHEMA IF NOT EXISTS intake_private;
REVOKE ALL ON SCHEMA intake_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE intake_private.form_pinning_rollout (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE intake_private.form_pinning_rollout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON intake_private.form_pinning_rollout FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO intake_private.form_pinning_rollout (enabled) VALUES (false);

-- Definer is necessary for client-originated inserts to consult the private
-- rollout and form catalogs. This trigger grants no ability to write answers
-- or bypass client_intake's own RLS, and cannot be called as a public RPC.
CREATE FUNCTION intake_private.guard_intake_form_pin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_enabled boolean;
  v_template_id uuid;
  v_version_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.form_version_id IS DISTINCT FROM OLD.form_version_id THEN
      RAISE EXCEPTION 'An intake questionnaire version cannot be changed' USING ERRCODE = '23514';
    END IF;
    IF OLD.form_version_id IS NOT NULL AND NEW.intake_track IS DISTINCT FROM OLD.intake_track THEN
      RAISE EXCEPTION 'A pinned intake questionnaire track cannot be changed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.form_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'Intake questionnaire versions are assigned by the database' USING ERRCODE = '23514';
  END IF;
  SELECT enabled INTO v_enabled FROM intake_private.form_pinning_rollout
    WHERE singleton FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Intake questionnaire rollout configuration is unavailable'; END IF;
  IF NOT v_enabled THEN RETURN NEW; END IF;

  SELECT id INTO v_template_id FROM public.intake_form_templates WHERE key = NEW.intake_track AND purpose = 'client_intake';
  IF NOT FOUND THEN RAISE EXCEPTION 'No published questionnaire is available for this intake track'; END IF;
  -- Same transaction lock used by publish/retire/archive. Row locks also
  -- protect against direct catalog writes through service_role.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_template_id::text, 0));
  PERFORM 1 FROM public.intake_form_templates
    WHERE id = v_template_id AND key = NEW.intake_track AND purpose = 'client_intake' AND archived_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No published questionnaire is available for this intake track'; END IF;
  SELECT id INTO v_version_id FROM public.intake_form_versions
    WHERE template_id = v_template_id AND status = 'published'
    ORDER BY version DESC LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No published questionnaire is available for this intake track'; END IF;
  NEW.form_version_id := v_version_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION intake_private.guard_intake_form_pin() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER client_intake_form_pin
  BEFORE INSERT OR UPDATE ON public.client_intake
  FOR EACH ROW EXECUTE FUNCTION intake_private.guard_intake_form_pin();
