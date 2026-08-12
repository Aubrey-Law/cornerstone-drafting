-- Cornerstone — let staff delete a charge, one at a time or in bulk.
--
-- Charges could be added but never removed, so a mis-keyed cost or a claim
-- filed against the wrong matter stayed in the ledger forever, inflating
-- outstanding balances and the receivables aging.
--
-- Two things make deletion more than a DELETE statement:
--
-- 1. billing_payments and billing_events cascade off billing_items, so the
--    audit trail of a deleted charge would vanish with it. billing_item_deletions
--    holds no foreign key to billing_items and therefore survives, recording
--    what was removed, what had been collected against it, and by whom.
--
-- 2. seed_engagement_billing_item re-inserts the engagement fee on any later
--    update of engagement_signed / flat_fee_amount / fee_payment_status, and
--    its ON CONFLICT guard only holds while the row exists. A deleted
--    engagement fee would silently come back. The trigger now also checks the
--    deletion log, so removing it sticks.
--
-- Writes stay off the client: `authenticated` keeps SELECT only, and the RPC is
-- service_role-only, called from the billing delete routes.

CREATE TABLE IF NOT EXISTS public.billing_item_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deliberately no FK: the billing_items row is gone by the time this is read.
  billing_item_id uuid NOT NULL,
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  kind text NOT NULL,
  label text NOT NULL,
  plan text,
  amount_billed integer NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  -- Payments that cascaded away with the charge, and what they totalled.
  payments_deleted integer NOT NULL DEFAULT 0,
  amount_collected integer NOT NULL DEFAULT 0,
  item_created_at timestamptz NOT NULL,
  deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_item_deletions_matter_idx
  ON public.billing_item_deletions (matter_id, deleted_at DESC);
-- Read on every engagement-fee seeding attempt.
CREATE INDEX IF NOT EXISTS billing_item_deletions_engagement_idx
  ON public.billing_item_deletions (matter_id)
  WHERE source = 'engagement';

ALTER TABLE public.billing_item_deletions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_item_deletions_staff_select ON public.billing_item_deletions;
CREATE POLICY billing_item_deletions_staff_select
  ON public.billing_item_deletions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

GRANT SELECT ON public.billing_item_deletions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.billing_item_deletions FROM authenticated;

-- A deleted engagement fee must not be re-seeded by the next matter_details
-- update. Otherwise identical to the 20260731003142 version.
CREATE OR REPLACE FUNCTION public.seed_engagement_billing_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_item public.billing_items;
BEGIN
  IF NEW.engagement_signed IS TRUE
     AND NEW.flat_fee_amount IS NOT NULL
     AND NEW.flat_fee_amount > 0
     AND coalesce(NEW.fee_payment_status, 'unpaid') = 'unpaid'
     AND NOT EXISTS (
       SELECT 1 FROM public.billing_item_deletions d
       WHERE d.matter_id = NEW.client_id::uuid AND d.source = 'engagement'
     ) THEN
    INSERT INTO public.billing_items (
      matter_id,
      kind,
      label,
      plan,
      amount_billed,
      status,
      invoiced_at,
      source,
      created_at,
      updated_at
    )
    VALUES (
      NEW.client_id::uuid,
      'flat_fee',
      'Flat fee — ' || coalesce(
        nullif(btrim(NEW.plan_type), ''),
        nullif(btrim(NEW.practice_area), ''),
        'Matter'
      ),
      NULL,
      round(NEW.flat_fee_amount * 100)::integer,
      'to_invoice',
      NULL,
      'engagement',
      coalesce(NEW.engagement_signed_at, statement_timestamp()),
      statement_timestamp()
    )
    ON CONFLICT (matter_id) WHERE source = 'engagement' DO NOTHING
    RETURNING * INTO v_item;

    IF v_item.id IS NOT NULL THEN
      INSERT INTO public.billing_events (
        billing_item_id,
        event_type,
        detail,
        metadata
      )
      VALUES (
        v_item.id,
        'item_seeded',
        'Engagement fee added to billing',
        jsonb_build_object('source', 'engagement')
      );
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.seed_engagement_billing_item()
  FROM PUBLIC, anon, authenticated, service_role;

-- One RPC serves both the single and the bulk path: deleting one charge is
-- deleting an array of length one, and both want the same all-or-nothing
-- statement rather than a per-id loop.
CREATE OR REPLACE FUNCTION public.delete_billing_items(
  p_item_ids uuid[],
  p_actor_id uuid
)
RETURNS SETOF public.billing_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(DISTINCT id) INTO v_ids
  FROM unnest(coalesce(p_item_ids, ARRAY[]::uuid[])) AS id
  WHERE id IS NOT NULL;

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'At least one charge is required' USING ERRCODE = '22023';
  END IF;

  -- Locked in a stable order so two staff deleting overlapping selections at
  -- once cannot deadlock against each other.
  PERFORM 1
  FROM public.billing_items
  WHERE id = ANY (v_ids)
  ORDER BY id
  FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.billing_items WHERE id = ANY (v_ids)) THEN
    RAISE EXCEPTION 'Billing item not found' USING ERRCODE = 'P0002';
  END IF;

  -- Written before the delete, so the cascading payments are still countable.
  INSERT INTO public.billing_item_deletions (
    billing_item_id, matter_id, kind, label, plan, amount_billed, status, source,
    payments_deleted, amount_collected, item_created_at, deleted_by
  )
  SELECT
    i.id, i.matter_id, i.kind, i.label, i.plan, i.amount_billed, i.status, i.source,
    coalesce(p.count, 0), coalesce(p.total, 0), i.created_at, p_actor_id
  FROM public.billing_items i
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS count, coalesce(sum(amount), 0)::integer AS total
    FROM public.billing_payments bp
    WHERE bp.billing_item_id = i.id
  ) p ON TRUE
  WHERE i.id = ANY (v_ids);

  RETURN QUERY
  DELETE FROM public.billing_items
  WHERE id = ANY (v_ids)
  RETURNING *;
END
$$;

REVOKE ALL ON FUNCTION public.delete_billing_items(uuid[], uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_billing_items(uuid[], uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
