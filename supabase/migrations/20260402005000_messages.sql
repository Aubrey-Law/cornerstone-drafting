-- Client Messaging System
-- Threaded messages between attorney and clients, scoped to a matter.

-- ── messages ─────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS messages CASCADE;

CREATE TABLE messages (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id             uuid        NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  sender_role           text        NOT NULL CHECK (sender_role IN ('attorney', 'client')),
  sender_id             uuid        NOT NULL, -- auth.users.id
  body                  text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  read_by_client_at     timestamptz,
  read_by_attorney_at   timestamptz
);

CREATE INDEX IF NOT EXISTS messages_matter_id_created_at_idx
  ON messages (matter_id, created_at DESC);

COMMENT ON TABLE messages IS
  'Messages exchanged between attorney and client, scoped to a matter.';

COMMENT ON COLUMN messages.sender_role IS
  'Who sent the message. Values: attorney | client';

COMMENT ON COLUMN messages.sender_id IS
  'auth.users.id of the sender.';

COMMENT ON COLUMN messages.read_by_client_at IS
  'Timestamp when the client first read this message. NULL = unread by client.';

COMMENT ON COLUMN messages.read_by_attorney_at IS
  'Timestamp when the attorney first read this message. NULL = unread by attorney.';

-- ── matters: unread counters ──────────────────────────────────────────────────

ALTER TABLE matters
  ADD COLUMN IF NOT EXISTS unread_client_messages   int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unread_attorney_messages int NOT NULL DEFAULT 0;

COMMENT ON COLUMN matters.unread_client_messages IS
  'Count of messages sent by the attorney that the client has not yet read.';

COMMENT ON COLUMN matters.unread_attorney_messages IS
  'Count of messages sent by the client that the attorney has not yet read.';

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Attorney (service role) has full access — handled implicitly by service role
-- bypassing RLS. The policies below cover authenticated client users.

-- Clients may read messages on their own matter.
CREATE POLICY "clients_select_messages"
  ON messages
  FOR SELECT
  TO authenticated
  USING (
    sender_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM matters m
      WHERE m.id = messages.matter_id
        AND m.client_id = auth.uid()
    )
  );

-- Clients may insert messages on their own matter with sender_role = 'client'.
CREATE POLICY "clients_insert_messages"
  ON messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_role = 'client'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM matters m
      WHERE m.id = messages.matter_id
        AND m.client_id = auth.uid()
    )
  );

-- Clients may not update or delete messages.

-- ── helper functions ─────────────────────────────────────────────────────────

-- Mark all unread messages in a matter as read for the given role, and reset
-- the corresponding unread counter on the matter row.
CREATE OR REPLACE FUNCTION mark_messages_read(
  p_matter_id uuid,
  p_role      text
) RETURNS void LANGUAGE sql AS $$
  UPDATE messages
  SET
    read_by_client_at   = CASE WHEN p_role = 'client'   THEN COALESCE(read_by_client_at,   now()) ELSE read_by_client_at   END,
    read_by_attorney_at = CASE WHEN p_role = 'attorney' THEN COALESCE(read_by_attorney_at, now()) ELSE read_by_attorney_at END
  WHERE matter_id = p_matter_id
    AND (
      CASE
        WHEN p_role = 'client'   THEN read_by_client_at   IS NULL
        WHEN p_role = 'attorney' THEN read_by_attorney_at IS NULL
        ELSE false
      END
    );

  UPDATE matters
  SET
    unread_client_messages   = CASE WHEN p_role = 'client'   THEN 0 ELSE unread_client_messages   END,
    unread_attorney_messages = CASE WHEN p_role = 'attorney' THEN 0 ELSE unread_attorney_messages END
  WHERE id = p_matter_id;
$$;

-- ── triggers: maintain unread counters ───────────────────────────────────────

-- Increment the appropriate unread counter whenever a new message is inserted.
CREATE OR REPLACE FUNCTION increment_unread_message_counter()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sender_role = 'client' THEN
    UPDATE matters
    SET unread_attorney_messages = unread_attorney_messages + 1
    WHERE id = NEW.matter_id;
  ELSIF NEW.sender_role = 'attorney' THEN
    UPDATE matters
    SET unread_client_messages = unread_client_messages + 1
    WHERE id = NEW.matter_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_increment_unread
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION increment_unread_message_counter();
