-- Add co-agent support to contact_roles
-- A co-agent serves simultaneously with the primary (e.g. joint POA agents or co-trustees)
-- as opposed to an alternate/successor who only serves if the primary cannot.

ALTER TABLE contact_roles
  ADD COLUMN IF NOT EXISTS is_coagent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contact_roles.is_coagent IS
  'True when this person serves concurrently with the primary (co-agent / co-trustee). '
  'False (default) means they are a successor who serves only if the primary cannot.';
