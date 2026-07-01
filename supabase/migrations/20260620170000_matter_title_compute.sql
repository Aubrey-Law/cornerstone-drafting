-- Derived matter titles.
--
-- EP / EP-LP matters get a title of the form:
--   "LastName, FirstName & SpouseFirstName - PlanType"   (married, spouse present)
--   "LastName, FirstName - PlanType"                     (single)
-- The " - PlanType" suffix is omitted when plan_type is unknown (TBD/N/A/legacy).
-- Probate matters are LEFT UNTOUCHED (TODO: "Estate of [Decedent]").
--
-- The title is fully derived: a function computes it, triggers on the source
-- tables (matters insert, client_intake, spouse contacts, matter_details
-- plan_type) keep matters.name in sync, so every reader of matters.name stays
-- correct without code changes.

-- 1. Compute the title for one matter. Returns matters.name unchanged for
--    Probate (and as the fallback) so callers/triggers never blank a name.
CREATE OR REPLACE FUNCTION public.compute_matter_title(p_matter_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_current_name text;
  v_client_name  text;
  v_intake_id    uuid;
  v_area_raw     text;
  v_area         text;
  v_plan         text;
  v_first        text;
  v_last         text;
  v_marital      text;
  v_spouse_first text;
  v_title        text;
BEGIN
  SELECT m.name, m.client_name, m.client_intake_id
    INTO v_current_name, v_client_name, v_intake_id
  FROM public.matters m
  WHERE m.id = p_matter_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT md.practice_area, md.plan_type
    INTO v_area_raw, v_plan
  FROM public.matter_details md
  WHERE md.client_id = p_matter_id;

  -- No matter_details row yet (e.g. the matters AFTER INSERT trigger fires
  -- inside lead conversion before the RPC writes matter_details): we can't
  -- classify the practice area, so leave the name untouched until the
  -- matter_details insert fires its own recompute. This also prevents a probate
  -- matter from being briefly mislabeled with the EP default.
  IF NOT FOUND THEN
    RETURN v_current_name;
  END IF;

  -- Normalize practice area (mirrors lib/practiceArea.ts).
  v_area := CASE
    WHEN v_area_raw IN ('EP', 'EP-LP', 'Probate') THEN v_area_raw
    WHEN v_area_raw = 'Estate Planning' THEN 'EP'
    WHEN v_area_raw IN ('Estate Planning (LP)', 'Estate Planning | LP', 'Estate Planning-LP') THEN 'EP-LP'
    WHEN v_area_raw = 'Probate (LP)' THEN 'Probate'
    ELSE 'EP'
  END;

  -- Probate: deferred — leave the existing name in place.
  IF v_area = 'Probate' THEN
    RETURN v_current_name;
  END IF;

  -- Name parts: prefer client_intake; fall back to parsing matters.client_name.
  IF v_intake_id IS NOT NULL THEN
    SELECT ci.first_name, ci.last_name, ci.marital_status
      INTO v_first, v_last, v_marital
    FROM public.client_intake ci
    WHERE ci.id = v_intake_id;
  END IF;

  IF COALESCE(v_first, '') = '' AND COALESCE(v_last, '') = '' AND COALESCE(v_client_name, '') <> '' THEN
    v_last  := (regexp_match(btrim(v_client_name), '(\S+)\s*$'))[1];
    v_first := btrim(regexp_replace(btrim(v_client_name), '\s*\S+\s*$', ''));
  END IF;

  -- Spouse first name only when married and a spouse contact exists.
  IF v_intake_id IS NOT NULL AND lower(COALESCE(v_marital, '')) = 'married' THEN
    SELECT c.first_name
      INTO v_spouse_first
    FROM public.contacts c
    WHERE c.client_intake_id = v_intake_id
      AND c.relationship_type = 'spouse'
    LIMIT 1;
  END IF;

  -- Build "Last, First [& Spouse]".
  IF COALESCE(btrim(v_last), '') <> '' THEN
    v_title := btrim(v_last);
    IF COALESCE(btrim(v_first), '') <> '' THEN
      v_title := v_title || ', ' || btrim(v_first);
    END IF;
  ELSE
    v_title := COALESCE(NULLIF(btrim(v_first), ''), 'Client');
  END IF;

  IF COALESCE(btrim(v_spouse_first), '') <> '' THEN
    v_title := v_title || ' & ' || btrim(v_spouse_first);
  END IF;

  -- Plan-type suffix (mirrors lib/matterPlanType.ts: only real plan types show).
  IF v_plan IN ('Will Plan', 'Trust Plan') THEN
    v_title := v_title || ' - ' || v_plan;
  END IF;

  RETURN v_title;
END;
$$;

-- 2. Refresh matters.name for one matter. UPDATE-only (no insert), and there is
--    deliberately NO AFTER UPDATE trigger on matters, so this never recurses.
CREATE OR REPLACE FUNCTION public.refresh_matter_title(p_matter_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.matters m
     SET name = public.compute_matter_title(m.id)
   WHERE m.id = p_matter_id
     AND m.name IS DISTINCT FROM public.compute_matter_title(m.id);
END;
$$;

-- 3a. matters: recompute on INSERT only (converts the RPC's interim name to the
--     new format). No UPDATE trigger -> refresh_matter_title can't recurse.
CREATE OR REPLACE FUNCTION public.trg_matter_title_on_matter()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.refresh_matter_title(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_matter_title_on_matter ON public.matters;
CREATE TRIGGER trg_matter_title_on_matter
AFTER INSERT ON public.matters
FOR EACH ROW EXECUTE FUNCTION public.trg_matter_title_on_matter();

-- 3b. client_intake: recompute every matter linked to this intake when a name
--     or marital-status field changes (or on insert).
CREATE OR REPLACE FUNCTION public.trg_matter_title_on_intake()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.matters WHERE client_intake_id = NEW.id LOOP
    PERFORM public.refresh_matter_title(r.id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_matter_title_on_intake ON public.client_intake;
CREATE TRIGGER trg_matter_title_on_intake
AFTER INSERT OR UPDATE OF first_name, last_name, marital_status ON public.client_intake
FOR EACH ROW EXECUTE FUNCTION public.trg_matter_title_on_intake();

-- 3c. contacts (spouse): recompute when the spouse row is added/changed/removed.
CREATE OR REPLACE FUNCTION public.trg_matter_title_on_spouse()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_intake_id uuid;
  r record;
BEGIN
  v_intake_id := COALESCE(NEW.client_intake_id, OLD.client_intake_id);
  IF COALESCE(NEW.relationship_type, OLD.relationship_type) <> 'spouse' THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT id FROM public.matters WHERE client_intake_id = v_intake_id LOOP
    PERFORM public.refresh_matter_title(r.id);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_matter_title_on_spouse ON public.contacts;
CREATE TRIGGER trg_matter_title_on_spouse
AFTER INSERT OR UPDATE OR DELETE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.trg_matter_title_on_spouse();

-- 3d. matter_details: recompute when plan_type or practice_area changes.
CREATE OR REPLACE FUNCTION public.trg_matter_title_on_details()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.refresh_matter_title(NEW.client_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_matter_title_on_details ON public.matter_details;
CREATE TRIGGER trg_matter_title_on_details
AFTER INSERT OR UPDATE OF plan_type, practice_area ON public.matter_details
FOR EACH ROW EXECUTE FUNCTION public.trg_matter_title_on_details();

-- 4. One-time backfill: recompute all titles. compute_matter_title returns the
--    current name for Probate, so the DISTINCT guard skips probate rows.
UPDATE public.matters m
   SET name = public.compute_matter_title(m.id)
 WHERE m.name IS DISTINCT FROM public.compute_matter_title(m.id);
