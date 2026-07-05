-- Add lead_id FK to client_intake so intake records can be linked to leads
-- This column is set when a new client signs up via the portal (auth/callback)
-- and also when an admin converts a lead to a client.

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_intake_lead_id
  ON public.client_intake(lead_id)
  WHERE lead_id IS NOT NULL;
