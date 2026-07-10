-- Local development seed / schema reconciliation for the drafting baseline.
-- Auto-runs after migrations on `supabase db reset` (and on the first
-- `supabase start`). Safe/idempotent to re-run. NOT used by the hosted firm DB.
--
-- Why this file is needed for local dev:
--  1) Grants: the local Supabase stack's default privileges omit
--     SELECT/INSERT/UPDATE for anon/authenticated on `public` tables. The
--     drafting migrations rely on those grants (RLS controls the rows), so
--     without them the users-role lookup in proxy.ts returns null and login
--     ends in an /auth/login <-> /admin/drafting redirect loop.
--  2) Columns: the trimmed "drafting baseline" migrations omit a few columns
--     the current app code reads/writes (contacts.is_minor,
--     design_sheets.client_pronouns / spouse_pronouns). The hosted firm DB has
--     them; local greenfield needs them for the matter workspace to load and
--     for design-sheet edits to save.

-- ── Grants (match hosted Supabase platform defaults) ─────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- ── Column parity with the app code ──────────────────────────────────────────
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

ALTER TABLE public.design_sheets ADD COLUMN IF NOT EXISTS client_pronouns text;
ALTER TABLE public.design_sheets ADD COLUMN IF NOT EXISTS spouse_pronouns text;
ALTER TABLE public.design_sheets ADD COLUMN IF NOT EXISTS excluded_guardian_flag boolean DEFAULT false;
ALTER TABLE public.design_sheets ADD COLUMN IF NOT EXISTS excluded_guardian_name text;

NOTIFY pgrst, 'reload schema';
