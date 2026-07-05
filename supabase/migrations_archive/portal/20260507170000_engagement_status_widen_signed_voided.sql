-- The engagement_agreements.status CHECK constraint allowed only DocuSeal-
-- style states (fully_executed/cancelled/etc.) and rejected the codebase's
-- existing 'signed' and 'voided' values. Widen to include both, since
-- /sign/[token], /signwell/callback, /docuseal/callback, app/actions/crm.ts,
-- and lib/queries/crm.ts all set status='signed' or 'voided' on completion.
--
-- Surfaced when a DocuSeal form.completed event tried to flip status to
-- 'signed' and the constraint rejected the row (silently, since the route
-- didn't check the update result — fixed in the same change set).

ALTER TABLE public.engagement_agreements
  DROP CONSTRAINT IF EXISTS engagement_agreements_status_check;

ALTER TABLE public.engagement_agreements
  ADD  CONSTRAINT engagement_agreements_status_check
  CHECK (status = ANY (ARRAY[
    'draft',
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
