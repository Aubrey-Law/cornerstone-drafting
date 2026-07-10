-- Cornerstone Lite — excluded-guardian columns required by intake → design-sheet seed.
-- ensureDesignSheetSeededFromIntake always persists these via WRITABLE_DESIGN_SHEET_COLUMNS.
-- Without them, opening drafting for a new matter throws and hits the workspace error boundary.

ALTER TABLE public.design_sheets
  ADD COLUMN IF NOT EXISTS excluded_guardian_flag boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_guardian_name text;

NOTIFY pgrst, 'reload schema';
