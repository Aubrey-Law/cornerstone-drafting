-- Manual "Push to Lawmatics" sends a lead's standard Lawmatics fields
-- (name, contact, birthdate, address, marital status) directly. Every other
-- Cornerstone field — middle name, county, spouse, children, lead source,
-- plan type, notes — only exists in Lawmatics as a firm-defined custom field,
-- so this map pairs each Cornerstone field key with the Lawmatics custom field
-- ID it should populate. Unmapped keys are reported and skipped, never guessed.

alter table public.integration_settings
  add column lawmatics_custom_field_id_map jsonb not null default '{}'::jsonb
    check (jsonb_typeof(lawmatics_custom_field_id_map) = 'object');
