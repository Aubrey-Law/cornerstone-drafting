-- Durable single-source spouse model.
--
-- Spouse data was modelled in two places that had drifted: client_intake.spouse_*
-- columns (read by intake + v_matter_pipeline) and a contacts row with
-- relationship_type='spouse' (read by the drafting view v_placeholder_data).
-- Married clients with intake spouse data but no contacts row rendered a blank
-- spouse in drafting.
--
-- Fix: client_intake.spouse_* stays authoritative; a trigger keeps exactly one
-- spouse contacts row in sync so the drafting view can never go blank again.
-- Name fields are taken from intake; supplemental fields (dob/phone/email/
-- pronoun/prior_names) fill-but-don't-wipe so attorney edits on the contact
-- survive.

-- 1. Collapse any duplicate spouse contacts, keeping the most complete / earliest,
--    and only deleting role-less duplicates (never orphan a fiduciary role).
DELETE FROM public.contacts c
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY client_intake_id
           ORDER BY ((email IS NOT NULL)::int + (phone IS NOT NULL)::int
                     + (date_of_birth IS NOT NULL)::int) DESC,
                    created_at ASC) AS rn
  FROM public.contacts
  WHERE relationship_type = 'spouse'
) ranked
WHERE c.id = ranked.id AND ranked.rn > 1
  AND NOT EXISTS (SELECT 1 FROM public.contact_roles r WHERE r.contact_id = c.id);

-- 2. Enforce one spouse contact per intake.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_one_spouse
  ON public.contacts (client_intake_id)
  WHERE relationship_type = 'spouse';

-- 3. Sync function: upsert/maintain the spouse contacts row from client_intake.
CREATE OR REPLACE FUNCTION public.sync_spouse_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_spouse boolean;
BEGIN
  has_spouse := coalesce(NEW.spouse_first_name,'') <> ''
             OR coalesce(NEW.spouse_last_name,'')  <> '';

  IF has_spouse THEN
    INSERT INTO public.contacts (
      client_intake_id, relationship_type, first_name, middle_name, last_name, suffix,
      preferred_name, prior_names, preferred_pronoun, date_of_birth, is_us_citizen,
      phone, email, source
    ) VALUES (
      NEW.id, 'spouse',
      coalesce(NEW.spouse_first_name,''), NEW.spouse_middle_name,
      coalesce(NEW.spouse_last_name,''), NEW.spouse_suffix,
      NEW.spouse_preferred_name, NEW.spouse_prior_names, NEW.spouse_preferred_pronoun,
      NEW.spouse_date_of_birth, coalesce(NEW.spouse_is_us_citizen, true),
      NEW.spouse_phone, NEW.spouse_email, 'intake_sync'
    )
    ON CONFLICT (client_intake_id) WHERE relationship_type = 'spouse'
    DO UPDATE SET
      first_name        = excluded.first_name,                                   -- name fields: intake wins
      middle_name       = excluded.middle_name,
      last_name         = excluded.last_name,
      suffix            = excluded.suffix,
      preferred_name    = coalesce(excluded.preferred_name,    contacts.preferred_name),    -- supplemental: fill, don't wipe
      prior_names       = coalesce(excluded.prior_names,       contacts.prior_names),
      preferred_pronoun = coalesce(excluded.preferred_pronoun, contacts.preferred_pronoun),
      date_of_birth     = coalesce(excluded.date_of_birth,     contacts.date_of_birth),
      is_us_citizen     = excluded.is_us_citizen,
      phone             = coalesce(excluded.phone,             contacts.phone),
      email             = coalesce(excluded.email,             contacts.email),
      updated_at        = now();
  ELSE
    -- Spouse cleared on intake: drop the auto-managed contact only if it holds no roles.
    DELETE FROM public.contacts c
    WHERE c.client_intake_id = NEW.id
      AND c.relationship_type = 'spouse'
      AND NOT EXISTS (SELECT 1 FROM public.contact_roles r WHERE r.contact_id = c.id);
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Fire only when a spouse field actually changes (or on insert).
DROP TRIGGER IF EXISTS trg_sync_spouse_contact ON public.client_intake;
CREATE TRIGGER trg_sync_spouse_contact
AFTER INSERT OR UPDATE OF
  spouse_first_name, spouse_middle_name, spouse_last_name, spouse_suffix,
  spouse_preferred_name, spouse_prior_names, spouse_preferred_pronoun,
  spouse_date_of_birth, spouse_is_us_citizen, spouse_phone, spouse_email
ON public.client_intake
FOR EACH ROW
EXECUTE FUNCTION public.sync_spouse_contact();
