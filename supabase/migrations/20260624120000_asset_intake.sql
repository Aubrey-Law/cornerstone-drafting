-- Normalized household asset inventory (keyed by client_intake_id).
-- Used by matter Assets tab and /api/admin/assets, /api/intake/assets.

CREATE TABLE IF NOT EXISTS public.asset_intake (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_intake_id uuid NOT NULL REFERENCES public.client_intake(id) ON DELETE CASCADE,
  category text NOT NULL,
  description text NOT NULL DEFAULT '',
  value numeric NOT NULL DEFAULT 0,
  ownership text NOT NULL DEFAULT 'client'
    CHECK (ownership IN ('client', 'spouse', 'joint')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asset_intake_client_intake_id_category_idx
  ON public.asset_intake (client_intake_id, category);

ALTER TABLE public.asset_intake ENABLE ROW LEVEL SECURITY;

-- Firm staff: full access
DROP POLICY IF EXISTS "staff_all_asset_intake" ON public.asset_intake;
CREATE POLICY "staff_all_asset_intake" ON public.asset_intake
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'attorney', 'va', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'attorney', 'va', 'staff')
    )
  );

-- Portal clients: own household intake only
DROP POLICY IF EXISTS "client_manage_own_asset_intake" ON public.asset_intake;
CREATE POLICY "client_manage_own_asset_intake" ON public.asset_intake
  FOR ALL
  TO authenticated
  USING (
    client_intake_id IN (
      SELECT id FROM public.client_intake
      WHERE user_id = auth.uid() OR client_user_id = auth.uid()
    )
  )
  WITH CHECK (
    client_intake_id IN (
      SELECT id FROM public.client_intake
      WHERE user_id = auth.uid() OR client_user_id = auth.uid()
    )
  );
