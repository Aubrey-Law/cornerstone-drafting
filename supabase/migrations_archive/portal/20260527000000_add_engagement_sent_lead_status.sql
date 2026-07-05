-- Add the Engagement Sent stage to standalone leads.
-- This updates an existing exposed table/check constraint; no new Data API
-- table grants are required.

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_status_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_status_check
  CHECK (status IN (
    'new',
    'contacted',
    'consult_booked',
    'consult_held',
    'proposal_sent',
    'engagement_sent',
    'hired',
    'lost',
    'nurture'
  ));
