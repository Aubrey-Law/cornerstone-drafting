create table if not exists public.briefing_attention_dismissals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  briefing_date DATE NOT NULL,
  item_id        TEXT NOT NULL,
  dismissed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, briefing_date, item_id)
);

create index if not exists briefing_attention_dismissals_user_date_idx
  on public.briefing_attention_dismissals(user_id, briefing_date);

alter table public.briefing_attention_dismissals enable row level security;

create policy "Users can read own briefing attention dismissals"
  on public.briefing_attention_dismissals
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create own briefing attention dismissals"
  on public.briefing_attention_dismissals
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own briefing attention dismissals"
  on public.briefing_attention_dismissals
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
