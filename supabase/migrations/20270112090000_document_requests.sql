-- Document requests: the list of things the firm needs from the client.
--
-- Until now "please send us the deed" lived in a recap email, a task on the
-- attorney's side, or nowhere. The client's portal offered a free-form upload
-- box and no list of what was wanted, and the firm had no record of what was
-- asked, what arrived, and what is still outstanding.
--
-- One row per request on a matter. The request is created by staff from the
-- Documents tab, or proposed by the meeting follow-up from what the client
-- agreed to send, through the delegation dial. The client sees the open
-- requests in the portal and uploads against one; the upload marks it
-- received and links the document; staff accept or waive it.
--
--   requested  asked for, nothing received yet
--   received   the client uploaded against it; staff have not looked
--   accepted   staff looked and it is what was asked for
--   waived     no longer needed

CREATE TABLE IF NOT EXISTS public.document_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id             uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,

  title                 text NOT NULL,
  description           text,
  due_on                date,

  status                text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'received', 'accepted', 'waived')),

  -- Where the request came from, so a card can say "from the design meeting".
  source                text NOT NULL DEFAULT 'staff'
    CHECK (source IN ('staff', 'meeting_notes', 'automation')),
  source_ref            text,

  requested_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at          timestamptz NOT NULL DEFAULT now(),

  received_document_id  uuid REFERENCES public.matter_documents(id) ON DELETE SET NULL,
  received_at           timestamptz,

  accepted_at           timestamptz,
  accepted_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  waived_at             timestamptz,
  waived_reason         text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_requests_matter_status_idx
  ON public.document_requests (matter_id, status, requested_at);

ALTER TABLE public.document_requests ENABLE ROW LEVEL SECURITY;

-- Staff read and write everything.
DROP POLICY IF EXISTS document_requests_staff_all ON public.document_requests;
CREATE POLICY document_requests_staff_all
  ON public.document_requests FOR ALL TO authenticated
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

-- A client reads the requests on their own matter. Writes from the portal go
-- through the upload route, which checks ownership and uses the service role,
-- so no client write policy is granted.
DROP POLICY IF EXISTS document_requests_client_select ON public.document_requests;
CREATE POLICY document_requests_client_select
  ON public.document_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.matters m
      JOIN public.client_intake ci ON ci.id = m.client_intake_id
      WHERE m.id = document_requests.matter_id
        AND (ci.user_id = (select auth.uid()) OR ci.client_user_id = (select auth.uid()))
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_requests TO authenticated;

COMMENT ON TABLE public.document_requests IS
  'What the firm has asked the client to send on a matter, and what has arrived. '
  'Shown in the client portal; created by staff or proposed by the meeting '
  'follow-up. See lib/documentRequests/.';

NOTIFY pgrst, 'reload schema';
