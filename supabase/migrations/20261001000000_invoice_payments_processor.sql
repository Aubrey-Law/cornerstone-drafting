-- Hosted checkout for invoices.
--
-- No trust accounting here, deliberately. The firm bills flat fees earned on
-- receipt and does not run client funds through an IOLTA account, so a payment
-- lands in operating and there is no trust/operating destination to choose.
-- If that ever changes, payments need a destination before checkout is enabled,
-- because money that should have been held in trust cannot be re-routed after
-- the fact.

CREATE TABLE IF NOT EXISTS public.invoice_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('stripe', 'lawpay')),
  provider_session_id text NOT NULL,
  provider_payment_intent_id text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'complete', 'expired', 'failed', 'canceled')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  checkout_url text,
  expires_at timestamptz,
  completed_at timestamptz,
  -- Set once the webhook has actually recorded the money. Its presence is the
  -- business-level idempotency guard: a replay that slips past the webhook
  -- dedupe ledger still cannot record a second payment.
  payment_group_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_session_id)
);

CREATE INDEX invoice_checkout_sessions_invoice_idx
  ON public.invoice_checkout_sessions (invoice_id, created_at DESC);

ALTER TABLE public.invoice_checkout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoice_checkout_sessions_staff_select
  ON public.invoice_checkout_sessions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

GRANT SELECT ON public.invoice_checkout_sessions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.invoice_checkout_sessions FROM authenticated;

-- The dedupe ledger is already (provider, provider_event_id) unique with a
-- payload and timestamps — exactly a webhook dedupe table — so widen it again
-- rather than build a second one, as 20260814000001 did for Cal.com.
ALTER TABLE public.telephony_webhook_events
  DROP CONSTRAINT IF EXISTS telephony_webhook_events_provider_check;

ALTER TABLE public.telephony_webhook_events
  ADD CONSTRAINT telephony_webhook_events_provider_check
  CHECK (provider = ANY (ARRAY[
    'twilio'::text, 'telnyx'::text, 'retell'::text, 'calcom'::text,
    'stripe'::text, 'lawpay'::text
  ]));

COMMENT ON TABLE public.telephony_webhook_events IS
  'Webhook dedupe ledger keyed on (provider, provider_event_id). Despite the name it is not telephony-only — Cal.com and the payment processors claim here too.';

ALTER TABLE public.billing_events
  DROP CONSTRAINT IF EXISTS billing_events_event_type_check;
ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_event_type_check CHECK (
    event_type IN (
      'item_seeded', 'item_created', 'item_updated',
      'invoice_marked_sent', 'payment_recorded', 'reminder_recorded',
      'invoice_drafted', 'invoice_updated', 'invoice_issued', 'invoice_sent',
      'invoice_voided', 'invoice_reminder_sent', 'invoice_payment_recorded',
      'checkout_session_created', 'checkout_session_completed'
    )
  );

-- ── Opening a checkout ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_invoice_checkout_session(
  p_invoice_id uuid,
  p_provider text,
  p_session_id text,
  p_amount_cents integer,
  p_checkout_url text,
  p_expires_at timestamptz,
  p_actor_id uuid
)
RETURNS public.invoice_checkout_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices;
  v_session public.invoice_checkout_sessions;
BEGIN
  PERFORM public.assert_billing_actor(p_actor_id);

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status IN ('draft', 'void', 'paid') THEN
    RAISE EXCEPTION 'Only an open invoice can take an online payment' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invoice_checkout_sessions (
    invoice_id, provider, provider_session_id, amount_cents,
    checkout_url, expires_at, created_by
  )
  VALUES (
    p_invoice_id, p_provider, p_session_id, p_amount_cents,
    p_checkout_url, p_expires_at, p_actor_id
  )
  RETURNING * INTO v_session;

  -- The link rides on the invoice itself, so it prints on the PDF, appears as
  -- the Pay button in the email, and shows in the portal without extra wiring.
  UPDATE public.invoices
  SET payment_link = p_checkout_url,
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE id = p_invoice_id;

  INSERT INTO public.billing_events (invoice_id, event_type, actor_id, detail, metadata)
  VALUES (
    p_invoice_id, 'checkout_session_created', p_actor_id,
    format('Online payment link created for %s', v_invoice.number),
    jsonb_build_object('provider', p_provider, 'amount_cents', p_amount_cents)
  );

  RETURN v_session;
END
$$;

