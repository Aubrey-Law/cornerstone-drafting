-- Solo-first Command Center defaults for new preference rows.
-- Existing user_work_preferences rows are left alone; Planning preferences
-- still exposes a "Solo practice preset" for attorneys who already saved values.

alter table public.user_work_preferences
  alter column max_must_do set default 2,
  alter column admin_batch_minutes set default 15;
