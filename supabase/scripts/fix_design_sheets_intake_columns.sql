-- Run in Supabase SQL Editor if drafting workspace errors after intake submit.
-- Safe to re-run.

\i is not supported — paste the migration file contents or run:
-- supabase/migrations/20260715000000_lite_design_sheets_intake_columns.sql

ALTER TABLE public.design_sheets
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS client_dob date,
  ADD COLUMN IF NOT EXISTS client_phone text,
  ADD COLUMN IF NOT EXISTS client_email text,
  ADD COLUMN IF NOT EXISTS client_citizenship text,
  ADD COLUMN IF NOT EXISTS client_domicile text,
  ADD COLUMN IF NOT EXISTS client_pronouns text,
  ADD COLUMN IF NOT EXISTS client_aka text,
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS zip text,
  ADD COLUMN IF NOT EXISTS county text,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS spouse_name text,
  ADD COLUMN IF NOT EXISTS spouse_dob date,
  ADD COLUMN IF NOT EXISTS spouse_phone text,
  ADD COLUMN IF NOT EXISTS spouse_email text,
  ADD COLUMN IF NOT EXISTS spouse_citizenship text,
  ADD COLUMN IF NOT EXISTS spouse_pronouns text,
  ADD COLUMN IF NOT EXISTS marriage_date date,
  ADD COLUMN IF NOT EXISTS trustee_primary text,
  ADD COLUMN IF NOT EXISTS trustee_co text,
  ADD COLUMN IF NOT EXISTS trustee_alt1 text,
  ADD COLUMN IF NOT EXISTS trustee_alt1_co text,
  ADD COLUMN IF NOT EXISTS trustee_alt2 text,
  ADD COLUMN IF NOT EXISTS executor_primary text,
  ADD COLUMN IF NOT EXISTS executor_co text,
  ADD COLUMN IF NOT EXISTS executor_alt1 text,
  ADD COLUMN IF NOT EXISTS executor_alt1_co text,
  ADD COLUMN IF NOT EXISTS executor_same_as_trustee boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS spouse_executor_same_as_trustee boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS poa_primary text,
  ADD COLUMN IF NOT EXISTS poa_co text,
  ADD COLUMN IF NOT EXISTS poa_alt1 text,
  ADD COLUMN IF NOT EXISTS poa_same_as_trustee boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS hcp_primary text,
  ADD COLUMN IF NOT EXISTS hcp_co text,
  ADD COLUMN IF NOT EXISTS hcp_alt1 text,
  ADD COLUMN IF NOT EXISTS hcp_alt1_co text,
  ADD COLUMN IF NOT EXISTS guardian_primary text,
  ADD COLUMN IF NOT EXISTS guardian_co text,
  ADD COLUMN IF NOT EXISTS guardian_alt1 text,
  ADD COLUMN IF NOT EXISTS guardian_alt1_co text,
  ADD COLUMN IF NOT EXISTS flags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS drafting_notes text,
  ADD COLUMN IF NOT EXISTS real_property_transfer text,
  ADD COLUMN IF NOT EXISTS trust_type text,
  ADD COLUMN IF NOT EXISTS marital_trust_type text,
  ADD COLUMN IF NOT EXISTS marital_trust_remarriage text,
  ADD COLUMN IF NOT EXISTS include_qdot text,
  ADD COLUMN IF NOT EXISTS family_trust_remarriage text,
  ADD COLUMN IF NOT EXISTS common_trust text,
  ADD COLUMN IF NOT EXISTS residuary_distribution text,
  ADD COLUMN IF NOT EXISTS withdrawal_right text,
  ADD COLUMN IF NOT EXISTS poa_client_co_authority text,
  ADD COLUMN IF NOT EXISTS poa_spouse_co_authority text,
  ADD COLUMN IF NOT EXISTS marital_status_clause text,
  ADD COLUMN IF NOT EXISTS doc_date date,
  ADD COLUMN IF NOT EXISTS ordinal_doc_date text,
  ADD COLUMN IF NOT EXISTS notary_commission text,
  ADD COLUMN IF NOT EXISTS notary_commission_expiration date,
  ADD COLUMN IF NOT EXISTS signing_month text,
  ADD COLUMN IF NOT EXISTS signing_year text,
  ADD COLUMN IF NOT EXISTS former_spouse_name text,
  ADD COLUMN IF NOT EXISTS deceased_spouse_name text,
  ADD COLUMN IF NOT EXISTS is_joint boolean DEFAULT false;

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS is_minor boolean;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_child_relationship_check') THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_child_relationship_check
      CHECK (child_relationship IS NULL OR child_relationship IN ('biological','adopted','stepchild'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_parentage_check') THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_parentage_check
      CHECK (parentage IS NULL OR parentage IN ('joint','client','spouse'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('20260715000000')
ON CONFLICT DO NOTHING;
