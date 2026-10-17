-- Calendar + appointment scheduling schema, consolidated from Cornerstone's
-- migrations (20260712 … 20271016) into the final state the extracted code
-- expects. Apply as one migration in the new app.
--
-- Prerequisites the code assumes:
--   * Supabase (auth.users, service_role, PostgREST).
--   * public.users (id uuid = auth.users.id, role text). Staff are rows with
--     role in ('attorney', 'admin'); RLS below and lib/apiAuth.ts read it.
--     Rename the roles here and in lib/apiAuth.ts if your app uses others.
--
-- All scheduling writes go through the service-role client on the server, so
-- RLS only grants staff read access. Clients never touch these tables directly.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ── scheduling_settings (singleton row id = 1) ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.scheduling_settings (
  id                     integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  timezone               text NOT NULL DEFAULT 'America/New_York',
  -- {"mon":[{"start":"09:00","end":"17:00"}], ..., "sat":[], "sun":[]}
  weekly_hours           jsonb NOT NULL DEFAULT '{
    "mon": [{"start": "09:00", "end": "17:00"}],
    "tue": [{"start": "09:00", "end": "17:00"}],
    "wed": [{"start": "09:00", "end": "17:00"}],
    "thu": [{"start": "09:00", "end": "17:00"}],
    "fri": [{"start": "09:00", "end": "17:00"}],
    "sat": [],
    "sun": []
  }'::jsonb,
  min_notice_hours       integer NOT NULL DEFAULT 24 CHECK (min_notice_hours >= 0),
  horizon_days           integer NOT NULL DEFAULT 30 CHECK (horizon_days BETWEEN 1 AND 365),
  buffer_minutes         integer NOT NULL DEFAULT 15 CHECK (buffer_minutes >= 0),
  -- 0 disables reminder emails.
  reminder_hours_before  integer NOT NULL DEFAULT 24,
  -- Pauses client-facing booking only; staff can still book.
  booking_paused         boolean NOT NULL DEFAULT false,
  sms_reminders_enabled  boolean NOT NULL DEFAULT false,
  -- Cornerstone: send the intake questionnaire when a lead books. Host hook.
  auto_intake_invite     boolean NOT NULL DEFAULT true,
  -- {"2026-12-24": [] (closed) | [{"start":"09:00","end":"12:00"}]}
  date_overrides         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Optional external booking page per appointment-type key.
  calendly_urls          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Google calendar ids hidden from the admin calendar (primary never hidden).
  hidden_calendar_ids    text[] NOT NULL DEFAULT '{}',
  -- Google calendar ids that block booking, in addition to primary. An error
  -- reading any of them fails availability closed.
  blocking_calendar_ids  text[] NOT NULL DEFAULT '{}',
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.scheduling_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view scheduling settings" ON public.scheduling_settings;
CREATE POLICY "Staff can view scheduling settings"
  ON public.scheduling_settings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

