/*
  # CRM Module — referral_sources, engagement_agreements, lead_activity, matter_details CRM columns

  1. New Tables
    - `referral_sources`
      - `id` (uuid, primary key) — unique referral source identifier
      - `name` (text, not null) — referral source display name
      - `type` (text) — category: attorney, financial_advisor, accountant, past_client, legal_plan_provider, web, phone, other
      - `contact_name` (text) — primary contact person
      - `contact_email` (text) — contact email
      - `contact_phone` (text) — contact phone
      - `firm_name` (text) — associated firm/organization
      - `notes` (text) — free-form notes
      - `is_active` (boolean, default true) — soft-delete flag
      - `created_at` / `updated_at` (timestamptz) — audit timestamps

    - `engagement_agreements`
      - `id` (uuid, primary key) — unique agreement identifier
      - `matter_id` (uuid, FK to matters) — linked matter/lead
      - `template_version` (text) — template version used
      - `fee_amount` (numeric) — agreed fee
      - `scope_of_work` (text) — services description
      - `payment_terms` (text) — payment schedule/terms
      - `generated_html` (text) — rendered agreement HTML
      - `generated_at` (timestamptz) — when the agreement was generated
      - `sent_at` (timestamptz) — when sent to client
      - `viewed_at` (timestamptz) — when client first viewed
      - `signed_at` (timestamptz) — when client signed
      - `signing_token` (text, unique) — public URL token for signing
      - `signer_ip` (text) — IP address at signing
      - `signer_user_agent` (text) — browser user agent at signing
      - `client_signature` (text) — base64 signature data
      - `signer_name` (text) — typed name at signing
      - `pdf_r2_key` (text) — R2 object key for signed PDF
      - `status` (text, default 'draft') — lifecycle: draft, sent, viewed, signed, voided
      - `created_at` / `updated_at` (timestamptz) — audit timestamps

    - `lead_activity`
      - `id` (uuid, primary key) — unique activity entry
      - `matter_id` (uuid, FK to matters) — linked matter/lead
      - `event_type` (text, not null) — event category
      - `description` (text) — human-readable description
      - `metadata` (jsonb) — additional structured data
      - `created_at` (timestamptz) — when event occurred

  2. Modified Tables
    - `matter_details` — adds CRM lead-tracking columns:
      - `lead_stage`, `lead_temperature`, `lead_source_type`
      - `referral_source_id` (FK to referral_sources)
      - `first_contact_date`, `next_follow_up_date`, `follow_up_notes`
      - `consultation_scheduled_at`, `consultation_completed_at`, `consultation_notes`
      - `lost_reason`, `lost_at`

  3. Security
    - RLS enabled on all new tables
    - Policies restrict access to authenticated users matching the admin attorney email
    - `engagement_agreements` has an additional public read policy for token-based signing access

  4. Indexes
    - `referral_sources.is_active` for filtered queries
    - `engagement_agreements.signing_token` for public signing page lookup
    - `engagement_agreements.matter_id` for joins
    - `lead_activity.matter_id` + `created_at` for timeline queries
    - `matter_details.lead_stage` and `client_status` for lead filtering
*/

