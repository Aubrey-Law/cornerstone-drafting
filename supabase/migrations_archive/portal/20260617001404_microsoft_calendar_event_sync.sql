-- Microsoft Graph calendar event mirror and lead/matter sync support.

ALTER TABLE public.matter_notes
  ADD COLUMN IF NOT EXISTS microsoft_event_id text;

CREATE INDEX IF NOT EXISTS idx_matter_notes_microsoft_event_id
  ON public.matter_notes (microsoft_event_id)
  WHERE microsoft_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.microsoft_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'microsoft',
  provider_event_id text NOT NULL,
  ical_uid text,
  change_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled', 'cancelled', 'deleted')),
  subject text,
  start_time timestamptz,
  end_time timestamptz,
  attendee_email text,
  attendee_name text,
  linked_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  linked_matter_id uuid REFERENCES public.matters(id) ON DELETE SET NULL,
  unresolved_reason text,
  raw_event jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_notification jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

ALTER TABLE public.microsoft_calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view microsoft calendar events" ON public.microsoft_calendar_events;
CREATE POLICY "Admins can view microsoft calendar events"
  ON public.microsoft_calendar_events
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('attorney', 'admin')
  ));

DROP POLICY IF EXISTS "Admins can manage microsoft calendar events" ON public.microsoft_calendar_events;
CREATE POLICY "Admins can manage microsoft calendar events"
  ON public.microsoft_calendar_events
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('attorney', 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('attorney', 'admin')
  ));

CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_events_start_time
  ON public.microsoft_calendar_events (start_time)
  WHERE start_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_events_attendee_email
  ON public.microsoft_calendar_events (lower(attendee_email))
  WHERE attendee_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_events_linked_lead
  ON public.microsoft_calendar_events (linked_lead_id)
  WHERE linked_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_events_linked_matter
  ON public.microsoft_calendar_events (linked_matter_id)
  WHERE linked_matter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_events_unresolved
  ON public.microsoft_calendar_events (unresolved_reason, updated_at DESC)
  WHERE unresolved_reason IS NOT NULL;

COMMENT ON TABLE public.microsoft_calendar_events IS
  'Server-side mirror of Microsoft Graph calendar event notifications. Outlook remains the calendar source of truth; this table provides idempotent app sync and unresolved-event auditability.';

COMMENT ON COLUMN public.microsoft_calendar_events.raw_notification IS
  'Raw Microsoft Graph change notification retained for troubleshooting and future reconciliation.';

CREATE TABLE IF NOT EXISTS public.microsoft_calendar_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'microsoft',
  purpose text NOT NULL DEFAULT 'event_sync',
  graph_subscription_id text NOT NULL UNIQUE,
  resource text NOT NULL,
  change_type text NOT NULL,
  notification_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'renewal_failed', 'deleted')),
  raw_subscription jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, purpose)
);

ALTER TABLE public.microsoft_calendar_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role manages microsoft calendar subscriptions" ON public.microsoft_calendar_subscriptions;
CREATE POLICY "service role manages microsoft calendar subscriptions"
  ON public.microsoft_calendar_subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view microsoft calendar subscriptions" ON public.microsoft_calendar_subscriptions;
CREATE POLICY "Admins can view microsoft calendar subscriptions"
  ON public.microsoft_calendar_subscriptions
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('attorney', 'admin')
  ));

CREATE INDEX IF NOT EXISTS idx_microsoft_calendar_subscriptions_expires_at
  ON public.microsoft_calendar_subscriptions (expires_at);

COMMENT ON TABLE public.microsoft_calendar_subscriptions IS
  'Tracks the active Microsoft Graph calendar event subscription so the app can renew it before Microsoft expires it.';
