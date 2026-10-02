-- Cornerstone — add several charges to a matter in one step.
--
-- Staff entering a matter's charges (a fee, the recording costs, a claim per
-- MetLife schedule item) had to open the Add charge dialog once per line. The
-- dialog now collects several lines and saves them together.
--
-- create_billing_items wraps create_billing_item so every line gets the same
-- validation and its own item_created audit event, and the whole set runs in
-- one function call — one transaction. A bad line therefore leaves none of the
-- others behind, rather than half a batch the user has to find and finish.
--
-- service_role-only, like the single-charge RPC; called from
-- /api/admin/billing/items/bulk-create.

CREATE OR REPLACE FUNCTION public.create_billing_items(
  p_matter_id uuid,
  p_items jsonb,
  p_actor_id uuid
)
RETURNS SETOF public.billing_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_line jsonb;
  v_item public.billing_items;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one charge is required' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_items) > 25 THEN
    RAISE EXCEPTION 'At most 25 charges can be added at once' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) WITH ORDINALITY ORDER BY ordinality
  LOOP
    v_item := public.create_billing_item(
      p_matter_id,
      v_line->>'kind',
      v_line->>'label',
      v_line->>'plan',
      (v_line->>'amount_billed')::integer,
      p_actor_id
    );
    RETURN NEXT v_item;
  END LOOP;

  RETURN;
END
$$;

REVOKE ALL ON FUNCTION public.create_billing_items(uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_billing_items(uuid, jsonb, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
