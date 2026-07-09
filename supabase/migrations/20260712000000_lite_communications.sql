-- Phase 5 communications: SMS, calls (Twilio/Retell), calendar/Outlook tokens.
-- Matter-scoped only — no leads.

-- ── Phone normalizer ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.normalize_us_phone(value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text;
BEGIN
  IF value IS NULL THEN RETURN NULL; END IF;
  digits := regexp_replace(value, '\D', '', 'g');
  IF length(digits) = 11 AND left(digits, 1) = '1' THEN
    RETURN substr(digits, 2);
  END IF;
  IF length(digits) = 10 THEN
    RETURN digits;
  END IF;
  RETURN NULL;
END;
$$;

-- ── updated_at helper (if missing) ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── sms_messages ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sms_messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id            text,
  direction            text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body                 text NOT NULL,
  status               text NOT NULL DEFAULT 'pending',
  to_number            text,
  from_number          text,
  provider             text NOT NULL DEFAULT 'twilio' CHECK (provider IN ('twilio')),
  provider_message_id  text UNIQUE,
  recipient_role       text NOT NULL DEFAULT 'client'
                         CHECK (recipient_role IN ('client', 'spouse', 'other')),
  recipient_name       text,
  actor_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email          text,
  actor_name           text,
  error                text,
  read_by_staff_at     timestamptz,
  sent_at              timestamptz,
  raw_payload          jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_messages_matter_id_created_at_idx
  ON public.sms_messages (matter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sms_messages_provider_message_id_idx
  ON public.sms_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sms_messages_inbound_unread_idx
  ON public.sms_messages (created_at DESC)
  WHERE direction = 'inbound' AND read_by_staff_at IS NULL;

DROP TRIGGER IF EXISTS sms_messages_updated_at_trg ON public.sms_messages;
CREATE TRIGGER sms_messages_updated_at_trg
BEFORE UPDATE ON public.sms_messages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Matter-only auto-assign by phone (client_intake / contacts — no leads).
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
BEGIN
  participant := CASE
    WHEN NEW.direction = 'inbound' THEN NEW.from_number
    ELSE NEW.to_number
  END;

  digits := public.normalize_us_phone(participant);
  IF digits IS NULL THEN
    RETURN NEW;
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

DROP TRIGGER IF EXISTS sms_messages_autoassign_trg ON public.sms_messages;
CREATE TRIGGER sms_messages_autoassign_trg
BEFORE INSERT ON public.sms_messages
FOR EACH ROW EXECUTE FUNCTION public.sms_messages_autoassign();

REVOKE ALL ON FUNCTION public.sms_messages_autoassign() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sms_messages_autoassign() FROM anon;
REVOKE ALL ON FUNCTION public.sms_messages_autoassign() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sms_messages_autoassign() TO service_role;

ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sms_messages_staff_select ON public.sms_messages;
CREATE POLICY sms_messages_staff_select ON public.sms_messages
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney', 'va', 'staff')
  )
);

DROP POLICY IF EXISTS sms_messages_staff_modify ON public.sms_messages;
CREATE POLICY sms_messages_staff_modify ON public.sms_messages
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney', 'va', 'staff')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney', 'va', 'staff')
  )
);

