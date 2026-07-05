-- Restore Briefing email triage (reverses 20260516000000_remove_email_triage).

INSERT INTO public.email_settings (category, mode, provider) VALUES
  ('outlook_reply', 'off', 'graph')
ON CONFLICT (category) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.email_triage_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),

  graph_message_id    text NOT NULL,
  internet_message_id text,
  conversation_id     text,

  action              text NOT NULL CHECK (action IN ('sent', 'saved_draft', 'skipped', 'archived')),

  email_log_id        uuid REFERENCES public.email_log(id) ON DELETE SET NULL,
  graph_draft_id      text,

  ai_classification   text,
  ai_draft_used       boolean NOT NULL DEFAULT false,

  actor_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes               text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_triage_log_graph_message_id_unique
  ON public.email_triage_log(graph_message_id);

CREATE INDEX IF NOT EXISTS idx_email_triage_log_conversation_id
  ON public.email_triage_log(conversation_id);

CREATE INDEX IF NOT EXISTS idx_email_triage_log_actor_created
  ON public.email_triage_log(actor_user_id, created_at DESC);

ALTER TABLE public.email_triage_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'email_log' AND constraint_name = 'email_log_status_check'
  ) THEN
    ALTER TABLE email_log DROP CONSTRAINT email_log_status_check;
  END IF;
END$$;

ALTER TABLE email_log
  ADD CONSTRAINT email_log_status_check
  CHECK (status IN ('sent','error','suppressed','redirected','draft_saved'));
