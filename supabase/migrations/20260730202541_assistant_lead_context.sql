-- Allow persisted dedicated-assistant threads to retain prospective-client
-- lead context as well as general and matter context.

ALTER TABLE public.assistant_chats
  DROP CONSTRAINT IF EXISTS assistant_chats_context_type_check;

ALTER TABLE public.assistant_chats
  ADD CONSTRAINT assistant_chats_context_type_check
  CHECK (context_type IN ('general', 'matter', 'lead'));
