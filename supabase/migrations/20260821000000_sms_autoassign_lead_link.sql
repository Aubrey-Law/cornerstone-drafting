-- Inbound texts were only auto-linked to a matter, so lead SMS threads
-- (which query by lead_id) never showed replies. Match the participant's
-- phone to a client_intake as well, and backfill existing rows.

CREATE OR REPLACE FUNCTION public.sms_messages_autoassign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  participant text;
  digits text;
  matched_matter uuid;
  matched_intake uuid;
BEGIN
  participant := CASE
    WHEN NEW.direction = 'inbound' THEN NEW.from_number
    ELSE NEW.to_number
  END;

  digits := public.normalize_us_phone(participant);
  IF digits IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_id IS NULL THEN
    SELECT ci.id INTO matched_intake
    FROM public.client_intake ci
    WHERE public.normalize_us_phone(ci.phone) = digits
    ORDER BY ci.created_at DESC
    LIMIT 1;

    IF matched_intake IS NOT NULL THEN
      NEW.lead_id := matched_intake;
    END IF;
  END IF;

  IF NEW.matter_id IS NULL THEN
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
    END IF;
  END IF;

  IF (NEW.recipient_name IS NULL OR trim(NEW.recipient_name) = '')
     AND NEW.matter_id IS NOT NULL THEN
    SELECT coalesce(
      nullif(trim(coalesce(ci.first_name, '') || ' ' || coalesce(ci.last_name, '')), ''),
      'Client'
    )
    INTO NEW.recipient_name
    FROM public.matters m
    JOIN public.client_intake ci ON ci.id = m.client_intake_id
    WHERE m.id::text = NEW.matter_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill: link unassigned messages to the intake (and its matter) whose
-- phone matches the outside participant, e.g. replies that arrived before
-- this fix or before the lead record existed.
UPDATE public.sms_messages sm
SET lead_id = (
  SELECT ci.id
  FROM public.client_intake ci
  WHERE public.normalize_us_phone(ci.phone) = public.normalize_us_phone(
    CASE WHEN sm.direction = 'inbound' THEN sm.from_number ELSE sm.to_number END)
  ORDER BY ci.created_at DESC
  LIMIT 1
)
WHERE sm.lead_id IS NULL;

UPDATE public.sms_messages sm
SET matter_id = ci.matter_id::text
FROM public.client_intake ci
WHERE sm.matter_id IS NULL
  AND sm.lead_id = ci.id
  AND ci.matter_id IS NOT NULL;
