-- Children single-source: give the orphan DesignSheetChild plan-attributes a home
-- on the contacts row so `contacts` can be the single source of truth for children
-- (mirrors the spouse single-source model). `client_intake.children` and
-- `design_sheets.children` become projections maintained by saveHouseholdChildren.
--
-- Applied MANUALLY (this repo's migration history is diverged — do NOT blind
-- `supabase db push`, which would replay non-idempotent migrations). Every
-- statement below is guarded so re-running is safe.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS child_relationship text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS parentage text;
-- is_minor is an OVERRIDE only: NULL means "derive from date_of_birth".
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
