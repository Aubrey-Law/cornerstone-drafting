-- Cornerstone — allow a legal fee to be added by hand.
--
-- create_billing_item originally refused kind = 'flat_fee' on the grounds that
-- the fee is seeded from the signed engagement. That was stricter than the
-- schema requires: billing_items_one_engagement_source is unique on
-- (matter_id) WHERE source = 'engagement', and a hand-added fee is
-- source = 'manual', so the two cannot collide.
--
-- Matters that never ran an engagement agreement through the app — or that
-- need a second fee for additional work — could not be billed at all.
--
-- A matter may therefore carry both a seeded and a manual legal fee. That is
-- intentional: both are real charges and both belong in the ledger.

CREATE OR REPLACE FUNCTION public.create_billing_item(
  p_matter_id uuid,
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
  v_label text := btrim(coalesce(p_label, ''));
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or admin access required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.matters m WHERE m.id = p_matter_id) THEN
    RAISE EXCEPTION 'Matter not found' USING ERRCODE = 'P0002';
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

  -- source = 'manual' keeps billing_items_one_engagement_source free for the
  -- trigger-seeded engagement fee.
  INSERT INTO public.billing_items (
    matter_id, kind, label, plan, amount_billed, status, source, created_by, updated_by
  )
  VALUES (
    p_matter_id, p_kind, v_label, p_plan, p_amount_billed, 'to_invoice', 'manual',
    p_actor_id, p_actor_id
  )
  RETURNING * INTO v_item;

  INSERT INTO public.billing_events (
    billing_item_id, event_type, actor_id, detail, metadata
  )
  VALUES (
    v_item.id,
    'item_created',
    p_actor_id,
    format('%s added: %s', initcap(replace(p_kind, '_', ' ')), v_label),
    jsonb_build_object('kind', p_kind, 'plan', p_plan, 'amount_billed', p_amount_billed)
  );

  RETURN v_item;
END
$$;

REVOKE ALL ON FUNCTION public.create_billing_item(uuid, text, text, text, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_billing_item(uuid, text, text, text, integer, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
