-- Firm-side billing ledger. Monetary values are integer cents.

CREATE TABLE IF NOT EXISTS public.billing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('flat_fee', 'plan_claim', 'cost')),
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  plan text CHECK (plan IS NULL OR plan IN ('metlife', 'legalease')),
  amount_billed integer NOT NULL CHECK (amount_billed > 0),
  status text NOT NULL DEFAULT 'to_invoice'
    CHECK (status IN ('to_invoice', 'invoiced', 'claim_submitted', 'partial', 'paid')),
  invoiced_at timestamptz,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('engagement', 'manual', 'workflow')),
  last_reminded_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_items_plan_kind_check CHECK (
    (kind = 'plan_claim' AND plan IS NOT NULL)
    OR (kind <> 'plan_claim' AND plan IS NULL)
  )
);

CREATE UNIQUE INDEX billing_items_one_engagement_source
  ON public.billing_items (matter_id)
  WHERE source = 'engagement';
CREATE INDEX billing_items_status_age_idx
  ON public.billing_items (status, invoiced_at)
  WHERE status <> 'paid';
CREATE INDEX billing_items_matter_created_idx
  ON public.billing_items (matter_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_item_id uuid NOT NULL REFERENCES public.billing_items(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('check', 'card', 'ach', 'plan_eft', 'cash')),
  note text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_payments_item_received_idx
  ON public.billing_payments (billing_item_id, received_at, id);
CREATE INDEX billing_payments_received_idx
  ON public.billing_payments (received_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_item_id uuid NOT NULL REFERENCES public.billing_items(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (
    event_type IN ('item_seeded', 'invoice_marked_sent', 'payment_recorded', 'reminder_recorded')
  ),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  detail text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_events_item_created_idx
  ON public.billing_events (billing_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_nudge_dismissals (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nudge_key text NOT NULL CHECK (length(btrim(nudge_key)) > 0),
  week_start date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, nudge_key, week_start)
);

ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS billing_annual_goal_cents integer NOT NULL DEFAULT 12000000
  CHECK (billing_annual_goal_cents > 0);

ALTER TABLE public.billing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_nudge_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_items_staff_select
  ON public.billing_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

CREATE POLICY billing_payments_staff_select
  ON public.billing_payments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

CREATE POLICY billing_events_staff_select
  ON public.billing_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

CREATE POLICY billing_nudge_dismissals_own_rows
  ON public.billing_nudge_dismissals FOR ALL TO authenticated
  USING (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

GRANT SELECT ON public.billing_items, public.billing_payments, public.billing_events TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.billing_nudge_dismissals TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.billing_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.billing_payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.billing_events FROM authenticated;

-- The engagement-seeding trigger below fires on `fee_payment_status`, and a
-- CREATE TRIGGER ... UPDATE OF <column> is checked when the trigger is created,
-- not when it runs. The column is properly introduced (backfilled from
-- fee_collected, defaulted, made NOT NULL, constrained) in
-- 20260811000000_matter_fee_payment_status.sql, which lands later in the
-- sequence. That was fine on a database where this migration had already run,
-- but it made the chain unreplayable from scratch — a fresh `supabase db reset`
-- or a new staging project died right here.
--
-- Declaring the bare column makes this migration self-sufficient without
-- duplicating the later one: ADD COLUMN IF NOT EXISTS is a no-op there, and the
-- backfill, default, NOT NULL and CHECK still belong to it. The function body
-- below reads the column through coalesce(), so a nullable column with no
-- default is safe in the window between the two migrations.
ALTER TABLE public.matter_details
  ADD COLUMN IF NOT EXISTS fee_payment_status text;

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
     AND coalesce(NEW.fee_payment_status, 'unpaid') = 'unpaid' THEN
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

DROP TRIGGER IF EXISTS trg_seed_engagement_billing_item ON public.matter_details;
CREATE TRIGGER trg_seed_engagement_billing_item
  AFTER INSERT OR UPDATE OF engagement_signed, flat_fee_amount, fee_payment_status
  ON public.matter_details
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_engagement_billing_item();

REVOKE ALL ON FUNCTION public.seed_engagement_billing_item() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_billing_item_invoiced(
  p_item_id uuid,
  p_actor_id uuid
)
RETURNS public.billing_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_item public.billing_items;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item
  FROM public.billing_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing item not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status <> 'to_invoice' THEN
    RAISE EXCEPTION 'Only items awaiting invoice may be marked sent' USING ERRCODE = '22023';
  END IF;

  UPDATE public.billing_items
  SET status = 'invoiced',
      invoiced_at = statement_timestamp(),
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  INSERT INTO public.billing_events (
    billing_item_id, event_type, actor_id, detail
  )
  VALUES (
    p_item_id, 'invoice_marked_sent', p_actor_id, 'Invoice marked sent'
  );

  RETURN v_item;
END
$$;

REVOKE ALL ON FUNCTION public.mark_billing_item_invoiced(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_billing_item_invoiced(uuid, uuid) TO service_role;

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

CREATE OR REPLACE FUNCTION public.mark_billing_reminder_sent(
  p_item_id uuid,
  p_actor_id uuid
)
RETURNS public.billing_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_item public.billing_items;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or admin access required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.billing_items
  SET last_reminded_at = statement_timestamp(),
      updated_by = p_actor_id,
      updated_at = statement_timestamp()
  WHERE id = p_item_id
    AND status <> 'paid'
  RETURNING * INTO v_item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open billing item not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.billing_events (
    billing_item_id, event_type, actor_id, detail
  )
  VALUES (
    p_item_id, 'reminder_recorded', p_actor_id, 'Payment reminder recorded'
  );

  RETURN v_item;
END
$$;

REVOKE ALL ON FUNCTION public.mark_billing_reminder_sent(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_billing_reminder_sent(uuid, uuid)
  TO service_role;

-- Trigger functions are not application APIs.
REVOKE ALL ON FUNCTION public.seed_engagement_billing_item() FROM service_role;

NOTIFY pgrst, 'reload schema';
