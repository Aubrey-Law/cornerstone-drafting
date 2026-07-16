-- Persisted assistant-page chats: per-user private threads with replayable
-- tool/workflow events. Idempotent for the shared firm database.

CREATE TABLE IF NOT EXISTS public.assistant_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  context_type text NOT NULL DEFAULT 'general' CHECK (context_type IN ('general', 'matter')),
  context_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_chats_user
  ON public.assistant_chats(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.assistant_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.assistant_chats(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_chat_messages_chat
  ON public.assistant_chat_messages(chat_id, created_at);

ALTER TABLE public.assistant_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_chat_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'owner_all_assistant_chats') THEN
    CREATE POLICY "owner_all_assistant_chats"
      ON public.assistant_chats FOR ALL TO authenticated
      USING (
        user_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin'))
      )
      WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin'))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'owner_all_assistant_chat_messages') THEN
    CREATE POLICY "owner_all_assistant_chat_messages"
      ON public.assistant_chat_messages FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.assistant_chats c
          WHERE c.id = assistant_chat_messages.chat_id
            AND c.user_id = auth.uid()
        )
        AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin'))
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.assistant_chats c
          WHERE c.id = assistant_chat_messages.chat_id
            AND c.user_id = auth.uid()
        )
        AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin'))
      );
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_chats TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_chat_messages TO authenticated;

COMMENT ON TABLE public.assistant_chats IS 'Dedicated assistant-page chat threads, private per attorney.';
COMMENT ON TABLE public.assistant_chat_messages IS 'Messages + replayable tool/workflow events for assistant chats.';
