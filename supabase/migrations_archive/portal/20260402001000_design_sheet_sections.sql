-- Add goals/notes, concerns, and assets columns to design_sheets
ALTER TABLE design_sheets
  ADD COLUMN IF NOT EXISTS goals_notes text,
  ADD COLUMN IF NOT EXISTS concerns text,
  ADD COLUMN IF NOT EXISTS assets jsonb DEFAULT '[]'::jsonb;
