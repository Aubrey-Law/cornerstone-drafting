-- Matter-scoped drafting assistant chat history (per attorney, per matter).
-- Apply via Supabase SQL Editor on the firm database (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS public.matter_assistant_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id    text NOT NULL,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role = ANY (ARRAY['user', 'assistant'])),
  content      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matter_assistant_messages_thread
  ON public.matter_assistant_messages(matter_id, user_id, created_at);

ALTER TABLE public.matter_assistant_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_matter_assistant_messages'
  ) THEN
    CREATE POLICY "admin_all_matter_assistant_messages"
      ON public.matter_assistant_messages FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;
END $$;

COMMENT ON TABLE public.matter_assistant_messages IS
  'Drafting assistant turns for a matter thread (matter_id + user_id).';
