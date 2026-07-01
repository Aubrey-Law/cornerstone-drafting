-- Align lead activity writes and Lead Detail timeline rendering around the
-- native lead_activity table. Existing legacy crm_activity rows are still read
-- by the app, but new lead-scoped events should use this constraint.

ALTER TABLE public.lead_activity
  DROP CONSTRAINT IF EXISTS lead_activity_type_check;

ALTER TABLE public.lead_activity
  ADD CONSTRAINT lead_activity_type_check
  CHECK (type = ANY (ARRAY[
    'created',
    'status_change',
    'note',
    'call',
    'email_sent',
    'email_received',
    'sms',
    'meeting',
    'consult_scheduled',
    'task',
    'document',
    'converted',
    'lost',
    'agreement_sent',
    'agreement_viewed',
    'agreement_signed',
    'agreement_voided',
    'conflict_check_decided'
  ]));
