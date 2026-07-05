/*
  # Drop client_intake.children — contacts is the sole source of children data

  All readers were repointed to the contacts table (relationship_type='child')
  in PRs #340 + #341 (spec Phase 1). The saveHouseholdChildren mirror write
  was removed in PR #348 (spec Phase 2). The JSON column is now dead-weight.

  Dependency scan (Phase 3 Task B1) ran clean: no view, RPC, trigger, RLS
  policy, or generated column references the children JSON column.
  v_matter_pipeline and v_placeholder_data reference client_intake.has_minor_children
  (a separate boolean column, KEPT) — not the JSON children column.

  KEEP:
    - contacts.relationship_type='child' rows (the sole source)
    - design_sheets.children + decisions.children (plan-design projection)
    - client_intake.has_minor_children (separate boolean, used by views)
    - leads.* (lead stage, out of scope)

  Apply manually via Supabase MCP `apply_migration` (NOT `db push`) because
  this repo's migration history is diverged from the recorded prod history.
  After applying, rename this file to the recorded version per the
  migration-history-reconcile pattern (commit `de57f7e`).

  Idempotent: guarded with IF EXISTS.
*/

ALTER TABLE public.client_intake
  DROP COLUMN IF EXISTS children;
