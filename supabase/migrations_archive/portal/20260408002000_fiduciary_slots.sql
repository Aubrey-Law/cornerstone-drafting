-- Add JSONB slot arrays for unlimited fiduciary alternates.
-- Old fixed columns (trustee_primary, etc.) are preserved for backward compat.
-- The UI reads/writes exclusively from *_slots columns.

ALTER TABLE design_sheets
  ADD COLUMN IF NOT EXISTS trustee_slots  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS executor_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS poa_slots      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS hcp_slots      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS guardian_slots  jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN design_sheets.trustee_slots IS
  'Ordered array of FiduciarySlot objects: [{id, contact_id, is_co, order}]. '
  'order=0 is primary, order=1+ are alternates. is_co=true shares same order rank.';
