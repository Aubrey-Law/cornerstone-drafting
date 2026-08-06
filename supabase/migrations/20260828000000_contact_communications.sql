-- Reach any contact, not just leads and matter clients.
--
-- Texting and call logging were record-scoped: a message could belong to a
-- matter or a lead, and nothing else. So a trustee, a child, a referring CPA
-- or opposing counsel could be stored in `contacts` but never texted, and a
-- standalone contact had no thread at all.
--
-- Adds `contact_id` to both message tables. A message has exactly one home:
-- when `contact_id` is set it owns the thread, and any inherited
-- `matter_id`/`lead_id` is there only so the matter's tab can still surface a
-- fiduciary's messages. Emitting one row under two thread keys would
-- double-count the inbox's unread and needs-reply totals.

-- ── contact_id ──────────────────────────────────────────────────────────────

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sms_messages_contact_id_created_at_idx
  ON public.sms_messages (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calls_contact_id_idx
  ON public.calls (contact_id)
  WHERE contact_id IS NOT NULL;

-- `calls_single_record_link` (matter_id IS NULL OR lead_id IS NULL) is
-- deliberately left alone — contact_id is orthogonal to that either/or.

-- Contact threads need triage state like any other.
ALTER TABLE public.communication_thread_state
  DROP CONSTRAINT IF EXISTS communication_thread_state_thread_key_check;

ALTER TABLE public.communication_thread_state
  ADD CONSTRAINT communication_thread_state_thread_key_check
  CHECK (thread_key ~ '^(matter|lead|contact):[0-9a-f-]{36}$');

-- Per-contact email drafts and scheduled sends, so composing to one contact
-- doesn't restore a draft written for another.
ALTER TABLE public.email_drafts DROP CONSTRAINT IF EXISTS email_drafts_context_type_check;
ALTER TABLE public.email_drafts
  ADD CONSTRAINT email_drafts_context_type_check
  CHECK (context_type IN ('matter', 'lead', 'contact', 'general'));

ALTER TABLE public.email_drafts DROP CONSTRAINT IF EXISTS email_drafts_context_id_check;
ALTER TABLE public.email_drafts
  ADD CONSTRAINT email_drafts_context_id_check
  CHECK (
    (context_type = 'general' AND context_id IS NULL)
    OR (context_type IN ('matter', 'lead', 'contact') AND context_id IS NOT NULL)
  );

ALTER TABLE public.scheduled_emails DROP CONSTRAINT IF EXISTS scheduled_emails_context_type_check;
ALTER TABLE public.scheduled_emails
  ADD CONSTRAINT scheduled_emails_context_type_check
  CHECK (context_type IN ('matter', 'lead', 'contact', 'general'));

ALTER TABLE public.scheduled_emails DROP CONSTRAINT IF EXISTS scheduled_emails_context_check;
ALTER TABLE public.scheduled_emails
  ADD CONSTRAINT scheduled_emails_context_check
  CHECK (
    (context_type = 'general' AND context_id IS NULL)
    OR (context_type IN ('matter', 'lead', 'contact') AND context_id IS NOT NULL)
  );

-- ── sms_messages_autoassign ─────────────────────────────────────────────────
-- Order of attribution: the person of record (an intake) wins, because that's
-- where the conversation has always lived. Only when the number belongs to no
-- intake do we fall through to `contacts` — and then the message is attributed
-- to that *person*, inheriting their household's matter for filtering.

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
  matched_contact uuid;
  contact_intake uuid;
BEGIN
  participant := CASE
    WHEN NEW.direction = 'inbound' THEN NEW.from_number
    ELSE NEW.to_number
  END;

  digits := public.normalize_us_phone(participant);
  IF digits IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ci.id INTO matched_intake
  FROM public.client_intake ci
  WHERE public.normalize_us_phone(ci.phone) = digits
  ORDER BY ci.created_at DESC
  LIMIT 1;

  IF NEW.lead_id IS NULL AND matched_intake IS NOT NULL THEN
    NEW.lead_id := matched_intake;
  END IF;

  IF NEW.matter_id IS NULL AND matched_intake IS NOT NULL THEN
    SELECT m.id INTO matched_matter
    FROM public.matters m
    WHERE m.client_intake_id = matched_intake
    ORDER BY m.created_at DESC
    LIMIT 1;

    IF matched_matter IS NOT NULL THEN
      NEW.matter_id := matched_matter::text;
    END IF;
  END IF;

  -- Nobody's own number — is it someone we know as a related contact?
  IF NEW.contact_id IS NULL AND matched_intake IS NULL THEN
    SELECT c.id, c.client_intake_id INTO matched_contact, contact_intake
    FROM public.contacts c
    WHERE public.normalize_us_phone(c.phone) = digits
      AND coalesce(c.deceased, false) = false
    ORDER BY c.created_at DESC
    LIMIT 1;

    IF matched_contact IS NOT NULL THEN
      NEW.contact_id := matched_contact;

      -- Inherited for filtering only; contact_id owns the thread.
      IF NEW.matter_id IS NULL AND contact_intake IS NOT NULL THEN
        SELECT m.id INTO matched_matter
        FROM public.matters m
        WHERE m.client_intake_id = contact_intake
        ORDER BY m.created_at DESC
        LIMIT 1;

        IF matched_matter IS NOT NULL THEN
          NEW.matter_id := matched_matter::text;
        END IF;
      END IF;

      IF NEW.lead_id IS NULL THEN
        NEW.lead_id := contact_intake;
      END IF;

      IF NEW.recipient_name IS NULL OR trim(NEW.recipient_name) = '' THEN
        SELECT nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')
        INTO NEW.recipient_name
        FROM public.contacts c
        WHERE c.id = matched_contact;
      END IF;
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

-- ── calls_autoassign ────────────────────────────────────────────────────────
-- Also fixes a live bug: the lead branch required `ci.matter_id IS NULL`, but
-- `20260802000000_unify_leads_matters` backfilled a matter row onto every
-- intake and installed a trigger to keep doing so, making that condition
-- permanently false. Lead calls were landing on the opportunity matter, and
-- `/api/admin/leads/[id]/calls` filters on `lead_id`, so lead call history
-- rendered empty. Lifecycle now comes from `matters.relationship_status`
-- (null means a matter-origin intake predating the lead pipeline — a client).

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
  matched_contact uuid;
  contact_intake uuid;
BEGIN
  digits := public.normalize_us_phone(NEW.participant_number);
  NEW.participant_digits := digits;

  IF digits IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.matter_id IS NULL AND NEW.lead_id IS NULL THEN
    SELECT m.id INTO matched_matter
    FROM public.matters m
    JOIN public.client_intake ci ON ci.id = m.client_intake_id
    WHERE public.normalize_us_phone(ci.phone) = digits
      AND coalesce(m.relationship_status, 'hired') = 'hired'
    ORDER BY m.created_at DESC
    LIMIT 1;

    IF matched_matter IS NOT NULL THEN
      NEW.matter_id := matched_matter::text;
    ELSE
      SELECT ci.id INTO matched_lead
      FROM public.client_intake ci
      LEFT JOIN public.matters m ON m.id = ci.matter_id
      WHERE public.normalize_us_phone(ci.phone) = digits
        AND coalesce(m.relationship_status, 'hired') <> 'hired'
      ORDER BY ci.updated_at DESC
      LIMIT 1;

      IF matched_lead IS NOT NULL THEN
        NEW.lead_id := matched_lead;
      END IF;
    END IF;
  END IF;

  -- A related contact's own number: attribute the call to that person, and
  -- inherit their household record so the matter tab still sees it.
  IF NEW.contact_id IS NULL AND NEW.matter_id IS NULL AND NEW.lead_id IS NULL THEN
    SELECT c.id, c.client_intake_id INTO matched_contact, contact_intake
    FROM public.contacts c
    WHERE public.normalize_us_phone(c.phone) = digits
      AND coalesce(c.deceased, false) = false
    ORDER BY c.created_at DESC
    LIMIT 1;

    IF matched_contact IS NOT NULL THEN
      NEW.contact_id := matched_contact;

      IF contact_intake IS NOT NULL THEN
        SELECT m.id INTO matched_matter
        FROM public.matters m
        WHERE m.client_intake_id = contact_intake
          AND coalesce(m.relationship_status, 'hired') = 'hired'
        ORDER BY m.created_at DESC
        LIMIT 1;

        IF matched_matter IS NOT NULL THEN
          NEW.matter_id := matched_matter::text;
        ELSE
          NEW.lead_id := contact_intake;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

notify pgrst, 'reload schema';
