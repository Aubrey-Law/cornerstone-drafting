-- Real invoices. A billing_item is a charge; an invoice is the bill the client
-- receives. One invoice groups several charges on a matter, carries a gapless
-- number, an issue date and a due date, and points at the rendered document.
--
-- Monetary values are integer cents, matching billing_items/billing_payments.
-- Overdue stays derived (from due_date), never stored.

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  -- Assigned at issue, never at draft: an abandoned draft must not burn a number.
  number text,
  number_year integer,
  kind text NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'credit_note')),
  credit_of_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'partial', 'paid', 'void')),
  -- Frozen at issue: the sum of invoice_items, not a live read of billing_items.
  subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  issue_date date,
  due_date date,
  notes text,
  terms text,
  bill_to_name text,
  bill_to_email text,
  -- Pasted by hand until the payment processor lands; printed on the invoice.
  payment_link text,
  issued_at timestamptz,
  sent_at timestamptz,
  last_reminded_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  -- Both nullable: the PDF is absent when DOCX_PDF_CONVERT_URL is unset, and
  -- issuing must never block on the convert worker being reachable.
  pdf_document_id uuid REFERENCES public.matter_documents(id) ON DELETE SET NULL,
  docx_document_id uuid REFERENCES public.matter_documents(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_issued_has_number CHECK (
    (status = 'draft' AND number IS NULL) OR (status <> 'draft' AND number IS NOT NULL)
  ),
  CONSTRAINT invoices_due_after_issue CHECK (
    issue_date IS NULL OR due_date IS NULL OR due_date >= issue_date
  ),
  CONSTRAINT invoices_credit_note_target CHECK (
    (kind = 'credit_note') = (credit_of_invoice_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX invoices_number_unique
  ON public.invoices (number)
  WHERE number IS NOT NULL;
CREATE INDEX invoices_matter_created_idx
  ON public.invoices (matter_id, created_at DESC);
CREATE INDEX invoices_open_due_idx
  ON public.invoices (due_date, status)
  WHERE status IN ('issued', 'partial');

-- A frozen snapshot of what was billed. Once issued, this table and the PDF
-- must agree forever, so a later correction to the charge cannot rewrite a bill
-- the client already has. billing_item_id is a back-reference, not the source.
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  billing_item_id uuid REFERENCES public.billing_items(id) ON DELETE SET NULL,
  position integer NOT NULL CHECK (position >= 0),
  kind text NOT NULL CHECK (kind IN ('flat_fee', 'plan_claim', 'cost')),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, position)
);

CREATE INDEX invoice_items_billing_item_idx
  ON public.invoice_items (billing_item_id);

-- A charge belongs to at most one live invoice. Voiding releases it. Held as a
-- column rather than derived from invoice_items so the ledger can show the
-- invoice without a join and the RPC guard is a cheap NULL check.
ALTER TABLE public.billing_items
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

CREATE INDEX billing_items_invoice_idx
  ON public.billing_items (invoice_id)
  WHERE invoice_id IS NOT NULL;

-- Payments keep billing_item_id NOT NULL so lib/billing/metrics.ts buildRows —
-- the pure, fully tested source of every balance on the page — keeps grouping
-- by item with no change to its arithmetic. One client payment spanning three
-- charges becomes three rows sharing a payment_group_id, which the UI collapses
-- back into a single payment for display.
ALTER TABLE public.billing_payments
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  -- Recorded, never subtracted from `amount`: collected must equal what the
  -- client actually paid, or the annual-goal figures quietly drift.
  ADD COLUMN IF NOT EXISTS processor_fee_cents integer NOT NULL DEFAULT 0
    CHECK (processor_fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS external_reference text;

CREATE INDEX billing_payments_group_idx
  ON public.billing_payments (payment_group_id);
CREATE INDEX billing_payments_invoice_idx
  ON public.billing_payments (invoice_id)
  WHERE invoice_id IS NOT NULL;

-- Audit rows can now target an invoice rather than an item.
ALTER TABLE public.billing_events ALTER COLUMN billing_item_id DROP NOT NULL;
ALTER TABLE public.billing_events
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE;
ALTER TABLE public.billing_events
  DROP CONSTRAINT IF EXISTS billing_events_target_check;
ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_target_check
  CHECK (billing_item_id IS NOT NULL OR invoice_id IS NOT NULL);

ALTER TABLE public.billing_events
  DROP CONSTRAINT IF EXISTS billing_events_event_type_check;
ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_event_type_check CHECK (
    event_type IN (
      'item_seeded', 'item_created', 'item_updated',
      'invoice_marked_sent', 'payment_recorded', 'reminder_recorded',
      'invoice_drafted', 'invoice_updated', 'invoice_issued', 'invoice_sent',
      'invoice_voided', 'invoice_reminder_sent', 'invoice_payment_recorded'
    )
  );

CREATE INDEX billing_events_invoice_created_idx
  ON public.billing_events (invoice_id, created_at DESC)
  WHERE invoice_id IS NOT NULL;

-- Gapless per-year numbering. A Postgres sequence is wrong here: nextval is
-- non-transactional, so a rolled-back issue would leave a hole in the year's
-- series. The row lock taken by the UPDATE below releases the number when the
-- transaction rolls back, which is exactly the behavior an accountant expects.
CREATE TABLE IF NOT EXISTS public.invoice_number_sequences (
  year integer PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);

-- Invoice timeline entries. Widened from 20260909000000_pmps_booking_lead_stage.
ALTER TABLE public.matter_activity
  DROP CONSTRAINT IF EXISTS matter_activity_event_type_check;
ALTER TABLE public.matter_activity
  ADD CONSTRAINT matter_activity_event_type_check CHECK (
    event_type IN (
      'stage_changed', 'note_added', 'document_uploaded', 'document_viewed',
      'document_downloaded', 'task_created', 'task_completed', 'flag_added', 'flag_removed',
      'alert_created', 'alert_resolved', 'intake_sent', 'intake_completed',
      'email_sent', 'sms_sent', 'sms_received', 'draft_generated', 'draft_promoted_to_review',
      'matter_created', 'matter_archived', 'status_changed', 'sla_anchor_set',
      'invoice_issued', 'invoice_paid'
    )
  );

-- ── Row level security ──────────────────────────────────────────────────────

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_number_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoices_staff_select
  ON public.invoices FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

CREATE POLICY invoice_items_staff_select
  ON public.invoice_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

-- A client sees their own issued invoices, never a draft and never a void.
-- Defense in depth: the portal proves ownership through getMatterForUser and
-- then reads with the service-role client, as lib/queries/portal.ts documents.
CREATE POLICY invoices_client_select
  ON public.invoices FOR SELECT TO authenticated
  USING (
    issued_at IS NOT NULL
    AND status <> 'void'
    AND EXISTS (
      SELECT 1 FROM public.matters m
      WHERE m.id = invoices.matter_id AND m.client_id = (select auth.uid())
    )
  );

-- The ownership test is inlined rather than delegated to the parent policy: an
-- RLS policy must not depend on the caller phrasing the query as a join.
CREATE POLICY invoice_items_client_select
  ON public.invoice_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      JOIN public.matters m ON m.id = i.matter_id
      WHERE i.id = invoice_items.invoice_id
        AND i.issued_at IS NOT NULL
        AND i.status <> 'void'
        AND m.client_id = (select auth.uid())
    )
  );

GRANT SELECT ON public.invoices, public.invoice_items TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.invoices FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.invoice_items FROM authenticated;

-- No policy and no grant: reachable only through next_invoice_number().
REVOKE ALL ON public.invoice_number_sequences FROM PUBLIC, anon, authenticated;
