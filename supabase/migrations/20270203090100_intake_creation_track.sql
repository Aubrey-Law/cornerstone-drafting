-- CLI-created migration ordered after the existing future-dated prerequisites.
-- Establish questionnaire identity before the pinning trigger and AFTER INSERT
-- consumers run. Existing rows and UPDATE/upsert-update branches are untouched.
CREATE FUNCTION intake_private.initialize_intake_track()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF nullif(btrim(NEW.practice_area), '') IS NOT NULL THEN
    -- Match parsePracticeArea's College Preparation Plan aliases. The code CP
    -- is case-insensitive; human labels retain the catalog's exact spelling.
    NEW.intake_track := CASE
      WHEN upper(btrim(NEW.practice_area)) = 'CP'
        OR btrim(NEW.practice_area) IN ('College Preparation Plan', 'College Prep', 'College Prep Plan')
      THEN 'college_prep' ELSE 'estate' END;
  ELSE
    NEW.intake_track := coalesce(NEW.intake_track, 'estate');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION intake_private.initialize_intake_track() FROM PUBLIC, anon, authenticated, service_role;

-- PostgreSQL executes same-event row triggers in alphabetical name order.
-- This must precede client_intake_form_pin, including when rollout is disabled.
CREATE TRIGGER client_intake_00_initialize_track
  BEFORE INSERT ON public.client_intake
  FOR EACH ROW EXECUTE FUNCTION intake_private.initialize_intake_track();
