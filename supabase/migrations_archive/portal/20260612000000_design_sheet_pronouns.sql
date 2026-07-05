-- Re-introduce pronouns on the design sheet as attorney-editable, intake-prefilled
-- fields for the primary grantor and spouse/partner.
--
-- `client_pronouns` was dropped in 20260606233212 (its data migrated into
-- client_intake.preferred_pronoun). We now want pronouns surfaced AND overridable
-- on the design sheet itself, alongside the other denormalized grantor fields, so
-- re-add the column and add a spouse counterpart. Idempotent. Values mirror the
-- intake wizard's PRONOUN_OPTIONS (e.g. 'he/him', 'she/her', 'they/them').
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS client_pronouns TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS spouse_pronouns TEXT;
