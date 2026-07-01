-- Guided Interview (attorney mode) lets the attorney choose, on the client's
-- intake, which documents the package will include. The choice mirrors the
-- design-sheet `decisions.document_inclusions` shape and is seeded into the
-- design sheet on submit (see buildDesignSheetSeedPayload / planTypeSeedPatch).
--
-- `plan_type` already exists on client_intake (free text); this adds the
-- document-selection blob. Nullable: client-mode submissions never set it.
ALTER TABLE client_intake
  ADD COLUMN IF NOT EXISTS document_inclusions jsonb;

COMMENT ON COLUMN client_intake.document_inclusions IS
  'Attorney-selected document set (Guided Interview attorney mode). Shape matches design_sheets.decisions.document_inclusions; seeded into the design sheet on intake submit.';