-- ─── referral_sources ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.referral_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text DEFAULT 'other',
  contact_name  text,
  contact_email text,
  contact_phone text,
  firm_name   text,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.referral_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view referral sources"
  ON public.referral_sources FOR SELECT
  TO authenticated
  USING (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
    OR (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
  );

CREATE POLICY "Admins can insert referral sources"
  ON public.referral_sources FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
    OR (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
  );

CREATE POLICY "Admins can update referral sources"
  ON public.referral_sources FOR UPDATE
  TO authenticated
  USING (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
    OR (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
  )
  WITH CHECK (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
    OR (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
  );

CREATE POLICY "Admins can delete referral sources"
  ON public.referral_sources FOR DELETE
  TO authenticated
  USING (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
    OR (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
  );

CREATE INDEX IF NOT EXISTS idx_referral_sources_active ON public.referral_sources (is_active);

-- ─── engagement_agreements ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.engagement_agreements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id       uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  template_version text,
  fee_amount      numeric,
  scope_of_work   text,
  payment_terms   text,
  generated_html  text,
  generated_at    timestamptz,
  sent_at         timestamptz,
  viewed_at       timestamptz,
  signed_at       timestamptz,
  signing_token   text UNIQUE,
  signer_ip       text,
  signer_user_agent text,
  client_signature text,
  signer_name     text,
  pdf_r2_key      text,
  status          text NOT NULL DEFAULT 'draft',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.engagement_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view engagement agreements"
  ON public.engagement_agreements FOR SELECT
  TO authenticated
  USING (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
    OR (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
  );

CREATE POLICY "Admins can insert engagement agreements"
  ON public.engagement_agreements FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
    OR (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
  );

CREATE POLICY "Admins can update engagement agreements"
  ON public.engagement_agreements FOR UPDATE
  TO authenticated
  USING (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
    OR (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
  )
  WITH CHECK (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
    OR (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
  );

CREATE POLICY "Admins can delete engagement agreements"
  ON public.engagement_agreements FOR DELETE
  TO authenticated
  USING (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
    OR (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
  );

CREATE INDEX IF NOT EXISTS idx_engagement_agreements_token ON public.engagement_agreements (signing_token);
CREATE INDEX IF NOT EXISTS idx_engagement_agreements_matter ON public.engagement_agreements (matter_id);

-- ─── lead_activity ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lead_activity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  description text,
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view lead activity"
  ON public.lead_activity FOR SELECT
  TO authenticated
  USING (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
    OR (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
  );

CREATE POLICY "Admins can insert lead activity"
  ON public.lead_activity FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT (auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin'
    OR (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
  );

CREATE INDEX IF NOT EXISTS idx_lead_activity_matter_time ON public.lead_activity (matter_id, created_at DESC);

-- ─── matter_details CRM columns ───────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matter_details' AND column_name = 'lead_stage') THEN
    ALTER TABLE public.matter_details ADD COLUMN lead_stage text DEFAULT 'new_inquiry';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matter_details' AND column_name = 'lead_temperature') THEN
    ALTER TABLE public.matter_details ADD COLUMN lead_temperature text DEFAULT 'warm';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matter_details' AND column_name = 'lead_source_type') THEN
    ALTER TABLE public.matter_details ADD COLUMN lead_source_type text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matter_details' AND column_name = 'referral_source_id') THEN
    ALTER TABLE public.matter_details ADD COLUMN referral_source_id uuid REFERENCES public.referral_sources(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matter_details' AND column_name = 'first_contact_date') THEN
    ALTER TABLE public.matter_details ADD COLUMN first_contact_date date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matter_details' AND column_name = 'next_follow_up_date') THEN
    ALTER TABLE public.matter_details ADD COLUMN next_follow_up_date date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matter_details' AND column_name = 'follow_up_notes') THEN
    ALTER TABLE public.matter_details ADD COLUMN follow_up_notes text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matter_details' AND column_name = 'consultation_scheduled_at') THEN
    ALTER TABLE public.matter_details ADD COLUMN consultation_scheduled_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matter_details' AND column_name = 'consultation_completed_at') THEN
    ALTER TABLE public.matter_details ADD COLUMN consultation_completed_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matter_details' AND column_name = 'consultation_notes') THEN
    ALTER TABLE public.matter_details ADD COLUMN consultation_notes text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matter_details' AND column_name = 'lost_reason') THEN
    ALTER TABLE public.matter_details ADD COLUMN lost_reason text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matter_details' AND column_name = 'lost_at') THEN
    ALTER TABLE public.matter_details ADD COLUMN lost_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_matter_details_lead_stage ON public.matter_details (lead_stage);
CREATE INDEX IF NOT EXISTS idx_matter_details_client_status ON public.matter_details (client_status);

-- ─── Service-role bypass for engagement_agreements (for public signing page) ─
-- The signing page uses the service role to look up by token, so no anon policy needed.
-- The server action validates the token server-side.

COMMENT ON TABLE public.referral_sources IS 'Referral partners and lead sources for CRM tracking';
COMMENT ON TABLE public.engagement_agreements IS 'Client engagement agreements with e-signature tracking';
COMMENT ON TABLE public.lead_activity IS 'CRM activity timeline for leads and prospects';
