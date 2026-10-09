-- Multiple forms per matter.
--
-- 1. Linked intakes. A matter keeps exactly one primary intake
--    (matters.client_intake_id — the household that drafting reads) and may now
--    carry further client_intake rows, each a full questionnaire for another
--    person with its own track, link, status and lock. The motivating case is a
--    College Prep package for a student alongside the parents' estate plan: the
--    college questionnaire treats the student as "the client", so it cannot
--    share the parents' row without overwriting their names.
--
--    Linked rows are created with lead_status NULL so ensure_lead_matter() does
--    not give them an opportunity of their own.
--
-- 2. Client forms. A third builder purpose, 'client_form', holds only custom
--    questions. Sending one to a matter creates a client_form_assignments row
--    pinned to the published version; answers stay on that row and are never
--    copied into canonical intake columns.

ALTER TABLE public.intake_form_templates DROP CONSTRAINT IF EXISTS intake_form_templates_purpose_check;
ALTER TABLE public.intake_form_templates ADD CONSTRAINT intake_form_templates_purpose_check
  CHECK (purpose IN ('client_intake', 'discovery_call', 'client_form'));

CREATE TABLE public.matter_linked_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  -- An intake is linked to at most one matter; unlinking deletes this row only.
  client_intake_id uuid NOT NULL UNIQUE REFERENCES public.client_intake(id) ON DELETE CASCADE,
  label text CHECK (label IS NULL OR length(label) <= 160),
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matter_linked_intakes_matter ON public.matter_linked_intakes(matter_id, created_at);

CREATE FUNCTION public.guard_matter_linked_intake() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- A primary intake already belongs to its own matter; linking it elsewhere
  -- would let two matters edit one household.
  IF EXISTS (SELECT 1 FROM public.matters WHERE client_intake_id = NEW.client_intake_id) THEN
    RAISE EXCEPTION 'A matter''s primary intake cannot be linked to another matter' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER matter_linked_intake_guard BEFORE INSERT OR UPDATE ON public.matter_linked_intakes
  FOR EACH ROW EXECUTE FUNCTION public.guard_matter_linked_intake();

CREATE TABLE public.client_form_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  -- The portal owner who fills it in: the matter's primary intake or a linked one.
  client_intake_id uuid NOT NULL REFERENCES public.client_intake(id) ON DELETE CASCADE,
  form_version_id uuid NOT NULL REFERENCES public.intake_form_versions(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'in_progress', 'submitted', 'cancelled')),
  answers jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object'),
  revision integer NOT NULL DEFAULT 0,
  sent_by uuid REFERENCES public.users(id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'submitted') = (submitted_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE INDEX client_form_assignments_matter ON public.client_form_assignments(matter_id, sent_at DESC);
CREATE INDEX client_form_assignments_intake ON public.client_form_assignments(client_intake_id, sent_at DESC);

CREATE FUNCTION public.guard_client_form_assignment() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.intake_form_versions v JOIN public.intake_form_templates t ON t.id = v.template_id
      WHERE v.id = NEW.form_version_id AND v.status = 'published' AND t.purpose = 'client_form' AND t.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Client form unavailable' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.matters WHERE id = NEW.matter_id AND client_intake_id = NEW.client_intake_id)
       AND NOT EXISTS (SELECT 1 FROM public.matter_linked_intakes WHERE matter_id = NEW.matter_id AND client_intake_id = NEW.client_intake_id) THEN
      RAISE EXCEPTION 'Recipient is not on this matter' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.matter_id <> OLD.matter_id OR NEW.client_intake_id <> OLD.client_intake_id OR NEW.form_version_id <> OLD.form_version_id THEN
    RAISE EXCEPTION 'Form assignment identity is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER client_form_assignment_guard BEFORE INSERT OR UPDATE ON public.client_form_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_form_assignment();

-- Server routes are the only way in: staff via requireAdmin, clients via an
-- ownership check on client_intake before any read or write.
ALTER TABLE public.matter_linked_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_form_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.matter_linked_intakes, public.client_form_assignments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.matter_linked_intakes, public.client_form_assignments TO service_role;
REVOKE ALL ON FUNCTION public.guard_matter_linked_intake() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_client_form_assignment() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
