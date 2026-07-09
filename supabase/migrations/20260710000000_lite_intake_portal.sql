-- Cornerstone Lite — intake portal columns + client document upload RLS
-- Greenfield-friendly; idempotent for re-runs.

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS intake_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS referral_source text,
  ADD COLUMN IF NOT EXISTS goals jsonb,
  ADD COLUMN IF NOT EXISTS additional_contacts jsonb,
  ADD COLUMN IF NOT EXISTS family_details jsonb,
  ADD COLUMN IF NOT EXISTS financial_details jsonb,
  ADD COLUMN IF NOT EXISTS document_inclusions jsonb,
  ADD COLUMN IF NOT EXISTS current_step text,
  ADD COLUMN IF NOT EXISTS unlock_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS intake_invite_token uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS preferred_name text,
  ADD COLUMN IF NOT EXISTS citizenship text,
  ADD COLUMN IF NOT EXISTS occupation text,
  ADD COLUMN IF NOT EXISTS employer text,
  ADD COLUMN IF NOT EXISTS marriage_date date,
  ADD COLUMN IF NOT EXISTS prior_marriage boolean,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS unread_client_messages integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unread_attorney_messages integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS track text NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN IF NOT EXISTS review_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS design_meeting_at timestamptz,
  ADD COLUMN IF NOT EXISTS revision_round integer NOT NULL DEFAULT 0;

-- Clients may upload into the client folder for their own matter.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'matter_documents'
      AND policyname = 'client_insert_own_client_folder_documents'
  ) THEN
    CREATE POLICY "client_insert_own_client_folder_documents"
      ON public.matter_documents
      FOR INSERT TO authenticated
      WITH CHECK (
        lower(coalesce(folder, '')) = 'client'
        AND (
          EXISTS (
            SELECT 1 FROM public.matters m
            WHERE m.id::text = matter_documents.matter_id
              AND m.client_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM public.v_matter_pipeline v
            WHERE v.matter_id::text = matter_documents.matter_id
              AND v.client_email = (SELECT email FROM auth.users WHERE id = auth.uid())
          )
        )
      );
  END IF;
END $$;
