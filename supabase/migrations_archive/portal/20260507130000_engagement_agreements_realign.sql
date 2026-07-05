-- Realign engagement_agreements with the schema this codebase expects.
--
-- The Supabase migration history records only the migrations from this repo
-- (crm_module → engagement_lead_scope → engagement_signwell_columns), but
-- the live table had been altered out-of-band with DocuSeal + Stripe +
-- dual-signer columns that no migration introduced. This drops the rogue
-- columns / view / FK and re-adds the columns the codebase reads and writes.
-- Safe at write time because the table is empty.

DROP VIEW IF EXISTS public.v_engagements_dashboard;

ALTER TABLE public.engagement_agreements
  DROP CONSTRAINT IF EXISTS engagement_agreements_matter_document_id_fkey;

ALTER TABLE public.engagement_agreements
  DROP COLUMN IF EXISTS template_variant,
  DROP COLUMN IF EXISTS fee_structure,
  DROP COLUMN IF EXISTS retainer_amount,
  DROP COLUMN IF EXISTS scope_description,
  DROP COLUMN IF EXISTS special_provisions,
  DROP COLUMN IF EXISTS generated_pdf_url,
  DROP COLUMN IF EXISTS submitter_count,
  DROP COLUMN IF EXISTS primary_signer_name,
  DROP COLUMN IF EXISTS primary_signer_email,
  DROP COLUMN IF EXISTS secondary_signer_name,
  DROP COLUMN IF EXISTS secondary_signer_email,
  DROP COLUMN IF EXISTS docuseal_submission_id,
  DROP COLUMN IF EXISTS docuseal_template_id,
  DROP COLUMN IF EXISTS primary_signing_url,
  DROP COLUMN IF EXISTS secondary_signing_url,
  DROP COLUMN IF EXISTS primary_signed_at,
  DROP COLUMN IF EXISTS secondary_signed_at,
  DROP COLUMN IF EXISTS fully_executed_at,
  DROP COLUMN IF EXISTS declined_at,
  DROP COLUMN IF EXISTS decline_reason,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS executed_pdf_r2_key,
  DROP COLUMN IF EXISTS matter_document_id,
  DROP COLUMN IF EXISTS stripe_payment_link_id,
  DROP COLUMN IF EXISTS stripe_payment_link_url,
  DROP COLUMN IF EXISTS stripe_payment_intent_id,
  DROP COLUMN IF EXISTS payment_status,
  DROP COLUMN IF EXISTS paid_at,
  DROP COLUMN IF EXISTS auto_executed_at,
  DROP COLUMN IF EXISTS auto_execution_progress,
  DROP COLUMN IF EXISTS auto_execution_error,
  DROP COLUMN IF EXISTS created_by;

ALTER TABLE public.engagement_agreements
  ADD COLUMN IF NOT EXISTS template_version  text,
  ADD COLUMN IF NOT EXISTS scope_of_work     text,
  ADD COLUMN IF NOT EXISTS payment_terms     text,
  ADD COLUMN IF NOT EXISTS generated_html    text,
  ADD COLUMN IF NOT EXISTS generated_at      timestamptz,
  ADD COLUMN IF NOT EXISTS viewed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS signed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS signing_token     text,
  ADD COLUMN IF NOT EXISTS signer_ip         text,
  ADD COLUMN IF NOT EXISTS signer_user_agent text,
  ADD COLUMN IF NOT EXISTS client_signature  text,
  ADD COLUMN IF NOT EXISTS signer_name       text,
  ADD COLUMN IF NOT EXISTS pdf_r2_key        text;

CREATE UNIQUE INDEX IF NOT EXISTS engagement_agreements_signing_token_key
  ON public.engagement_agreements (signing_token)
  WHERE signing_token IS NOT NULL;