REVOKE ALL ON FUNCTION public.record_invoice_checkout_session(uuid, text, text, integer, text, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_checkout_session(uuid, text, text, integer, text, timestamptz, uuid)
  TO service_role;

-- ── Completing a checkout ───────────────────────────────────────────────────
--
-- The only billing RPC without an actor: the payer is a client, not a staff
-- user. Reachable solely by service_role, the same way claim_webhook_event is,
-- and idempotent so a provider retry is a no-op rather than a second payment.
CREATE OR REPLACE FUNCTION public.complete_invoice_checkout_session(
  p_provider text,
  p_session_id text,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_processor_fee_cents integer,
  p_received_at timestamptz
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session public.invoice_checkout_sessions;
  v_invoice public.invoices;
  v_group uuid := gen_random_uuid();
  v_received timestamptz;
  v_collected integer;
  v_remaining integer;
  v_apply integer;
  v_item_collected integer;
  v_line record;
  v_fee_remaining integer := coalesce(p_processor_fee_cents, 0);
BEGIN
  SELECT * INTO v_session
  FROM public.invoice_checkout_sessions
  WHERE provider = p_provider AND provider_session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checkout session not found' USING ERRCODE = 'P0002';
  END IF;

  -- Already recorded: return the invoice untouched so a replay is harmless.
  IF v_session.payment_group_id IS NOT NULL THEN
    SELECT * INTO v_invoice FROM public.invoices WHERE id = v_session.invoice_id;
    RETURN v_invoice;
  END IF;

  v_received := coalesce(p_received_at, statement_timestamp());

  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_session.invoice_id FOR UPDATE;
  IF v_invoice.status IN ('draft', 'void') THEN
    RAISE EXCEPTION 'This invoice cannot take a payment' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(sum(amount), 0)::integer INTO v_collected
  FROM public.billing_payments WHERE invoice_id = v_invoice.id;

  IF v_collected + p_amount_cents > v_invoice.subtotal_cents THEN
    RAISE EXCEPTION 'Payment exceeds invoice balance' USING ERRCODE = '22003';
  END IF;

  v_remaining := p_amount_cents;

  -- Same oldest-line-first allocation as record_invoice_payment. Kept in step
  -- with it deliberately: two different splits for the same money would make
  -- the per-charge ledger depend on how the client happened to pay.
  FOR v_line IN
    SELECT ii.position, bi.id AS item_id, bi.amount_billed, bi.source, bi.matter_id
    FROM public.invoice_items ii
    JOIN public.billing_items bi ON bi.id = ii.billing_item_id
    WHERE ii.invoice_id = v_invoice.id
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
      v_line.item_id, v_invoice.id, v_group, v_apply, 'card',
      format('Online payment via %s', p_provider), v_received, NULL,
      p_payment_intent_id, v_fee_remaining
    );
    v_fee_remaining := 0;

    UPDATE public.billing_items
    SET status = CASE
          WHEN v_item_collected + v_apply >= amount_billed THEN 'paid'
          ELSE 'partial'
        END,
        updated_at = statement_timestamp()
    WHERE id = v_line.item_id;

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

    v_remaining := v_remaining - v_apply;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Payment exceeds invoice balance' USING ERRCODE = '22003';
  END IF;

  UPDATE public.invoices
  SET status = CASE
        WHEN v_collected + p_amount_cents >= subtotal_cents THEN 'paid'
        ELSE 'partial'
      END,
      paid_at = CASE
        WHEN v_collected + p_amount_cents >= subtotal_cents THEN v_received
        ELSE paid_at
      END,
      updated_at = statement_timestamp()
  WHERE id = v_invoice.id
  RETURNING * INTO v_invoice;

  UPDATE public.invoice_checkout_sessions
  SET status = 'complete',
      completed_at = v_received,
      provider_payment_intent_id = p_payment_intent_id,
      payment_group_id = v_group,
      updated_at = statement_timestamp()
  WHERE id = v_session.id;

  INSERT INTO public.billing_events (invoice_id, event_type, actor_id, detail, metadata)
  VALUES (
    v_invoice.id, 'checkout_session_completed', NULL,
    format('Online payment received for %s', v_invoice.number),
    jsonb_build_object(
      'provider', p_provider,
      'payment_group_id', v_group,
      'amount', p_amount_cents,
      'processor_fee_cents', coalesce(p_processor_fee_cents, 0),
      'invoice_status', v_invoice.status
    )
  );

  RETURN v_invoice;
END
$$;

REVOKE ALL ON FUNCTION public.complete_invoice_checkout_session(text, text, text, integer, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_invoice_checkout_session(text, text, text, integer, integer, timestamptz)
  TO service_role;

-- Terminal non-payment outcomes, so an abandoned link stops looking live.
CREATE OR REPLACE FUNCTION public.close_invoice_checkout_session(
  p_provider text,
  p_session_id text,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_status NOT IN ('expired', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'Invalid terminal status' USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoice_checkout_sessions
  SET status = p_status, updated_at = statement_timestamp()
  WHERE provider = p_provider
    AND provider_session_id = p_session_id
    AND payment_group_id IS NULL;
END
$$;

REVOKE ALL ON FUNCTION public.close_invoice_checkout_session(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_invoice_checkout_session(text, text, text) TO service_role;
