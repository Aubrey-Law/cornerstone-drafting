-- Security hardening: close three RLS holes that let any authenticated user
-- escalate privileges, read every matter's activity, or corrupt SLA math.
--
-- Context: supabase/seed.sql grants SELECT/INSERT/UPDATE/DELETE on ALL tables in
-- `public` to `authenticated` (and SELECT to `anon`), matching Supabase's cloud
-- defaults. RLS is therefore the only boundary — a table without RLS, or with an
-- `auth.uid() IS NOT NULL` policy, is effectively public to every signed-in user.

-- ─── 1. public.users.role is the app's authorization source of truth ────────────
-- Previously `users_update_own` pinned only `id`, so any authenticated user could
-- PATCH their own row to role='admin' via PostgREST using the public anon key and
-- pass every requireAdmin / proxy.ts / RLS staff check.

DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- role may never be changed by the row owner; only service_role (which
    -- bypasses RLS) may promote or demote a user.
    AND role = (SELECT u.role FROM public.users u WHERE u.id = auth.uid())
  );

-- Self-insert is still needed for greenfield bootstrap, but the role must not be
-- caller-chosen. Staff provisioning goes through ensure_user_profile() below,
-- which derives the role from the verified JWT email.
DROP POLICY IF EXISTS "users_insert_own" ON public.users;
CREATE POLICY "users_insert_own"
  ON public.users FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() AND role = 'client');

-- Bootstrap a public.users row for the calling auth user. The role is derived
-- from the email on the *verified* JWT, never from client input, so this is safe
-- to expose to `authenticated`. Returns the effective role.
CREATE OR REPLACE FUNCTION public.ensure_user_profile(p_display_name text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_email        text;
  v_role         text;
  v_existing     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ensure_user_profile requires an authenticated session';
  END IF;

  SELECT u.role INTO v_existing FROM public.users u WHERE u.id = v_uid;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Prefer the confirmed address on auth.users over any JWT claim.
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_uid;

  v_role := CASE
    WHEN v_email IS NOT NULL AND lower(v_email) LIKE '%@aubreylegal.com' THEN 'attorney'
    ELSE 'client'
  END;

  INSERT INTO public.users (id, email, display_name, role)
  VALUES (v_uid, v_email, nullif(btrim(coalesce(p_display_name, '')), ''), v_role)
  ON CONFLICT (id) DO NOTHING;

  SELECT u.role INTO v_existing FROM public.users u WHERE u.id = v_uid;
  RETURN coalesce(v_existing, v_role);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile(text) TO authenticated, service_role;

-- ─── 2. matter_activity was readable and writable by every authenticated user ───
-- Portal clients are `authenticated`. lib/sms/inbound.ts stores full inbound SMS
-- bodies in matter_activity.metadata, so the old policies leaked one client's
-- message content to every other client, and allowed forged activity rows.

DROP POLICY IF EXISTS "authenticated_select_matter_activity" ON public.matter_activity;
DROP POLICY IF EXISTS "authenticated_insert_matter_activity" ON public.matter_activity;
-- Idempotent: this migration may have been applied by hand in the SQL editor
-- before the CLI recorded it, so `supabase db push` can legitimately re-run it.
DROP POLICY IF EXISTS "staff_select_matter_activity" ON public.matter_activity;
DROP POLICY IF EXISTS "staff_insert_matter_activity" ON public.matter_activity;

CREATE POLICY "staff_select_matter_activity"
  ON public.matter_activity FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin', 'va', 'staff')
    )
  );

CREATE POLICY "staff_insert_matter_activity"
  ON public.matter_activity FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin', 'va', 'staff')
    )
  );

-- ─── 3. firm_holidays never enabled RLS ────────────────────────────────────────
-- business_days_elapsed() subtracts these dates, so a client-inserted row
-- silently suppresses every SLA/aging overdue calculation.

ALTER TABLE public.firm_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.firm_holidays FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.firm_holidays TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_holidays TO service_role;

DROP POLICY IF EXISTS "staff_select_firm_holidays" ON public.firm_holidays;
CREATE POLICY "staff_select_firm_holidays"
  ON public.firm_holidays FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin', 'va', 'staff')
    )
  );
