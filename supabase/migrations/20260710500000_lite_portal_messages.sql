-- Cornerstone Lite — portal messaging (matter-scoped)

CREATE TABLE IF NOT EXISTS public.messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id     text NOT NULL,
  sender_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_role   text NOT NULL CHECK (sender_role IN ('attorney', 'client', 'admin', 'staff')),
  body          text NOT NULL,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_matter_id_created_at_idx
  ON public.messages (matter_id, created_at DESC);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'staff_all_messages'
  ) THEN
    CREATE POLICY "staff_all_messages"
      ON public.messages FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin', 'va', 'staff')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin', 'va', 'staff')));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'client_select_own_messages'
  ) THEN
    CREATE POLICY "client_select_own_messages"
      ON public.messages FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.matters m
          WHERE m.id::text = messages.matter_id AND m.client_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'client_insert_own_messages'
  ) THEN
    CREATE POLICY "client_insert_own_messages"
      ON public.messages FOR INSERT TO authenticated
      WITH CHECK (
        sender_role = 'client'
        AND sender_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.matters m
          WHERE m.id::text = messages.matter_id AND m.client_id = auth.uid() AND m.status <> 'closed'
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.bump_message_unread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_role = 'client' THEN
    UPDATE public.matters
      SET unread_attorney_messages = coalesce(unread_attorney_messages, 0) + 1
      WHERE id::text = NEW.matter_id;
  ELSE
    UPDATE public.matters
      SET unread_client_messages = coalesce(unread_client_messages, 0) + 1
      WHERE id::text = NEW.matter_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_bump_unread ON public.messages;
CREATE TRIGGER trg_messages_bump_unread
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_message_unread();

CREATE OR REPLACE FUNCTION public.mark_messages_read(p_matter_id text, p_reader_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_reader_role = 'client' THEN
    UPDATE public.messages
      SET read_at = coalesce(read_at, now())
      WHERE matter_id = p_matter_id AND sender_role <> 'client' AND read_at IS NULL;
    UPDATE public.matters SET unread_client_messages = 0 WHERE id::text = p_matter_id;
  ELSE
    UPDATE public.messages
      SET read_at = coalesce(read_at, now())
      WHERE matter_id = p_matter_id AND sender_role = 'client' AND read_at IS NULL;
    UPDATE public.matters SET unread_attorney_messages = 0 WHERE id::text = p_matter_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_messages_read(text, text) TO authenticated;
