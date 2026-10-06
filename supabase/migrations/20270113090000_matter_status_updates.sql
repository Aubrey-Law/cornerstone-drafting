-- Plan status updates: the answer to "where is my plan", on the record.
--
-- The portal showed four date milestones and a rule-based "what's next" line.
-- A client asking where things stand got no sentence from the firm unless
-- someone wrote one. Now, when a matter changes stage, a plain-language
-- update is drafted from the stage, the lifecycle requirements, the funding
-- tracker and the next appointment, and offered to the attorney through the
-- delegation dial. Approving it publishes the update here and posts it to
-- the client's portal conversation.
--
-- One row per published update. The newest is what the dashboard shows under
-- "Where your plan stands"; older ones are the history of what the client was
-- told, which is worth keeping when a client says "but you said".

CREATE TABLE IF NOT EXISTS public.matter_status_updates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id     uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,

  -- The stage the update describes, as it stood when it was published.
  stage         text NOT NULL,
  body          text NOT NULL,
  -- The facts the draft was written from, so a later reader can see what the
  -- update was true of.
  facts         jsonb NOT NULL DEFAULT '{}'::jsonb,

  source        text NOT NULL DEFAULT 'automation'
    CHECK (source IN ('automation', 'staff')),
  -- The portal message that carried the update to the client, when one was posted.
  message_id    uuid REFERENCES public.messages(id) ON DELETE SET NULL,

  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matter_status_updates_matter_published_idx
  ON public.matter_status_updates (matter_id, published_at DESC);

ALTER TABLE public.matter_status_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS matter_status_updates_staff_all ON public.matter_status_updates;
CREATE POLICY matter_status_updates_staff_all
  ON public.matter_status_updates FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

-- A client reads the updates published on their own matter; nothing else.
DROP POLICY IF EXISTS matter_status_updates_client_select ON public.matter_status_updates;
CREATE POLICY matter_status_updates_client_select
  ON public.matter_status_updates FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.matters m
      JOIN public.client_intake ci ON ci.id = m.client_intake_id
      WHERE m.id = matter_status_updates.matter_id
        AND (ci.user_id = (select auth.uid()) OR ci.client_user_id = (select auth.uid()))
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_status_updates TO authenticated;

COMMENT ON TABLE public.matter_status_updates IS
  'Plain-language "where your plan stands" updates published to the client, one '
  'per approval, drafted from stage and lifecycle data and approved by the '
  'attorney through the delegation dial. See lib/portal/planStatus.ts.';

NOTIFY pgrst, 'reload schema';
