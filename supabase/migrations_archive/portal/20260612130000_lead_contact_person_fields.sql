alter table public.leads
  add column if not exists suffix text,
  add column if not exists preferred_name text,
  add column if not exists preferred_pronoun text,
  add column if not exists date_of_birth date;
