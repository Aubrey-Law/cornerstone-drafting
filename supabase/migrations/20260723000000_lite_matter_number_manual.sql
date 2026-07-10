-- Track when a matter number was manually edited so auto-generate does not overwrite it.

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS matter_number_manual boolean NOT NULL DEFAULT false;
