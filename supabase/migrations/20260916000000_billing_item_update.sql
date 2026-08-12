-- Cornerstone — let staff correct a charge in place.
--
-- A charge could be added and (since 20260915000000) deleted, but never fixed.
-- A transposed amount or a cost filed under the wrong description had to be
-- deleted and re-entered, which threw away its payments — so the only way to
-- correct a typo was to destroy the collection history behind it.
--
-- Three things the edit has to keep true:
--
-- 1. An amount may not fall below what has already been collected, or
--    billing_items would carry payments exceeding the sum billed and
--    record_billing_payment's balance check would be working from a total the
--    ledger already broke.
--
-- 2. Status is derived, not carried over. Re-opening a paid charge by raising
--    its amount must leave it 'partial', and closing the gap must leave it
--    'paid'; a claim that stops being a plan claim cannot stay
--    'claim_submitted'.
--
-- 3. matter_details mirrors the engagement fee's paid-ness for the close-out
--    card. record_billing_payment maintains it on the way in, so the edit
--    maintains it too, or a re-opened fee reads as collected on one screen and
--    outstanding on the other.
--
-- Writes stay off the client: the RPC is service_role-only, called from
-- PATCH /api/admin/billing/items/[id].

ALTER TABLE public.billing_events
  DROP CONSTRAINT IF EXISTS billing_events_event_type_check;
ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_event_type_check CHECK (
    event_type IN (
      'item_seeded',
      'item_created',
      'item_updated',
      'invoice_marked_sent',
      'payment_recorded',
      'reminder_recorded'
    )
  );

CREATE OR REPLACE FUNCTION public.update_billing_item(
  p_item_id uuid,
  p_kind text,
  p_label text,
  p_plan text,
  p_amount_billed integer,
  p_actor_id uuid
)
RETURNS public.billing_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_item public.billing_items;
  v_before public.billing_items;
  v_label text := btrim(coalesce(p_label, ''));
  v_collected integer;
  v_status text;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or admin access required' USING ERRCODE = '42501';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('flat_fee', 'plan_claim', 'cost') THEN
    RAISE EXCEPTION 'Unknown charge type' USING ERRCODE = '22023';
  END IF;

  IF v_label = '' THEN
    RAISE EXCEPTION 'Label is required' USING ERRCODE = '22023';
  END IF;

  IF p_amount_billed IS NULL OR p_amount_billed <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  -- Mirrors billing_items_plan_kind_check, but fails with a readable message.
  IF p_kind = 'plan_claim' AND p_plan IS NULL THEN
    RAISE EXCEPTION 'A plan claim requires a legal plan' USING ERRCODE = '22023';
  END IF;
  IF p_kind <> 'plan_claim' AND p_plan IS NOT NULL THEN
    RAISE EXCEPTION 'Only plan claims carry a legal plan' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before
  FROM public.billing_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing item not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(sum(amount), 0)::integer INTO v_collected
  FROM public.billing_payments
  WHERE billing_item_id = p_item_id;

  IF p_amount_billed < v_collected THEN
    RAISE EXCEPTION 'Amount is below the % already collected', (v_collected / 100.0)::numeric(12,2)
      USING ERRCODE = '22003';
  END IF;

  -- Derived, so an amount change cannot leave a paid row reading as paid while
  -- a balance is open again.
  v_status := CASE
    WHEN v_collected = 0 AND v_before.status IN ('partial', 'paid') THEN
      CASE WHEN v_before.invoiced_at IS NULL THEN 'to_invoice' ELSE 'invoiced' END
    WHEN v_collected = 0 THEN v_before.status
    WHEN v_collected >= p_amount_billed THEN 'paid'
    ELSE 'partial'
  END;

  -- A claim submitted to a legal plan is meaningless once the charge is not a
  -- plan claim; it has still been sent, so it lands on 'invoiced'.
  IF v_status = 'claim_submitted' AND p_kind <> 'plan_claim' THEN
    v_status := 'invoiced';
  END IF;

  UPDATE public.billing_items
  SET kind = p_kind,
      label = v_label,
      plan = p_plan,
      amount_billed = p_amount_billed,
      status = v_status,
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  -- Keeps the close-out card and the ledger telling the same story. Writing
  -- fee_payment_status re-fires seed_engagement_billing_item, which no-ops:
  -- this matter already has its engagement row — the one being edited.
  IF v_item.source = 'engagement' THEN
    UPDATE public.matter_details
    SET fee_payment_status = CASE
          WHEN v_collected = 0 THEN 'unpaid'
          WHEN v_collected >= v_item.amount_billed THEN 'paid_in_full'
          ELSE 'deposit'
        END,
        fee_collected = (v_collected >= v_item.amount_billed),
        fee_collected_date = CASE
          WHEN v_collected >= v_item.amount_billed THEN fee_collected_date
          ELSE NULL
        END
    WHERE client_id = v_item.matter_id;
  END IF;

  INSERT INTO public.billing_events (
    billing_item_id, event_type, actor_id, detail, metadata
  )
  VALUES (
    p_item_id,
    'item_updated',
    p_actor_id,
    format('Charge updated: %s', v_label),
    jsonb_build_object(
      'before', jsonb_build_object(
        'kind', v_before.kind,
        'label', v_before.label,
        'plan', v_before.plan,
        'amount_billed', v_before.amount_billed,
        'status', v_before.status
      ),
      'after', jsonb_build_object(
        'kind', v_item.kind,
        'label', v_item.label,
        'plan', v_item.plan,
        'amount_billed', v_item.amount_billed,
        'status', v_item.status
      )
    )
  );

  RETURN v_item;
END
$$;

REVOKE ALL ON FUNCTION public.update_billing_item(uuid, text, text, text, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_billing_item(uuid, text, text, text, integer, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
