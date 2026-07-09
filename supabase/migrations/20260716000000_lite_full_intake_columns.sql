-- Cornerstone Lite — full client intake parity with aubrey-law-app questionnaire

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS suffix text,
  ADD COLUMN IF NOT EXISTS prior_names text,
  ADD COLUMN IF NOT EXISTS has_children boolean,
  ADD COLUMN IF NOT EXISTS date_of_marriage date,
  ADD COLUMN IF NOT EXISTS estate_value text,
  ADD COLUMN IF NOT EXISTS has_real_property boolean,
  ADD COLUMN IF NOT EXISTS has_retirement boolean,
  ADD COLUMN IF NOT EXISTS has_investments boolean,
  ADD COLUMN IF NOT EXISTS has_business boolean,
  ADD COLUMN IF NOT EXISTS has_life_insurance boolean,
  ADD COLUMN IF NOT EXISTS has_ltc_insurance boolean,
  ADD COLUMN IF NOT EXISTS has_existing_plan boolean,
  ADD COLUMN IF NOT EXISTS has_major_illness boolean,
  ADD COLUMN IF NOT EXISTS has_family_disability boolean,
  ADD COLUMN IF NOT EXISTS has_prior_gift_tax boolean,
  ADD COLUMN IF NOT EXISTS is_trust_beneficiary boolean,
  ADD COLUMN IF NOT EXISTS has_divorce_settlement boolean,
  ADD COLUMN IF NOT EXISTS planning_goals text[],
  ADD COLUMN IF NOT EXISTS planning_objectives text,
  ADD COLUMN IF NOT EXISTS review_choices jsonb,
  ADD COLUMN IF NOT EXISTS spouse_as_fiduciary boolean,
  ADD COLUMN IF NOT EXISTS excluded_guardian text,
  ADD COLUMN IF NOT EXISTS excluded_guardian_2 text,
  ADD COLUMN IF NOT EXISTS special_notes text,
  ADD COLUMN IF NOT EXISTS other_individuals jsonb,
  ADD COLUMN IF NOT EXISTS attorney_review_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS unlock_request_note text,
  ADD COLUMN IF NOT EXISTS intake_token_last_used_at timestamptz;

ALTER TABLE public.design_sheets
  ADD COLUMN IF NOT EXISTS intake_review_flags jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.intake_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_intake_id  uuid NOT NULL REFERENCES public.client_intake(id) ON DELETE CASCADE,
  r2_key            text NOT NULL UNIQUE,
  name              text NOT NULL,
  size              bigint NOT NULL DEFAULT 0,
  content_type      text NOT NULL DEFAULT 'application/octet-stream',
  kind              text NOT NULL DEFAULT 'general',
  uploaded_by       uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_documents_intake
  ON public.intake_documents(client_intake_id, created_at DESC);

ALTER TABLE public.intake_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_read_own_intake_documents"
  ON public.intake_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_intake ci
      WHERE ci.id = intake_documents.client_intake_id
        AND (ci.user_id = auth.uid() OR ci.client_user_id = auth.uid())
    )
  );

CREATE POLICY "clients_insert_own_intake_documents"
  ON public.intake_documents FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_intake ci
      WHERE ci.id = intake_documents.client_intake_id
        AND (ci.user_id = auth.uid() OR ci.client_user_id = auth.uid())
    )
  );

CREATE POLICY "clients_delete_own_intake_documents"
  ON public.intake_documents FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_intake ci
      WHERE ci.id = intake_documents.client_intake_id
        AND (ci.user_id = auth.uid() OR ci.client_user_id = auth.uid())
    )
  );

CREATE POLICY "attorneys_all_intake_documents"
  ON public.intake_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

CREATE TABLE IF NOT EXISTS public.intake_invite_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_intake_id uuid REFERENCES public.client_intake(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_invite_audit_intake_idx
  ON public.intake_invite_audit (client_intake_id, created_at DESC);

ALTER TABLE public.intake_invite_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intake_invite_audit FROM anon, authenticated;
GRANT ALL ON public.intake_invite_audit TO service_role;

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket       text NOT NULL,
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start
  ON public.rate_limits (window_start);

CREATE OR REPLACE FUNCTION public.rate_limit_consume(
  p_bucket          text,
  p_key             text,
  p_window_seconds  integer
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_window_start timestamptz;
  v_count        integer;
BEGIN
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limits (bucket, key, window_start, count)
  VALUES (p_bucket, p_key, v_window_start, 1)
  ON CONFLICT (bucket, key, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rate_limit_consume(text, text, integer) TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.contact_roles
  ADD COLUMN IF NOT EXISTS client_intake_id uuid REFERENCES public.client_intake(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_contact_roles_intake
  ON public.contact_roles(client_intake_id)
  WHERE client_intake_id IS NOT NULL;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS created_by_client_at timestamptz,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS deceased boolean;

NOTIFY pgrst, 'reload schema';
