-- Widen the lead_activity.type CHECK constraint to allow the agreement
-- lifecycle events written by the engagement send/sign flows. Without
-- this, every audit row from app/api/sign/route.ts and the new SignWell
-- webhook silently 400s.

ALTER TABLE public.lead_activity
  DROP CONSTRAINT IF EXISTS lead_activity_type_check;

ALTER TABLE public.lead_activity
  ADD  CONSTRAINT lead_activity_type_check
  CHECK (type = ANY (ARRAY[
    'created',
    'status_change',
    'note',
    'call',
    'email_sent',
    'email_received',
    'sms',
    'meeting',
    'task',
    'document',
    'converted',
    'lost',
    'agreement_sent',
    'agreement_viewed',
    'agreement_signed',
    'agreement_voided'
  ]));
