-- Add 'sending' to engagement_agreements.status so the send route can claim
-- a row atomically (draft → sending) before calling DocuSeal. Prevents
-- double-sends from concurrent requests / double-clicks.

ALTER TABLE public.engagement_agreements
  DROP CONSTRAINT IF EXISTS engagement_agreements_status_check;

ALTER TABLE public.engagement_agreements
  ADD  CONSTRAINT engagement_agreements_status_check
  CHECK (status = ANY (ARRAY[
    'draft',
    'sending',
    'sent',
    'viewed',
    'signed',
    'voided',
    'partially_executed',
    'fully_executed',
    'declined',
    'expired',
    'cancelled'
  ]));
