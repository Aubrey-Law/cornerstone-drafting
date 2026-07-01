-- Add fiduciary_entries JSONB column to client_intake
-- Stores _fid_* wizard state (fiduciary role selections) and _children data
-- so they survive page refreshes and are not lost if contacts/contact_roles fails.
ALTER TABLE client_intake
  ADD COLUMN IF NOT EXISTS fiduciary_entries jsonb;
