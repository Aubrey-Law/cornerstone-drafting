-- Native appointment scheduling (Outlook-backed).
--
-- Clients book through /book/[slug] (public) or /schedule (portal). Slots are
-- app-configured weekly hours minus Outlook busy times; bookings create Graph
-- calendar events. Cal.com integration remains untouched and runs alongside.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── scheduling_settings (singleton) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.scheduling_settings (
  id               integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  timezone         text NOT NULL DEFAULT 'America/New_York',
  -- Per-weekday bookable windows in the firm timezone:
  -- {"mon":[{"start":"09:00","end":"17:00"}], "tue":[...], ...}
  weekly_hours     jsonb NOT NULL DEFAULT '{
    "mon": [{"start": "09:00", "end": "17:00"}],
    "tue": [{"start": "09:00", "end": "17:00"}],
    "wed": [{"start": "09:00", "end": "17:00"}],
    "thu": [{"start": "09:00", "end": "17:00"}],
    "fri": [{"start": "09:00", "end": "17:00"}],
    "sat": [],
    "sun": []
  }'::jsonb,
  min_notice_hours integer NOT NULL DEFAULT 24 CHECK (min_notice_hours >= 0),
  horizon_days     integer NOT NULL DEFAULT 30 CHECK (horizon_days BETWEEN 1 AND 365),
  buffer_minutes   integer NOT NULL DEFAULT 15 CHECK (buffer_minutes >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.scheduling_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view scheduling settings" ON public.scheduling_settings;
CREATE POLICY "Staff can view scheduling settings"
  ON public.scheduling_settings
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
  ));

INSERT INTO public.scheduling_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ── appointment_types ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.appointment_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Matches lib/scheduling.ts MeetingTypeKey for parity with Cal.com events.
  key              text NOT NULL UNIQUE,
  slug             text NOT NULL UNIQUE,
  label            text NOT NULL,
  description      text NOT NULL DEFAULT '',
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  location_type    text NOT NULL DEFAULT 'phone' CHECK (location_type IN ('phone', 'teams', 'in_person')),
  active           boolean NOT NULL DEFAULT true,
  -- public = bookable anonymously at /book/[slug]; otherwise portal-only.
  public           boolean NOT NULL DEFAULT false,
  sort             integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.appointment_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view appointment types" ON public.appointment_types;
CREATE POLICY "Staff can view appointment types"
  ON public.appointment_types
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
  ));

DROP TRIGGER IF EXISTS appointment_types_updated_at_trg ON public.appointment_types;
CREATE TRIGGER appointment_types_updated_at_trg
BEFORE UPDATE ON public.appointment_types
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.appointment_types
  (key, slug, label, description, duration_minutes, location_type, active, public, sort)
VALUES
  ('discovery_call', 'discovery-call', 'Discovery Call',
   'A first call to learn about your goals and how Aubrey Law can help.',
   30, 'phone', true, true, 1),
  ('pmps', 'design-meeting', 'Peace of Mind Planning Session',
   'The main estate planning design session.',
   90, 'teams', true, false, 2),
  ('draft_review', 'draft-review', 'Estate Plan Draft Review',
   'Review draft documents and planning decisions.',
   60, 'teams', true, false, 3),
  ('client_call', 'client-call', 'Client Call',
   'A call with an existing client.',
   30, 'phone', true, false, 4),
  ('signing_appointment', 'signing-appointment', 'Signing Appointment',
   'The execution meeting for final documents.',
   60, 'in_person', true, false, 5)
ON CONFLICT (key) DO NOTHING;

-- ── appointments ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.appointments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_type_id     uuid NOT NULL REFERENCES public.appointment_types(id),
  start_time              timestamptz NOT NULL,
  end_time                timestamptz NOT NULL CHECK (end_time > start_time),
  status                  text NOT NULL DEFAULT 'scheduled'
                          CHECK (status IN ('scheduled', 'cancelled', 'rescheduled')),
  attendee_name           text NOT NULL,
  attendee_email          text NOT NULL,
  attendee_phone          text,
  notes                   text,
  linked_lead_id          uuid REFERENCES public.client_intake(id) ON DELETE SET NULL,
  linked_matter_id        uuid REFERENCES public.matters(id) ON DELETE SET NULL,
  booked_by_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  microsoft_event_id      text,
  manage_token_hash       text,
  manage_token_expires_at timestamptz,
  source                  text NOT NULL DEFAULT 'public' CHECK (source IN ('public', 'portal')),
  raw                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- Final race guard against double-booking: two 'scheduled' rows may never
  -- overlap in time (solo practice — one attorney calendar).
  CONSTRAINT appointments_no_overlap EXCLUDE USING gist
    (tstzrange(start_time, end_time) WITH &&)
    WHERE (status = 'scheduled')
);

CREATE UNIQUE INDEX IF NOT EXISTS appointments_manage_token_hash_idx
  ON public.appointments (manage_token_hash)
  WHERE manage_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS appointments_start_time_idx
  ON public.appointments (start_time);

CREATE INDEX IF NOT EXISTS appointments_attendee_email_idx
  ON public.appointments (lower(attendee_email));

CREATE INDEX IF NOT EXISTS appointments_linked_lead_idx
  ON public.appointments (linked_lead_id)
  WHERE linked_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS appointments_linked_matter_idx
  ON public.appointments (linked_matter_id)
  WHERE linked_matter_id IS NOT NULL;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view appointments" ON public.appointments;
CREATE POLICY "Staff can view appointments"
  ON public.appointments
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
  ));

DROP TRIGGER IF EXISTS appointments_updated_at_trg ON public.appointments;
CREATE TRIGGER appointments_updated_at_trg
BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.appointments IS
  'Native Outlook-backed bookings. All writes go through the service-role client; the gist exclusion constraint is the final double-booking guard.';

NOTIFY pgrst, 'reload schema';
