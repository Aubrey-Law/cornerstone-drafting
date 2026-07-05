-- Google Drive folder integration for matters

ALTER TABLE matters
  ADD COLUMN IF NOT EXISTS drive_folder_id       text,
  ADD COLUMN IF NOT EXISTS drive_drafts_folder_id text,
  ADD COLUMN IF NOT EXISTS drive_signed_folder_id text;

COMMENT ON COLUMN matters.drive_folder_id IS
  'Google Drive folder ID for the root matter folder (e.g. "Smith, John — 2026").';

COMMENT ON COLUMN matters.drive_drafts_folder_id IS
  'Google Drive folder ID for the "03 - Drafts" subfolder inside the matter root.';

COMMENT ON COLUMN matters.drive_signed_folder_id IS
  'Google Drive folder ID for the "04 - Signed Documents" subfolder inside the matter root.';
