-- Invoice write path. Every function follows the billing foundation pattern:
-- SECURITY DEFINER, pinned search_path, actor checked against users.role,
-- an immutable billing_events row per mutation, and EXECUTE granted only to
-- service_role so the API layer is the single door.

-- ── Numbering ───────────────────────────────────────────────────────────────
--
-- Not granted to service_role either: this is only ever called from inside
-- issue_invoice, whose rollback is what releases an unused number.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_year integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO public.invoice_number_sequences (year, last_value)
  VALUES (p_year, 0)
  ON CONFLICT (year) DO NOTHING;

  -- Takes the row lock. A concurrent issue blocks here until this transaction
  -- ends; a rollback gives the number back, so the series stays gapless.
  UPDATE public.invoice_number_sequences
  SET last_value = last_value + 1
  WHERE year = p_year
  RETURNING last_value INTO v_next;

  RETURN format('%s-%s', p_year, lpad(v_next::text, 4, '0'));
END
$$;

REVOKE ALL ON FUNCTION public.next_invoice_number(integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- ── Shared guards ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assert_billing_actor(p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or admin access required' USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.assert_billing_actor(uuid) FROM PUBLIC, anon, authenticated;

-- A charge on an issued invoice is frozen: the client is holding a document
-- that says what it says. Enforced by trigger rather than inside the RPCs so
-- it also covers the direct service-role writes in lib/metlife/ledger.ts.
CREATE OR REPLACE FUNCTION public.guard_invoiced_billing_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.invoice_id IS NULL THEN RETURN OLD; END IF;
    SELECT * INTO v_invoice FROM public.invoices WHERE id = OLD.invoice_id;
    IF FOUND AND v_invoice.status NOT IN ('draft', 'void') THEN
      RAISE EXCEPTION 'Charge is on invoice %; void that invoice before deleting the charge',
        v_invoice.number USING ERRCODE = '22023';
    END IF;
    RETURN OLD;
  END IF;

  -- Only the billed face is frozen. Status, invoiced_at and invoice_id are
  -- bookkeeping the invoice RPCs themselves write.
  IF OLD.invoice_id IS NOT NULL
     AND (NEW.amount_billed IS DISTINCT FROM OLD.amount_billed
          OR NEW.label IS DISTINCT FROM OLD.label
          OR NEW.kind IS DISTINCT FROM OLD.kind) THEN
    SELECT * INTO v_invoice FROM public.invoices WHERE id = OLD.invoice_id;
    IF FOUND AND v_invoice.status NOT IN ('draft', 'void') THEN
      RAISE EXCEPTION 'Charge is on invoice %; void that invoice or issue a credit note to change it',
        v_invoice.number USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.guard_invoiced_billing_item() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_invoiced_billing_item ON public.billing_items;
CREATE TRIGGER trg_guard_invoiced_billing_item
  BEFORE UPDATE OR DELETE ON public.billing_items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_invoiced_billing_item();

-- ── Draft lifecycle ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_invoice_draft(
  p_matter_id uuid,
  p_item_ids uuid[],
  p_issue_date date,
  p_due_date date,
  p_notes text,
  p_terms text,
  p_bill_to_name text,
  p_bill_to_email text,
  p_payment_link text,
  p_actor_id uuid
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices;
  v_count integer;
  v_subtotal integer;
BEGIN
  PERFORM public.assert_billing_actor(p_actor_id);

  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'An invoice needs at least one charge' USING ERRCODE = '22023';
  END IF;
  IF p_due_date IS NOT NULL AND p_issue_date IS NOT NULL AND p_due_date < p_issue_date THEN
    RAISE EXCEPTION 'Due date cannot precede the issue date' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.matters WHERE id = p_matter_id) THEN
    RAISE EXCEPTION 'Matter not found' USING ERRCODE = 'P0002';
  END IF;

  -- Locked in id order so two concurrent composers cannot deadlock, matching
  -- delete_billing_items.
  PERFORM 1 FROM public.billing_items
  WHERE id = ANY (p_item_ids)
  ORDER BY id
  FOR UPDATE;

  SELECT count(*)::integer INTO v_count
  FROM public.billing_items WHERE id = ANY (p_item_ids);
  IF v_count <> array_length(p_item_ids, 1) THEN
    RAISE EXCEPTION 'One or more charges no longer exist' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.billing_items
    WHERE id = ANY (p_item_ids) AND matter_id <> p_matter_id
  ) THEN
    RAISE EXCEPTION 'Every charge on an invoice must belong to the same matter'
      USING ERRCODE = '22023';
  END IF;

  -- A plan claim is billed to MetLife or LegalEASE, never to the client. It
  -- keeps its own claim_submitted path and must not reach a client invoice.
  IF EXISTS (
    SELECT 1 FROM public.billing_items
    WHERE id = ANY (p_item_ids) AND kind = 'plan_claim'
  ) THEN
    RAISE EXCEPTION 'A legal plan claim is billed to the carrier and cannot go on a client invoice'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.billing_items
    WHERE id = ANY (p_item_ids) AND invoice_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'One or more charges are already on an invoice' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoices (
    matter_id, status, issue_date, due_date, notes, terms,
    bill_to_name, bill_to_email, payment_link, created_by, updated_by
  )
  VALUES (
    p_matter_id, 'draft', p_issue_date, p_due_date,
    nullif(btrim(p_notes), ''), nullif(btrim(p_terms), ''),
    nullif(btrim(p_bill_to_name), ''), nullif(btrim(p_bill_to_email), ''),
    nullif(btrim(p_payment_link), ''), p_actor_id, p_actor_id
  )
  RETURNING * INTO v_invoice;

  -- Position follows charge age, which is the order the ledger already shows
  -- and the order payments are later allocated in.
  INSERT INTO public.invoice_items (
    invoice_id, billing_item_id, position, kind, description, amount_cents
  )
  SELECT
    v_invoice.id,
    bi.id,
    (row_number() OVER (ORDER BY bi.created_at, bi.id) - 1)::integer,
    bi.kind,
    bi.label,
    bi.amount_billed
  FROM public.billing_items bi
  WHERE bi.id = ANY (p_item_ids);

  SELECT coalesce(sum(amount_cents), 0)::integer INTO v_subtotal
  FROM public.invoice_items WHERE invoice_id = v_invoice.id;

  UPDATE public.invoices
  SET subtotal_cents = v_subtotal
  WHERE id = v_invoice.id
  RETURNING * INTO v_invoice;

  UPDATE public.billing_items
  SET invoice_id = v_invoice.id,
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE id = ANY (p_item_ids);

  INSERT INTO public.billing_events (invoice_id, event_type, actor_id, detail, metadata)
  VALUES (
    v_invoice.id, 'invoice_drafted', p_actor_id, 'Invoice drafted',
    jsonb_build_object('item_count', v_count, 'subtotal_cents', v_subtotal)
  );

  RETURN v_invoice;
END
$$;

REVOKE ALL ON FUNCTION public.create_invoice_draft(uuid, uuid[], date, date, text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_draft(uuid, uuid[], date, date, text, text, text, text, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.update_invoice_draft(
  p_invoice_id uuid,
  p_item_ids uuid[],
  p_issue_date date,
  p_due_date date,
  p_notes text,
  p_terms text,
  p_bill_to_name text,
  p_bill_to_email text,
  p_payment_link text,
  p_actor_id uuid
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices;
  v_subtotal integer;
BEGIN
  PERFORM public.assert_billing_actor(p_actor_id);

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft invoice can be edited' USING ERRCODE = '22023';
  END IF;
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'An invoice needs at least one charge' USING ERRCODE = '22023';
  END IF;
  IF p_due_date IS NOT NULL AND p_issue_date IS NOT NULL AND p_due_date < p_issue_date THEN
    RAISE EXCEPTION 'Due date cannot precede the issue date' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.billing_items
    WHERE id = ANY (p_item_ids)
      AND (matter_id <> v_invoice.matter_id OR kind = 'plan_claim')
  ) THEN
    RAISE EXCEPTION 'Every charge must belong to this matter and must not be a plan claim'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.billing_items
    WHERE id = ANY (p_item_ids)
      AND invoice_id IS NOT NULL
      AND invoice_id <> p_invoice_id
  ) THEN
    RAISE EXCEPTION 'One or more charges are already on another invoice' USING ERRCODE = '22023';
  END IF;

  -- Release charges dropped from the draft, claim the ones added.
  UPDATE public.billing_items
  SET invoice_id = NULL, updated_by = p_actor_id, updated_at = statement_timestamp()
  WHERE invoice_id = p_invoice_id AND NOT (id = ANY (p_item_ids));

  DELETE FROM public.invoice_items WHERE invoice_id = p_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, billing_item_id, position, kind, description, amount_cents
  )
  SELECT
    p_invoice_id,
    bi.id,
    (row_number() OVER (ORDER BY bi.created_at, bi.id) - 1)::integer,
    bi.kind,
    bi.label,
    bi.amount_billed
  FROM public.billing_items bi
  WHERE bi.id = ANY (p_item_ids);

  UPDATE public.billing_items
  SET invoice_id = p_invoice_id, updated_by = p_actor_id, updated_at = statement_timestamp()
  WHERE id = ANY (p_item_ids);

  SELECT coalesce(sum(amount_cents), 0)::integer INTO v_subtotal
  FROM public.invoice_items WHERE invoice_id = p_invoice_id;

  UPDATE public.invoices
  SET issue_date = p_issue_date,
      due_date = p_due_date,
      notes = nullif(btrim(p_notes), ''),
      terms = nullif(btrim(p_terms), ''),
      bill_to_name = nullif(btrim(p_bill_to_name), ''),
      bill_to_email = nullif(btrim(p_bill_to_email), ''),
      payment_link = nullif(btrim(p_payment_link), ''),
      subtotal_cents = v_subtotal,
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;

  INSERT INTO public.billing_events (invoice_id, event_type, actor_id, detail, metadata)
  VALUES (
    p_invoice_id, 'invoice_updated', p_actor_id, 'Draft invoice updated',
    jsonb_build_object('subtotal_cents', v_subtotal)
  );

  RETURN v_invoice;
END
$$;

REVOKE ALL ON FUNCTION public.update_invoice_draft(uuid, uuid[], date, date, text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_invoice_draft(uuid, uuid[], date, date, text, text, text, text, text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.discard_invoice_draft(
  p_invoice_id uuid,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices;
BEGIN
  PERFORM public.assert_billing_actor(p_actor_id);

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft invoice can be discarded; void an issued one instead'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.billing_items
  SET invoice_id = NULL, updated_by = p_actor_id, updated_at = statement_timestamp()
  WHERE invoice_id = p_invoice_id;

  -- No number was ever assigned, so there is nothing to preserve. Items and
  -- events cascade.
  DELETE FROM public.invoices WHERE id = p_invoice_id;
END
$$;

REVOKE ALL ON FUNCTION public.discard_invoice_draft(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_invoice_draft(uuid, uuid) TO service_role;

-- ── Issue and send ──────────────────────────────────────────────────────────
--
-- Assigns the number and nothing else touching the outside world, so the row
-- lock on invoice_number_sequences is held for microseconds rather than across
-- a call to the DOCX→PDF worker. The document is rendered afterwards, with the
-- number in hand, and attached by attach_invoice_documents. A render that fails
-- therefore leaves a real numbered invoice to retry against rather than burning
-- a number on a rolled-back transaction.
CREATE OR REPLACE FUNCTION public.issue_invoice(
  p_invoice_id uuid,
  p_actor_id uuid
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices;
  v_number text;
  v_year integer;
  v_issued timestamptz;
BEGIN
  PERFORM public.assert_billing_actor(p_actor_id);

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status <> 'draft' THEN
    RAISE EXCEPTION 'This invoice has already been issued' USING ERRCODE = '22023';
  END IF;
  IF v_invoice.subtotal_cents <= 0 THEN
    RAISE EXCEPTION 'An invoice must total more than zero' USING ERRCODE = '22023';
  END IF;

  v_issued := statement_timestamp();
  v_year := extract(year FROM coalesce(v_invoice.issue_date, v_issued::date))::integer;
  v_number := public.next_invoice_number(v_year);

  UPDATE public.invoices
  SET number = v_number,
      number_year = v_year,
      status = 'issued',
      issue_date = coalesce(issue_date, v_issued::date),
      issued_at = v_issued,
      updated_by = p_actor_id,
      updated_at = v_issued
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;

  -- invoiced_at drives ageDays and the aging buckets in lib/billing/metrics.ts;
  -- leaving it null would make every invoiced charge read as never billed.
  UPDATE public.billing_items bi
  SET status = CASE WHEN bi.status = 'to_invoice' THEN 'invoiced' ELSE bi.status END,
      invoiced_at = coalesce(bi.invoiced_at, v_issued),
      updated_by = p_actor_id,
      updated_at = v_issued
  WHERE bi.invoice_id = p_invoice_id;

  INSERT INTO public.billing_events (invoice_id, event_type, actor_id, detail, metadata)
  VALUES (
    p_invoice_id, 'invoice_issued', p_actor_id,
    format('Invoice %s issued', v_number),
    jsonb_build_object(
      'number', v_number,
      'subtotal_cents', v_invoice.subtotal_cents,
      'due_date', v_invoice.due_date
    )
  );

  RETURN v_invoice;
END
$$;

REVOKE ALL ON FUNCTION public.issue_invoice(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid, uuid) TO service_role;

-- Attaches the rendered artifacts once they exist. Separate from issue_invoice
-- so a convert-worker outage costs a retry, not an invoice number. Idempotent:
-- re-rendering an invoice simply repoints it at the newer documents.
CREATE OR REPLACE FUNCTION public.attach_invoice_documents(
  p_invoice_id uuid,
  p_pdf_document_id uuid,
  p_docx_document_id uuid,
  p_actor_id uuid
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices;
BEGIN
  PERFORM public.assert_billing_actor(p_actor_id);

  UPDATE public.invoices
  SET pdf_document_id = coalesce(p_pdf_document_id, pdf_document_id),
      docx_document_id = coalesce(p_docx_document_id, docx_document_id),
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_invoice;
END
$$;

REVOKE ALL ON FUNCTION public.attach_invoice_documents(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_invoice_documents(uuid, uuid, uuid, uuid)
  TO service_role;

-- Separate from issue_invoice so "issue now, email later" and "resend" are both
-- first-class rather than special cases.
CREATE OR REPLACE FUNCTION public.mark_invoice_sent(
  p_invoice_id uuid,
  p_channel text,
  p_recipient text,
  p_actor_id uuid
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices;
BEGIN
  PERFORM public.assert_billing_actor(p_actor_id);

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status = 'draft' THEN
    RAISE EXCEPTION 'Issue the invoice before sending it' USING ERRCODE = '22023';
  END IF;
  IF v_invoice.status = 'void' THEN
    RAISE EXCEPTION 'A void invoice cannot be sent' USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
  SET sent_at = statement_timestamp(),
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;

  INSERT INTO public.billing_events (invoice_id, event_type, actor_id, detail, metadata)
  VALUES (
    p_invoice_id, 'invoice_sent', p_actor_id,
    format('Invoice %s sent', v_invoice.number),
    jsonb_build_object('channel', p_channel, 'recipient', p_recipient)
  );

  RETURN v_invoice;
END
$$;

REVOKE ALL ON FUNCTION public.mark_invoice_sent(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_invoice_sent(uuid, text, text, uuid) TO service_role;

-- ── Payment against an invoice ──────────────────────────────────────────────
--
-- One client payment is allocated across the invoice's charges oldest first and
-- written as one billing_payments row per charge touched, all sharing a
-- payment_group_id. That keeps billing_payments.billing_item_id NOT NULL, so
-- buildRows in lib/billing/metrics.ts — the pure, tested source of every
-- balance on the page — needs no change to its arithmetic. The UI collapses a
-- group back into a single payment for display.
CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount integer,
  p_method text,
  p_note text,
  p_received_at timestamptz,
  p_actor_id uuid,
  p_external_reference text DEFAULT NULL,
  p_processor_fee_cents integer DEFAULT 0
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices;
  v_group uuid := gen_random_uuid();
  v_received timestamptz;
  v_collected integer;
  v_remaining integer;
  v_apply integer;
  v_item_collected integer;
  v_line record;
  v_allocations jsonb := '[]'::jsonb;
  v_fee_remaining integer := coalesce(p_processor_fee_cents, 0);
BEGIN
  PERFORM public.assert_billing_actor(p_actor_id);

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive' USING ERRCODE = '22003';
  END IF;
  IF p_method NOT IN ('check', 'card', 'ach', 'plan_eft', 'cash') THEN
    RAISE EXCEPTION 'Invalid payment method' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status = 'draft' THEN
    RAISE EXCEPTION 'Issue the invoice before recording a payment' USING ERRCODE = '22023';
  END IF;
  IF v_invoice.status = 'void' THEN
    RAISE EXCEPTION 'A void invoice cannot take a payment' USING ERRCODE = '22023';
  END IF;

  v_received := coalesce(p_received_at, statement_timestamp());

  SELECT coalesce(sum(amount), 0)::integer INTO v_collected
  FROM public.billing_payments WHERE invoice_id = p_invoice_id;

  IF v_collected + p_amount > v_invoice.subtotal_cents THEN
    RAISE EXCEPTION 'Payment exceeds invoice balance' USING ERRCODE = '22003';
  END IF;

  v_remaining := p_amount;

  -- FOR UPDATE OF bi matters: without it two concurrent payments can each read
  -- a stale per-item collected total and jointly overshoot the charge.
  FOR v_line IN
    SELECT ii.position, bi.id AS item_id, bi.amount_billed, bi.source, bi.matter_id
    FROM public.invoice_items ii
    JOIN public.billing_items bi ON bi.id = ii.billing_item_id
    WHERE ii.invoice_id = p_invoice_id
    ORDER BY ii.position
    FOR UPDATE OF bi
  LOOP
    EXIT WHEN v_remaining <= 0;

    SELECT coalesce(sum(amount), 0)::integer INTO v_item_collected
    FROM public.billing_payments WHERE billing_item_id = v_line.item_id;

    v_apply := least(v_remaining, v_line.amount_billed - v_item_collected);
    CONTINUE WHEN v_apply <= 0;

    INSERT INTO public.billing_payments (
      billing_item_id, invoice_id, payment_group_id, amount, method, note,
      received_at, created_by, external_reference, processor_fee_cents
    )
    VALUES (
      v_line.item_id, p_invoice_id, v_group, v_apply, p_method,
      nullif(btrim(p_note), ''), v_received, p_actor_id,
      nullif(btrim(p_external_reference), ''),
      -- The whole fee rides on the first allocation so a split payment does not
      -- multiply it.
      v_fee_remaining
    );
    v_fee_remaining := 0;

    UPDATE public.billing_items
    SET status = CASE
          WHEN v_item_collected + v_apply >= amount_billed THEN 'paid'
          ELSE 'partial'
        END,
        updated_by = p_actor_id,
        updated_at = statement_timestamp()
    WHERE id = v_line.item_id;

    -- The engagement fee summary mirrors this charge's own numbers, never the
    -- invoice total: a $2,000 fee on a $2,450 invoice is paid in full once
    -- $2,000 has landed on it, even while the invoice is still partial. Writing
    -- fee_payment_status re-fires trg_seed_engagement_billing_item, which
    -- no-ops because the matter already has its engagement row — the same
    -- benign re-entry 20260916000000_billing_item_update.sql documents.
    IF v_line.source = 'engagement' THEN
      UPDATE public.matter_details
      SET fee_payment_status = CASE
            WHEN v_item_collected + v_apply >= v_line.amount_billed THEN 'paid_in_full'
            ELSE 'deposit'
          END,
          fee_collected = (v_item_collected + v_apply >= v_line.amount_billed),
          fee_collected_date = CASE
            WHEN v_item_collected + v_apply >= v_line.amount_billed
            THEN v_received::date
            ELSE fee_collected_date
          END
      WHERE client_id = v_line.matter_id;
    END IF;

    v_allocations := v_allocations || jsonb_build_object(
      'billing_item_id', v_line.item_id, 'amount', v_apply
    );
    v_remaining := v_remaining - v_apply;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Payment exceeds invoice balance' USING ERRCODE = '22003';
  END IF;

  UPDATE public.invoices
  SET status = CASE
        WHEN v_collected + p_amount >= subtotal_cents THEN 'paid'
        ELSE 'partial'
      END,
      paid_at = CASE
        WHEN v_collected + p_amount >= subtotal_cents THEN v_received
        ELSE paid_at
      END,
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;

  INSERT INTO public.billing_events (invoice_id, event_type, actor_id, detail, metadata)
  VALUES (
    p_invoice_id, 'invoice_payment_recorded', p_actor_id, 'Payment recorded',
    jsonb_build_object(
      'payment_group_id', v_group,
      'amount', p_amount,
      'method', p_method,
      'allocations', v_allocations,
      'invoice_status', v_invoice.status
    )
  );

  RETURN v_invoice;
END
$$;

REVOKE ALL ON FUNCTION public.record_invoice_payment(uuid, integer, text, text, timestamptz, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(uuid, integer, text, text, timestamptz, uuid, text, integer)
  TO service_role;

-- ── Void and remind ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.void_invoice(
  p_invoice_id uuid,
  p_reason text,
  p_actor_id uuid
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices;
BEGIN
  PERFORM public.assert_billing_actor(p_actor_id);

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A void needs a reason' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status = 'draft' THEN
    RAISE EXCEPTION 'Discard a draft rather than voiding it' USING ERRCODE = '22023';
  END IF;
  IF v_invoice.status = 'void' THEN
    RAISE EXCEPTION 'This invoice is already void' USING ERRCODE = '22023';
  END IF;
  -- Money already collected cannot be unwound by a void without losing the
  -- payment record. Credit it instead.
  IF EXISTS (SELECT 1 FROM public.billing_payments WHERE invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'A payment has landed on this invoice; issue a credit note instead of voiding it'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
  SET status = 'void',
      voided_at = statement_timestamp(),
      void_reason = btrim(p_reason),
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;

  -- Release the charges so they can be billed again. invoice_items keeps its
  -- frozen snapshot, so the void invoice stays readable at its own number.
  UPDATE public.billing_items
  SET invoice_id = NULL,
      status = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.billing_payments bp WHERE bp.billing_item_id = billing_items.id
        ) THEN 'to_invoice'
        ELSE status
      END,
      invoiced_at = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.billing_payments bp WHERE bp.billing_item_id = billing_items.id
        ) THEN NULL
        ELSE invoiced_at
      END,
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE invoice_id = p_invoice_id;

  INSERT INTO public.billing_events (invoice_id, event_type, actor_id, detail, metadata)
  VALUES (
    p_invoice_id, 'invoice_voided', p_actor_id,
    format('Invoice %s voided', v_invoice.number),
    jsonb_build_object('reason', btrim(p_reason))
  );

  RETURN v_invoice;
END
$$;

REVOKE ALL ON FUNCTION public.void_invoice(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_invoice(uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_invoice_reminder_sent(
  p_invoice_id uuid,
  p_actor_id uuid
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices;
BEGIN
  PERFORM public.assert_billing_actor(p_actor_id);

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status IN ('draft', 'paid', 'void') THEN
    RAISE EXCEPTION 'Only an open invoice can be reminded about' USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
  SET last_reminded_at = statement_timestamp(),
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;

  INSERT INTO public.billing_events (invoice_id, event_type, actor_id, detail, metadata)
  VALUES (
    p_invoice_id, 'invoice_reminder_sent', p_actor_id,
    format('Reminder sent for invoice %s', v_invoice.number),
    jsonb_build_object('number', v_invoice.number)
  );

  RETURN v_invoice;
END
$$;

REVOKE ALL ON FUNCTION public.mark_invoice_reminder_sent(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_invoice_reminder_sent(uuid, uuid) TO service_role;

-- ── Double-entry guard on the per-charge payment path ───────────────────────
--
-- Without this, a charge on an issued invoice could be paid twice: once through
-- record_billing_payment and once through record_invoice_payment, each seeing
-- its own view of the balance. Replaces 20260731003142's version, adding only
-- the guard; the rest is unchanged.
CREATE OR REPLACE FUNCTION public.record_billing_payment(
  p_item_id uuid,
  p_amount integer,
  p_method text,
  p_note text,
  p_received_at timestamptz,
  p_actor_id uuid
)
RETURNS public.billing_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_item public.billing_items;
  v_collected integer;
  v_payment_id uuid;
  v_next_status text;
  v_invoice_number text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be positive' USING ERRCODE = '22003';
  END IF;
  IF p_method NOT IN ('check', 'card', 'ach', 'plan_eft', 'cash') THEN
    RAISE EXCEPTION 'Invalid payment method' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item
  FROM public.billing_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing item not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_item.invoice_id IS NOT NULL THEN
    SELECT number INTO v_invoice_number
    FROM public.invoices
    WHERE id = v_item.invoice_id AND status NOT IN ('draft', 'void');
    IF FOUND THEN
      RAISE EXCEPTION 'This charge is on invoice %; record the payment against the invoice',
        v_invoice_number USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT coalesce(sum(amount), 0)::integer INTO v_collected
  FROM public.billing_payments
  WHERE billing_item_id = p_item_id;

  IF v_collected + p_amount > v_item.amount_billed THEN
    RAISE EXCEPTION 'Payment exceeds open balance' USING ERRCODE = '22003';
  END IF;

  v_next_status := CASE
    WHEN v_collected + p_amount = v_item.amount_billed THEN 'paid'
    ELSE 'partial'
  END;

  INSERT INTO public.billing_payments (
    billing_item_id, amount, method, note, received_at, created_by
  )
  VALUES (
    p_item_id,
    p_amount,
    p_method,
    nullif(btrim(p_note), ''),
    coalesce(p_received_at, statement_timestamp()),
    p_actor_id
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.billing_items
  SET status = v_next_status,
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  IF v_item.source = 'engagement' THEN
    UPDATE public.matter_details
    SET fee_payment_status = CASE
          WHEN v_collected + p_amount = v_item.amount_billed THEN 'paid_in_full'
          ELSE 'deposit'
        END,
        fee_collected = (v_collected + p_amount = v_item.amount_billed),
        fee_collected_date = CASE
          WHEN v_collected + p_amount = v_item.amount_billed
          THEN coalesce(p_received_at, statement_timestamp())::date
          ELSE fee_collected_date
        END
    WHERE client_id = v_item.matter_id;
  END IF;

  INSERT INTO public.billing_events (
    billing_item_id, event_type, actor_id, detail, metadata
  )
  VALUES (
    p_item_id,
    'payment_recorded',
    p_actor_id,
    'Payment recorded',
    jsonb_build_object(
      'payment_id', v_payment_id,
      'amount', p_amount,
      'method', p_method,
      'status', v_next_status
    )
  );

  RETURN v_item;
END
$$;

REVOKE ALL ON FUNCTION public.record_billing_payment(uuid, integer, text, text, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_billing_payment(uuid, integer, text, text, timestamptz, uuid)
  TO service_role;
