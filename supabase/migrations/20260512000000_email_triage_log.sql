-- Briefing track — Step 1
--
-- Adds:
--   * email_settings row for the new 'outlook_reply' category (mode='on',
--     provider='graph'). Replies must thread through the original mailbox,
--     so the provider is fixed to 'graph'.
--   * email_triage_log table — tracks per-message triage actions (sent /
--     saved_draft / skipped / archived) so the Briefing inbox is idempotent
--     across page refreshes.

INSERT INTO public.email_settings (category, mode, provider) VALUES
  ('outlook_reply', 'on', 'graph')
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

CREATE INDEX IF NOT EXISTS idx_email_triage_log_graph_message_id
  ON public.email_triage_log(graph_message_id);

CREATE INDEX IF NOT EXISTS idx_email_triage_log_conversation_id
  ON public.email_triage_log(conversation_id);

CREATE INDEX IF NOT EXISTS idx_email_triage_log_actor_created
  ON public.email_triage_log(actor_user_id, created_at DESC);

ALTER TABLE public.email_triage_log ENABLE ROW LEVEL SECURITY;
-- Admin-only via service role; no public policies (matches email_log).
