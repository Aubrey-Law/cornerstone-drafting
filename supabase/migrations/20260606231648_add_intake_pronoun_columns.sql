alter table public.client_intake
  add column if not exists preferred_pronoun text,
  add column if not exists spouse_preferred_pronoun text;
