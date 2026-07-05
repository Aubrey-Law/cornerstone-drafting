-- The existing policy queried auth.users from inside the RLS predicate, which
-- fails for the authenticated role (no SELECT grant on auth.users → 42501).
-- Switch to auth.jwt() ->> 'email', which is what other admin policies on this
-- DB already use (see matter_details).

DROP POLICY IF EXISTS attorneys_full_access_flags ON matter_flags;

CREATE POLICY attorneys_full_access_flags ON matter_flags
  FOR ALL
  USING ((auth.jwt() ->> 'email') = 'scott@aubreylegal.com')
  WITH CHECK ((auth.jwt() ->> 'email') = 'scott@aubreylegal.com');
