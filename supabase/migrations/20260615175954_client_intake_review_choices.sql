/*
  # Add client_intake.review_choices column + backfill

  F4a of the fiduciary-roles unification work.
  See docs/superpowers/specs/2026-06-15-fiduciary-roles-unification-F4a-design.md.

  Lifts the `review_choices` key out of client_intake.fiduciary_entries
  JSONB into a dedicated column. Used by intakeReadiness for the
  "discuss later" choices. Backfill is idempotent: if the column already
  has a value, the COALESCE leaves it alone.

  Apply via Supabase MCP `apply_migration`. Local filename matches the
  recorded version after applying (migration-history-reconcile pattern).
*/

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS review_choices jsonb;

UPDATE public.client_intake
SET review_choices = COALESCE(review_choices, fiduciary_entries -> 'review_choices')
WHERE fiduciary_entries ? 'review_choices'
  AND (review_choices IS NULL OR review_choices = '{}'::jsonb);
