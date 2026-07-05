-- Per-user UI preferences (drafting design view, hub filters, etc.)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.users.preferences IS
  'Staff UI preferences keyed by app area, e.g. {"drafting":{"designView":"guided"}}';
