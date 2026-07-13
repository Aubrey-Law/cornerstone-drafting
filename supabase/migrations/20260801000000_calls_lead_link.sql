-- Calls can belong to either a prospective lead or an opened matter.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.client_intake(id) ON DELETE SET NULL;

ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_single_record_link;

ALTER TABLE public.calls
  ADD CONSTRAINT calls_single_record_link
  CHECK (matter_id IS NULL OR lead_id IS NULL);

CREATE INDEX IF NOT EXISTS calls_lead_id_idx ON public.calls (lead_id)
  WHERE lead_id IS NOT NULL;

DROP INDEX IF EXISTS public.calls_unassigned_idx;
CREATE INDEX calls_unassigned_idx ON public.calls (started_at DESC)
  WHERE matter_id IS NULL AND lead_id IS NULL;

CREATE OR REPLACE FUNCTION public.calls_autoassign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  digits text;
  matched_matter uuid;
  matched_lead uuid;
BEGIN
  digits := public.normalize_us_phone(NEW.participant_number);
  NEW.participant_digits := digits;

  IF NEW.matter_id IS NULL AND NEW.lead_id IS NULL AND digits IS NOT NULL THEN
    SELECT m.id INTO matched_matter
    FROM public.matters m
    JOIN public.client_intake ci ON ci.id = m.client_intake_id
    WHERE public.normalize_us_phone(ci.phone) = digits
    ORDER BY m.created_at DESC
    LIMIT 1;

    IF matched_matter IS NULL THEN
      SELECT m.id INTO matched_matter
      FROM public.contacts c
      JOIN public.matters m ON m.client_intake_id = c.client_intake_id
      WHERE public.normalize_us_phone(c.phone) = digits
      ORDER BY m.created_at DESC
      LIMIT 1;
    END IF;

    IF matched_matter IS NOT NULL THEN
      NEW.matter_id := matched_matter::text;
    ELSE
      SELECT ci.id INTO matched_lead
      FROM public.client_intake ci
      WHERE ci.matter_id IS NULL
        AND public.normalize_us_phone(ci.phone) = digits
      ORDER BY ci.updated_at DESC
      LIMIT 1;

      IF matched_lead IS NULL THEN
        SELECT ci.id INTO matched_lead
        FROM public.contacts c
        JOIN public.client_intake ci ON ci.id = c.client_intake_id
        WHERE ci.matter_id IS NULL
          AND public.normalize_us_phone(c.phone) = digits
        ORDER BY ci.updated_at DESC
        LIMIT 1;
      END IF;

      IF matched_lead IS NOT NULL THEN
        NEW.lead_id := matched_lead;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.calls.lead_id IS
  'Prospective-client record linked to this call; mutually exclusive with matter_id.';
