-- Cornerstone — let staff add costs and legal-plan claims to a matter.
--
-- billing_foundation seeds the flat fee from the signed engagement and has no
-- create path for anything else, so pass-through costs (recording fees, court
-- costs) and plan claims could not be billed at all.
--
-- Writes stay off the client: `authenticated` keeps SELECT only, and this RPC
-- is service_role-only, called from POST /api/admin/billing/items. Like every
-- other billing mutation it appends to billing_events.

-- billing_events gains the new event type.
ALTER TABLE public.billing_events
  DROP CONSTRAINT IF EXISTS billing_events_event_type_check;
ALTER TABLE public.billing_events
  ADD CONSTRAINT billing_events_event_type_check CHECK (
    event_type IN (
      'item_seeded',
      'item_created',
      'invoice_marked_sent',
      'payment_recorded',
      'reminder_recorded'
    )
  );

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

  -- The flat fee is seeded from the signed engagement; it is never hand-added,
  -- and billing_items_one_engagement_source assumes exactly one per matter.
  IF p_kind IS DISTINCT FROM 'cost' AND p_kind IS DISTINCT FROM 'plan_claim' THEN
    RAISE EXCEPTION 'Only costs and plan claims may be added' USING ERRCODE = '22023';
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
