-- Cornerstone — a firm record of every permanently deleted matter.
--
-- Deleting a matter used to be reserved for prospects: `deleteMatter` refused
-- anything hired or carrying a signed engagement, so the only exits a real
-- client matter had were `closed` and `archived`. Both keep the row forever,
-- which is wrong for a matter opened by mistake, a duplicate created by an
-- import, or a client who asks the firm to destroy their file.
--
-- Permanent deletion is now allowed for those matters too, with an explicit
-- confirmation. What makes that defensible is this table: it holds no foreign
-- key to `matters`, so it survives the delete and records what was destroyed,
-- whether the matter had been hired or signed, how many documents went with it,
-- and which administrator did it. `billing_item_deletions` (20260915000000) is
-- the same idea one level down.
--
-- Writes stay off the client. `authenticated` keeps SELECT only, and the rows
-- are inserted by the service-role delete routes.

CREATE TABLE IF NOT EXISTS public.matter_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deliberately no FK: the matters row is gone by the time this is read.
  matter_id uuid NOT NULL,
  client_intake_id uuid,
  matter_number text,
  matter_name text,
  stage text,
  -- The two lifecycle axes the matter was on when it was destroyed, so the log
  -- can answer "was this a live client matter?" without the row to look at.
  relationship_status text NOT NULL,
  status text NOT NULL,
  had_signed_engagement boolean NOT NULL DEFAULT false,
  documents_deleted integer NOT NULL DEFAULT 0,
  reason text,
  matter_created_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_by_email text,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matter_deletions_deleted_at_idx
  ON public.matter_deletions (deleted_at DESC);
CREATE INDEX IF NOT EXISTS matter_deletions_matter_idx
  ON public.matter_deletions (matter_id);

ALTER TABLE public.matter_deletions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS matter_deletions_staff_select ON public.matter_deletions;
CREATE POLICY matter_deletions_staff_select
  ON public.matter_deletions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

GRANT SELECT ON public.matter_deletions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.matter_deletions FROM authenticated;

NOTIFY pgrst, 'reload schema';
