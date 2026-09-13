-- Editing a work skill overwrote skill_md in place with no history, so the
-- loser of two concurrent edits lost their work with nothing to recover from.
-- The PATCH route now guards on updated_at; this keeps the prior text so an
-- overwrite is recoverable either way.
--
-- Mirrors estate_clause_revisions: append-only, service-role only, read-only
-- for staff.

CREATE TABLE IF NOT EXISTS public.work_skill_revisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id    uuid NOT NULL REFERENCES public.work_skills(id) ON DELETE CASCADE,
  skill_md    text NOT NULL,
  name        text NOT NULL,
  version     text NOT NULL,
  edited_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_skill_revisions_skill
  ON public.work_skill_revisions(skill_id, created_at DESC);

ALTER TABLE public.work_skill_revisions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'staff_read_work_skill_revisions'
  ) THEN
    CREATE POLICY "staff_read_work_skill_revisions"
      ON public.work_skill_revisions FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;
END $$;

-- Writes are service-role only: the API route records a revision, nobody edits one.
REVOKE INSERT, UPDATE, DELETE ON public.work_skill_revisions FROM authenticated;
GRANT SELECT ON public.work_skill_revisions TO authenticated;
GRANT ALL ON public.work_skill_revisions TO service_role;

COMMENT ON TABLE public.work_skill_revisions IS
  'Append-only history of work_skills.skill_md, written on every edit.';

-- The only index on work_skill_shares was on lower(shared_with_email), while
-- every query filters the raw column — so it could never be used.
CREATE INDEX IF NOT EXISTS idx_work_skill_shares_email_exact
  ON public.work_skill_shares(shared_with_email);
