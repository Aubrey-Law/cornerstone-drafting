-- Inbound mail on the record.
--
-- Until now the only inbound email Cornerstone knew about was the thread
-- waiting on a reply, in the triage queue, and a record's communications
-- history showed outbound email alone. A client who wrote three times about
-- the same deed, and was answered from Gmail each time, left no trace on
-- their matter.
--
-- The triage scan already lists every thread in the mailbox window and reads
-- its headers. This table is where it files the inbound messages whose sender
-- it can match to a hired matter, a lead or a contact: one row per message,
-- keyed by mailbox and Gmail message id so a rescan is an update and never a
-- second copy.
--
-- Snippets, never bodies, for the same reasons set out on
-- email_triage_threads: the mailbox stays the system of record, with its own
-- retention and the correspondent's own expectations. A row carries Gmail's
-- preview and the ids needed to read the message live when the attorney opens
-- it from the record.
--
-- Mail from senders the firm cannot place (possible leads, vendors, lists) is
-- not filed: a record is the firm's file on a person, and only mail from that
-- person, or someone the firm has recorded around them, belongs in it.

CREATE TABLE IF NOT EXISTS public.email_inbound_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which mailbox this was read from; part of the natural key, as on the
  -- triage table.
  connection_email   text NOT NULL,
  gmail_thread_id    text NOT NULL,
  gmail_message_id   text NOT NULL,
  message_id_header  text,

  sender_email       text NOT NULL,
  sender_name        text,
  subject            text,
  snippet            text,
  received_at        timestamptz NOT NULL,

  -- How the sender was placed. Only these three are ever filed.
  classification     text NOT NULL
    CHECK (classification IN ('client', 'lead', 'contact')),
  client_intake_id   uuid REFERENCES public.client_intake(id) ON DELETE SET NULL,
  matter_id          uuid REFERENCES public.matters(id) ON DELETE SET NULL,
  contact_id         uuid REFERENCES public.contacts(id) ON DELETE SET NULL,

  -- Set when staff first open the record's history with this message in it.
  read_by_staff_at   timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- The scan's upsert target: the same message filed twice is one row.
CREATE UNIQUE INDEX IF NOT EXISTS email_inbound_messages_mailbox_message_key
  ON public.email_inbound_messages (connection_email, gmail_message_id);

-- The record's history reads by its own id, newest last.
CREATE INDEX IF NOT EXISTS email_inbound_messages_matter_idx
  ON public.email_inbound_messages (matter_id, received_at)
  WHERE matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_inbound_messages_lead_idx
  ON public.email_inbound_messages (client_intake_id, received_at)
  WHERE client_intake_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_inbound_messages_contact_idx
  ON public.email_inbound_messages (contact_id, received_at)
  WHERE contact_id IS NOT NULL;

-- Finding the thread an inbound message belongs to, for the reply link.
CREATE INDEX IF NOT EXISTS email_inbound_messages_thread_idx
  ON public.email_inbound_messages (connection_email, gmail_thread_id);

ALTER TABLE public.email_inbound_messages ENABLE ROW LEVEL SECURITY;

-- Firm staff only, never the client portal: this is the firm's view of its
-- mailbox, and a contact's mail about a client is not the client's to read.
DROP POLICY IF EXISTS email_inbound_messages_staff_all ON public.email_inbound_messages;
CREATE POLICY email_inbound_messages_staff_all
  ON public.email_inbound_messages FOR ALL TO authenticated
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_inbound_messages TO authenticated;

COMMENT ON TABLE public.email_inbound_messages IS
  'Inbound Gmail messages from senders matched to a matter, lead or contact, '
  'filed by the email triage scan so a record''s communications history shows '
  'both directions. Snippets only; bodies are read live from Gmail. '
  'See lib/emailTriage/fileInbound.ts.';

COMMENT ON COLUMN public.email_inbound_messages.snippet IS
  'Gmail''s own short preview, and deliberately the most of the message stored here.';

NOTIFY pgrst, 'reload schema';
