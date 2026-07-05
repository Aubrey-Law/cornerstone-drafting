-- Add lead-specific columns to crm_activity table
-- These allow crm_activity to serve both matter-linked and lead-linked activity

ALTER TABLE public.crm_activity
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS actor_user_id UUID,
  ADD COLUMN IF NOT EXISTS type TEXT
    CHECK (type IN ('created','status_change','note','call','email_sent',
           'email_received','sms','meeting','task','document','converted','lost')),
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Drop NOT NULL constraints that block lead-only activity rows
ALTER TABLE public.crm_activity
  ALTER COLUMN matter_id DROP NOT NULL,
  ALTER COLUMN event_type DROP NOT NULL;

-- Index for lead activity queries
CREATE INDEX IF NOT EXISTS idx_crm_activity_lead_created
  ON public.crm_activity(lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;
