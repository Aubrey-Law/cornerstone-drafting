/*
  # Drop client_intake.fiduciary_entries

  Final step of the fiduciary-roles unification work (F4b).
  See docs/superpowers/specs/2026-06-15-fiduciary-roles-unification-F4b-design.md.

  Pre-flight DB scan confirmed zero views, RPCs, RLS policies, or generated
  columns reference this column. F4a (PR #362) repointed every code reader.
  F4b removes the last two code writers.

  Apply via Supabase MCP `apply_migration` AFTER the F4b code deploy. The
  IF EXISTS guard makes this migration safely re-runnable.

  After applying, rename this file to the recorded version per the
  migration-history-reconcile pattern.
*/

ALTER TABLE public.client_intake
  DROP COLUMN IF EXISTS fiduciary_entries;
