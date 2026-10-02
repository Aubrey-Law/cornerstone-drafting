-- Cornerstone — invoice a legal plan claim to its carrier.
--
-- Plan claims were kept off invoices entirely, on the grounds that MetLife or
-- LegalEASE pays them, not the client. That left a plan matter with no invoice
-- to track on the matter, and no record of what had been billed to each
-- carrier. An invoice now has a payer:
--
--   client    — the existing behaviour: emailed, shown in the portal, payable
--               by card, chased by reminders.
--   metlife   — a record of claims billed to the carrier. The app keeps it
--   legalease   internal (no email, portal, checkout or reminders), and the
--               portal policies below refuse it to clients outright.
--
-- The payer is derived from the charges, never chosen: plan claims bill to
-- their own billing_items.plan, everything else to the client, and one invoice
-- holds one payer. issue_invoice is unchanged — it already moves to_invoice
-- charges to 'invoiced', which is exactly what the per-claim "Submit claim"
-- action does, so issuing a carrier invoice marks its claims submitted.
-- void_invoice likewise already returns unpaid claims to to_invoice.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payer text NOT NULL DEFAULT 'client';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_payer_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_payer_check CHECK (payer IN ('client', 'metlife', 'legalease'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS invoices_payer_idx
  ON public.invoices (payer, issue_date)
  WHERE payer <> 'client';

-- Who pays a charge. Shared by both draft functions so they cannot disagree.
CREATE OR REPLACE FUNCTION public.billing_item_payer(p_kind text, p_plan text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN p_kind = 'plan_claim' THEN coalesce(p_plan, 'client') ELSE 'client' END
$$;

-- A credit note bills whoever the invoice it credits billed. Set by trigger so
-- issue_invoice_credit_note needs no change.
CREATE OR REPLACE FUNCTION public.inherit_credit_note_payer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.kind = 'credit_note' AND NEW.credit_of_invoice_id IS NOT NULL THEN
    SELECT payer INTO NEW.payer FROM public.invoices WHERE id = NEW.credit_of_invoice_id;
    NEW.payer := coalesce(NEW.payer, 'client');
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_inherit_credit_note_payer ON public.invoices;
CREATE TRIGGER trg_inherit_credit_note_payer
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.inherit_credit_note_payer();

-- ── Drafts: drop the plan-claim ban, enforce one payer ──────────────────────
-- Otherwise identical to the 20260930000001 versions.

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
  v_payers integer;
  v_payer text;
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

  -- One payer per invoice: the client, or the carrier behind a plan claim.
  -- Mixing them would blend what the client owes with what the carrier owes
  -- into one balance and one oldest-first payment allocation.
  SELECT count(DISTINCT public.billing_item_payer(kind, plan))::integer,
         min(public.billing_item_payer(kind, plan))
  INTO v_payers, v_payer
  FROM public.billing_items WHERE id = ANY (p_item_ids);
  IF v_payers > 1 THEN
    RAISE EXCEPTION 'An invoice is billed to one payer: put client charges and legal plan claims on separate invoices'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.billing_items
    WHERE id = ANY (p_item_ids) AND invoice_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'One or more charges are already on an invoice' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoices (
    matter_id, status, payer, issue_date, due_date, notes, terms,
    bill_to_name, bill_to_email, payment_link, created_by, updated_by
  )
  VALUES (
    p_matter_id, 'draft', v_payer, p_issue_date, p_due_date,
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
  v_payers integer;
  v_payer text;
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
    WHERE id = ANY (p_item_ids) AND matter_id <> v_invoice.matter_id
  ) THEN
    RAISE EXCEPTION 'Every charge must belong to this matter' USING ERRCODE = '22023';
  END IF;
  -- The payer follows the charges, so a draft may switch payer wholesale, but
  -- never hold two.
  SELECT count(DISTINCT public.billing_item_payer(kind, plan))::integer,
         min(public.billing_item_payer(kind, plan))
  INTO v_payers, v_payer
  FROM public.billing_items WHERE id = ANY (p_item_ids);
  IF v_payers > 1 THEN
    RAISE EXCEPTION 'An invoice is billed to one payer: put client charges and legal plan claims on separate invoices'
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
  SET payer = coalesce(v_payer, payer),
      issue_date = p_issue_date,
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

-- ── Portal: a client never sees a carrier invoice ───────────────────────────

DROP POLICY IF EXISTS invoices_client_select ON public.invoices;
CREATE POLICY invoices_client_select
  ON public.invoices FOR SELECT TO authenticated
  USING (
    issued_at IS NOT NULL
    AND status <> 'void'
    AND payer = 'client'
    AND EXISTS (
      SELECT 1 FROM public.matters m
      WHERE m.id = invoices.matter_id AND m.client_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS invoice_items_client_select ON public.invoice_items;
CREATE POLICY invoice_items_client_select
  ON public.invoice_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      JOIN public.matters m ON m.id = i.matter_id
      WHERE i.id = invoice_items.invoice_id
        AND i.issued_at IS NOT NULL
        AND i.status <> 'void'
        AND i.payer = 'client'
        AND m.client_id = (select auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
