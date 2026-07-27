-- Calendly booking links config + lead-scoped outbound SMS.

-- Map of meeting type key -> Calendly booking page URL, edited in
-- Settings -> Scheduling. Empty object = nothing configured.
ALTER TABLE public.scheduling_settings
  ADD COLUMN IF NOT EXISTS calendly_urls jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.scheduling_settings.calendly_urls IS
  'Per meeting-type Calendly booking URLs ({"discovery_call": "https://calendly.com/...", ...}).';

-- Scheduling-link texts can target a lead before any matter exists.
-- matter_id is already nullable; a row belongs to a matter, a lead, or
-- (legacy/unmatched inbound) neither.
ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.client_intake(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sms_messages_lead_id_created_at_idx
  ON public.sms_messages (lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
