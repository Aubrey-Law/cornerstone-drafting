ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.client_intake(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sms_messages_lead_id_created_at_idx
  ON public.sms_messages (lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;
