-- Draft a linked College Prep questionnaire on a companion matter.
--
-- A student's College Prep questionnaire linked to the parents' estate-plan
-- matter cannot be drafted there: drafting reads only the matter's primary
-- intake. Instead of teaching drafting to target a linked intake, staff open a
-- companion matter whose primary intake IS the student's questionnaire, hired
-- through the normal conversion path. Drafting then works on it unchanged.
--
-- The link row stays on the parents' matter as the cross-link and records the
-- companion it was drafted on. That is the one case where an intake may be a
-- primary on one matter and linked to another: the guard below allows it only
-- when the link names that very matter as its companion, so two unrelated
-- matters still cannot edit one household.

ALTER TABLE public.matter_linked_intakes
  ADD COLUMN companion_matter_id uuid UNIQUE REFERENCES public.matters(id) ON DELETE SET NULL,
  ADD CONSTRAINT matter_linked_intakes_companion_not_self CHECK (companion_matter_id IS NULL OR companion_matter_id <> matter_id);

CREATE OR REPLACE FUNCTION public.guard_matter_linked_intake() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- A primary intake already belongs to its own matter; linking it elsewhere
  -- would let two matters edit one household — unless that matter is the
  -- companion opened from this very link.
  IF EXISTS (
    SELECT 1 FROM public.matters
    WHERE client_intake_id = NEW.client_intake_id AND id IS DISTINCT FROM NEW.companion_matter_id
  ) THEN
    RAISE EXCEPTION 'A matter''s primary intake cannot be linked to another matter' USING ERRCODE = '23514';
  END IF;
  IF NEW.companion_matter_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.matters WHERE id = NEW.companion_matter_id AND client_intake_id = NEW.client_intake_id
  ) THEN
    RAISE EXCEPTION 'A companion matter must be drafted from the linked questionnaire' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_matter_linked_intake() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
