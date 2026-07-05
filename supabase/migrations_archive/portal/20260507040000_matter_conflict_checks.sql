-- Conflict-of-interest check workflow.
--
-- Solo practice, lightweight: a per-matter row that records whether the
-- attorney ran a conflict check, what matched, and how they decided. A
-- non-null `attorney_decision` is required before an engagement agreement
-- can be generated for the matter.
--
-- Fuzzy match scope (the runner — built in lib/conflictCheck.ts):
--   * Subject email and spouse email (lowercased exact)
--   * Normalised "first last" name and "spouse first last" name
--   * Searched across: leads, contacts, client_intake
--   * Excludes the current matter's own intake/lead/contact rows
--
-- Decisions:
--   * cleared             — no conflict found, attorney confirms
--   * cleared_with_notes  — matches surfaced but attorney determined no
--                           conflict; reason text required
--   * conflict_found      — engagement is blocked; matter cannot proceed
--                           to drafting/engagement until resolved

CREATE TABLE IF NOT EXISTS public.matter_conflict_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id       uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  ran_at          timestamptz NOT NULL DEFAULT now(),
  ran_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ran_by_email    text,

  -- Snapshot of subject identifiers used at run time.
  subject_email   text,
  subject_name    text,
  spouse_email    text,
  spouse_name     text,

  -- Snapshot of matches surfaced (jsonb array of {source, source_id, source_type, match_field, match_value, matter_id}).
  matches         jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Attorney decision; null = ran but not yet decided.
  attorney_decision  text CHECK (attorney_decision IS NULL OR attorney_decision IN ('cleared', 'cleared_with_notes', 'conflict_found')),
  decision_reason    text,
  decided_at         timestamptz,
  decided_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Once a check is decided, mark superseded if a re-run replaces it (we
  -- never delete; full audit trail of every check ever run).
  superseded_at      timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matter_conflict_checks_matter_id
  ON public.matter_conflict_checks (matter_id, ran_at DESC);

CREATE INDEX IF NOT EXISTS idx_matter_conflict_checks_active
  ON public.matter_conflict_checks (matter_id)
  WHERE superseded_at IS NULL;

ALTER TABLE public.matter_conflict_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attorney_full_access_conflict_checks" ON public.matter_conflict_checks;
CREATE POLICY "attorney_full_access_conflict_checks"
  ON public.matter_conflict_checks
  FOR ALL
  TO authenticated
  USING (is_attorney_or_staff())
  WITH CHECK (is_attorney_or_staff());

COMMENT ON TABLE public.matter_conflict_checks IS
  'Per-matter conflict-of-interest checks. Engagement agreement generation is gated on the most recent check having attorney_decision IN (''cleared'', ''cleared_with_notes'').';