-- ── calls ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.calls (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id            text,
  external_call_id     text NOT NULL UNIQUE,
  provider             text NOT NULL DEFAULT 'twilio'
                         CHECK (provider IN ('twilio', 'retell')),
  direction            text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status               text NOT NULL,
  from_number          text,
  to_number            text,
  participant_number   text NOT NULL,
  participant_digits   text,
  firm_user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  firm_user_email      text,
  started_at           timestamptz NOT NULL DEFAULT now(),
  answered_at          timestamptz,
  ended_at             timestamptz,
  duration_seconds     integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  recording_url        text,
  voicemail_url        text,
  transcript           text,
  summary              text,
  assigned_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at          timestamptz,
  raw_payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calls_participant_digits_idx ON public.calls (participant_digits);
CREATE INDEX IF NOT EXISTS calls_started_at_idx ON public.calls (started_at DESC);
CREATE INDEX IF NOT EXISTS calls_matter_id_idx ON public.calls (matter_id)
  WHERE matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calls_unassigned_idx ON public.calls (started_at DESC)
  WHERE matter_id IS NULL;

CREATE OR REPLACE FUNCTION public.calls_autoassign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  digits text;
  matched_matter uuid;
BEGIN
  digits := public.normalize_us_phone(NEW.participant_number);
  NEW.participant_digits := digits;

  IF NEW.matter_id IS NULL AND digits IS NOT NULL THEN
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calls_autoassign_trg ON public.calls;
CREATE TRIGGER calls_autoassign_trg
BEFORE INSERT ON public.calls
FOR EACH ROW EXECUTE FUNCTION public.calls_autoassign();

DROP TRIGGER IF EXISTS calls_updated_at_trg ON public.calls;
CREATE TRIGGER calls_updated_at_trg
BEFORE UPDATE ON public.calls
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON FUNCTION public.calls_autoassign() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calls_autoassign() FROM anon;
REVOKE ALL ON FUNCTION public.calls_autoassign() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.calls_autoassign() TO service_role;

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calls_staff_select ON public.calls;
CREATE POLICY calls_staff_select ON public.calls
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney', 'va', 'staff')
  )
);

DROP POLICY IF EXISTS calls_staff_modify ON public.calls;
CREATE POLICY calls_staff_modify ON public.calls
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney', 'va', 'staff')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney', 'va', 'staff')
  )
);

-- ── calendar_connections (per-user Microsoft / Outlook) ─────────────────────

CREATE TABLE IF NOT EXISTS public.calendar_connections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider       text NOT NULL DEFAULT 'microsoft'
                   CHECK (provider IN ('microsoft', 'google')),
  access_token   text NOT NULL,
  refresh_token  text,
  expires_at     timestamptz NOT NULL,
  scopes         text,
  email          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS calendar_connections_user_id_idx
  ON public.calendar_connections (user_id);

DROP TRIGGER IF EXISTS calendar_connections_updated_at_trg ON public.calendar_connections;
CREATE TRIGGER calendar_connections_updated_at_trg
BEFORE UPDATE ON public.calendar_connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;

-- Tokens are managed via service role from server routes only.
DROP POLICY IF EXISTS calendar_connections_service_role ON public.calendar_connections;
CREATE POLICY calendar_connections_service_role ON public.calendar_connections
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ── email_settings / email_log (optional simple) ────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_settings (
  category   text PRIMARY KEY,
  mode       text NOT NULL DEFAULT 'on' CHECK (mode IN ('on', 'off', 'redirect')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.email_settings (category, mode) VALUES
  ('manual', 'on'),
  ('message_alert', 'on'),
  ('portal_message_notice', 'on'),
  ('intake_complete_alert', 'on'),
  ('intake_invite', 'on')
ON CONFLICT (category) DO NOTHING;

ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_settings_staff_select ON public.email_settings;
CREATE POLICY email_settings_staff_select ON public.email_settings
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney')
  )
);

CREATE TABLE IF NOT EXISTS public.email_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category     text,
  status       text NOT NULL DEFAULT 'sent',
  intended_to  text,
  actual_to    text,
  subject      text,
  matter_id    text,
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_log_created_at_idx
  ON public.email_log (created_at DESC);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_log_staff_select ON public.email_log;
CREATE POLICY email_log_staff_select ON public.email_log
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'attorney')
  )
);

-- ── matter_activity: sms_sent / sms_received ────────────────────────────────

ALTER TABLE public.matter_activity
  DROP CONSTRAINT IF EXISTS matter_activity_event_type_check;

ALTER TABLE public.matter_activity
  ADD CONSTRAINT matter_activity_event_type_check CHECK (
    event_type IN (
      'stage_changed', 'note_added', 'document_uploaded', 'document_viewed',
      'document_downloaded', 'task_created', 'task_completed', 'flag_added', 'flag_removed',
      'alert_created', 'alert_resolved', 'intake_sent', 'intake_completed',
      'email_sent', 'sms_sent', 'sms_received', 'draft_generated', 'draft_promoted_to_review',
      'matter_created', 'matter_archived', 'status_changed'
    )
  );