INSERT INTO public.scheduling_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── appointment_types ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.appointment_types (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable code key. lib/scheduling.ts MeetingTypeKey and a few branches in
  -- lib/appointments/book.ts / automation.ts key off these values.
  key                  text NOT NULL UNIQUE,
  -- Public URL segment: /book/[slug]
  slug                 text NOT NULL UNIQUE,
  label                text NOT NULL,
  description          text NOT NULL DEFAULT '',
  duration_minutes     integer NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  -- Default format; mirrors location_types[1].
  location_type        text NOT NULL DEFAULT 'phone' CHECK (location_type IN ('phone', 'teams', 'in_person')),
  -- Formats the booker may choose from ('teams' = virtual meeting link).
  location_types       text[] NOT NULL DEFAULT '{phone}'
    CONSTRAINT appointment_types_location_types_check
    CHECK (location_types <@ ARRAY['phone', 'teams', 'in_person'] AND array_length(location_types, 1) >= 1),
  -- NULL falls back to scheduling_settings.weekly_hours.
  custom_weekly_hours  jsonb,
  -- [{id, label, kind: short_text|long_text|choice|yes_no, required, options}]
  booking_questions    jsonb NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT appointment_types_booking_questions_array_check
    CHECK (jsonb_typeof(booking_questions) = 'array'),
  active               boolean NOT NULL DEFAULT true,
  -- true = bookable anonymously at /book/[slug]; false = portal/staff only.
  public               boolean NOT NULL DEFAULT false,
  sort                 integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.appointment_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view appointment types" ON public.appointment_types;
CREATE POLICY "Staff can view appointment types"
  ON public.appointment_types FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

DROP TRIGGER IF EXISTS appointment_types_updated_at_trg ON public.appointment_types;
CREATE TRIGGER appointment_types_updated_at_trg
  BEFORE UPDATE ON public.appointment_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Cornerstone's five types. Keep the keys (code references them) and change
-- slug/label/description/duration/formats to suit the new app.
INSERT INTO public.appointment_types
  (key, slug, label, description, duration_minutes, location_type, location_types, active, public, sort)
VALUES
  ('discovery_call',      'discovery-call',      'Discovery Call',      'A first call to learn about your goals.', 30, 'phone',     ARRAY['phone'],                     true, true,  1),
  ('pmps',                'planning-session',    'Planning Session',    'The main design session.',                90, 'in_person', ARRAY['in_person','teams','phone'], true, false, 2),
  ('draft_review',        'draft-review',        'Draft Review',        'Review drafts and decisions.',            60, 'teams',     ARRAY['teams','phone'],             true, false, 3),
  ('client_call',         'client-call',         'Client Call',         'A call with an existing client.',         30, 'phone',     ARRAY['phone','teams'],             true, false, 4),
  ('signing_appointment', 'signing-appointment', 'Signing Appointment', 'The execution meeting.',                  60, 'in_person', ARRAY['in_person'],                 true, false, 5)
ON CONFLICT (key) DO NOTHING;

-- ── appointments ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.appointments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_type_id         uuid NOT NULL REFERENCES public.appointment_types(id),
  start_time                  timestamptz NOT NULL,
  end_time                    timestamptz NOT NULL CHECK (end_time > start_time),
  status                      text NOT NULL DEFAULT 'scheduled'
    CONSTRAINT appointments_status_check
    CHECK (status IN ('scheduled', 'cancelled', 'rescheduled', 'no_show')),
  -- Chosen format for this booking.
  location_type               text
    CONSTRAINT appointments_location_type_check
    CHECK (location_type IS NULL OR location_type IN ('phone', 'teams', 'in_person')),
  attendee_name               text NOT NULL,
  attendee_first_name         text,
  attendee_last_name          text,
  attendee_email              text NOT NULL,
  attendee_phone              text,
  second_attendee_name        text,
  second_attendee_first_name  text,
  second_attendee_last_name   text,
  second_attendee_email       text,
  notes                       text,
  -- [{questionId, label, answer}] snapshotted at booking time.
  booking_answers             jsonb NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT appointments_booking_answers_array_check
    CHECK (jsonb_typeof(booking_answers) = 'array'),
  -- Cornerstone FKs to client_intake / matters. Point these at your own
  -- customer/project tables (add the FK), or leave them as loose ids.
  linked_lead_id              uuid,
  linked_matter_id            uuid,
  booked_by_user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Calendar + meeting links.
  google_event_id             text,
  online_meeting_url          text,
  online_meeting_provider     text CHECK (online_meeting_provider IN ('google_meet', 'microsoft_teams')),
  teams_meeting_id            text,
  -- Self-service manage link (/book/manage/[token]); only the hash is stored.
  manage_token_hash           text,
  manage_token_expires_at     timestamptz,
  reminder_sent_at            timestamptz,
  source                      text NOT NULL DEFAULT 'public'
    CONSTRAINT appointments_source_check
    CHECK (source IN ('public', 'portal', 'admin', 'calendly', 'calcom', 'lawmatics')),
  -- Provider booking id when the row mirrors an external scheduler.
  external_booking_uid        text,
  -- Free-form metadata. raw->>'staffOverlapConfirmed' = 'true' lets staff
  -- knowingly double-book (see the exclusion constraint).
  raw                         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_source_external_booking_uid_key UNIQUE (source, external_booking_uid),
  -- Final race guard against double-booking (one calendar). External mirrors
  -- and staff-confirmed overlaps are exempt.
  CONSTRAINT appointments_no_overlap EXCLUDE USING gist
    (tstzrange(start_time, end_time) WITH &&)
    WHERE (
      status = 'scheduled'
      AND source IN ('public', 'portal', 'admin')
      AND coalesce(raw ->> 'staffOverlapConfirmed', 'false') <> 'true'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS appointments_manage_token_hash_idx
  ON public.appointments (manage_token_hash) WHERE manage_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointments_start_time_idx ON public.appointments (start_time);
CREATE INDEX IF NOT EXISTS appointments_attendee_email_idx ON public.appointments (lower(attendee_email));
CREATE INDEX IF NOT EXISTS appointments_linked_lead_idx
  ON public.appointments (linked_lead_id) WHERE linked_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointments_linked_matter_idx
  ON public.appointments (linked_matter_id) WHERE linked_matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_due
  ON public.appointments (start_time) WHERE status = 'scheduled' AND reminder_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS appointments_google_event_id_idx
  ON public.appointments (google_event_id) WHERE google_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointments_external_booking_uid_idx
  ON public.appointments (external_booking_uid) WHERE external_booking_uid IS NOT NULL;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view appointments" ON public.appointments;
CREATE POLICY "Staff can view appointments"
  ON public.appointments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

DROP TRIGGER IF EXISTS appointments_updated_at_trg ON public.appointments;
CREATE TRIGGER appointments_updated_at_trg
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── calendar_connections (OAuth tokens, per staff user) ─────────────────────
-- google   = Google Calendar (busy times, events, Meet links)
-- microsoft = Microsoft Graph, used only to create Teams meeting links

CREATE TABLE IF NOT EXISTS public.calendar_connections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider       text NOT NULL DEFAULT 'google'
    CONSTRAINT calendar_connections_provider_check CHECK (provider IN ('google', 'microsoft')),
  access_token   text NOT NULL,
  refresh_token  text,
  expires_at     timestamptz NOT NULL,
  scopes         text,
  email          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS calendar_connections_user_id_idx ON public.calendar_connections (user_id);

DROP TRIGGER IF EXISTS calendar_connections_updated_at_trg ON public.calendar_connections;
CREATE TRIGGER calendar_connections_updated_at_trg
  BEFORE UPDATE ON public.calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_connections_service_role ON public.calendar_connections;
CREATE POLICY calendar_connections_service_role ON public.calendar_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── calendar_attention_dismissals (admin calendar day rail) ─────────────────

CREATE TABLE IF NOT EXISTS public.calendar_attention_dismissals (
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id        text NOT NULL,
  calendar_date  date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id, calendar_date)
);

ALTER TABLE public.calendar_attention_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage own calendar attention dismissals" ON public.calendar_attention_dismissals;
CREATE POLICY "Staff manage own calendar attention dismissals"
  ON public.calendar_attention_dismissals FOR ALL TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

GRANT SELECT, INSERT, DELETE ON public.calendar_attention_dismissals TO authenticated;

-- ── rate_limits (public booking endpoints) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket        text NOT NULL,
  key           text NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON public.rate_limits (window_start);

CREATE OR REPLACE FUNCTION public.rate_limit_consume(p_bucket text, p_key text, p_window_seconds integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_window_start timestamptz;
  v_count        integer;
BEGIN
  v_window_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  INSERT INTO public.rate_limits (bucket, key, window_start, count)
  VALUES (p_bucket, p_key, v_window_start, 1)
  ON CONFLICT (bucket, key, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rate_limit_consume(text, text, integer) TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- ── firm_settings (optional; lib/firmSettings.ts falls back to env vars) ────
-- Supplies the business name, address, phone and email used in confirmation
-- emails and on booking pages, plus the admin calendar's daily workload target.

CREATE TABLE IF NOT EXISTS public.firm_settings (
  id                             integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  firm_name                      text,
  attorney_name                  text,
  attorney_short_name            text,
  email                          text,
  phone                          text,
  street                         text,
  city                           text,
  state                          text,
  zip                            text,
  website                        text,
  calendar_daily_target_minutes  integer NOT NULL DEFAULT 360
    CHECK (calendar_daily_target_minutes BETWEEN 60 AND 720),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.firm_settings ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
