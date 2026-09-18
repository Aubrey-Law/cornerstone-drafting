-- Make the intake lock real.
--
-- `client_intake_update_own` granted a signed-in client unrestricted UPDATE on
-- their own row:
--
--   CREATE POLICY "client_intake_update_own"
--     ON public.client_intake FOR UPDATE TO authenticated
--     USING (user_id = auth.uid() OR client_user_id = auth.uid())
--     WITH CHECK (user_id = auth.uid() OR client_user_id = auth.uid());
--
-- No column restriction. The anon key ships in the browser bundle and the
-- client holds their own portal JWT, so both halves of a PostgREST request were
-- already in their hands. That let them PATCH the row directly and set `status`
-- back to 'draft' on a questionnaire the attorney had already received, edit
-- answers after they were reviewed, or clear `attorney_review_flags` — none of
-- which /api/intake permits, and none of which leaves a trace. The "Intake is
-- locked. Contact your attorney to make changes." gate at
-- app/api/intake/route.ts was the only thing enforcing it, and application code
-- is not a boundary when the caller can address the database itself.
--
-- `client_intake_insert_own` is the same shape and goes with it. client_intake
-- is also the firm's lead table — lib/leads/createLead.ts inserts here — so the
-- policy let a portal client add rows to the CRM.
--
-- The client's questionnaire still saves: /api/intake and
-- lib/intake/getOrCreateClientIntake.ts now write through the service role,
-- after checking ownership themselves, which is where the lock check already
-- lived. Nothing in the browser ever wrote this table directly — the intake
-- components use the browser Supabase client only for `auth.getSession()` — so
-- no client-side path loses anything.
--
-- SELECT stays: the portal reads the row through the user's own session, and
-- that read is what proves ownership for lib/portal/getMatterForUser.ts.
-- The attorney policy is untouched.

DROP POLICY IF EXISTS "client_intake_update_own" ON public.client_intake;
DROP POLICY IF EXISTS "client_intake_insert_own" ON public.client_intake;

COMMENT ON TABLE public.client_intake IS
  'Client questionnaires and CRM leads. Clients may read their own row and nothing else: every write goes through the service-role client, which is what makes the submitted/approved lock enforceable rather than advisory.';

NOTIFY pgrst, 'reload schema';
