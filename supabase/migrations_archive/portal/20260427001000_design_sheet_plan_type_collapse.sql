-- Recommendation #1: collapse plan_type to template-aligned values + add is_joint flag
-- Recommendation #3: drop inheritance_structure (column kept for backward read; UI removed)
-- Safe to re-run.

-- Add is_joint flag (separates joint-trust matters from individual)
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS is_joint BOOLEAN DEFAULT FALSE;

-- Named individual for §7.3 Option 3 of the tangible property distribution
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS tangible_property_named_individual TEXT;

-- Backfill is_joint for legacy rows
UPDATE design_sheets
SET is_joint = TRUE
WHERE plan_type IN (
  'joint_trust',
  'married_simple',
  'married_disclaimer',
  'married_clayton',
  'Joint Trust',
  'Joint Trust - LP',
  'Joint Trust — LP',
  'Married - Simple',
  'Married - Disclaimer',
  'Married - Clayton',
  'Married — Simple',
  'Married — Disclaimer',
  'Married — Clayton'
)
AND is_joint IS DISTINCT FROM TRUE;

-- Map legacy plan_type values to template-aligned values
-- joint_trust / individual_trust / married_* → pour_over (most common existing setup)
-- will_based_plan → outright_will (default; attorney can change to testamentary_trust)
UPDATE design_sheets
SET plan_type = 'pour_over'
WHERE plan_type IN (
  'individual_trust',
  'joint_trust',
  'married_simple',
  'married_disclaimer',
  'married_clayton',
  'Individual Trust',
  'Joint Trust',
  'Joint Trust - LP',
  'Joint Trust — LP',
  'Married - Simple',
  'Married - Disclaimer',
  'Married - Clayton',
  'Married — Simple',
  'Married — Disclaimer',
  'Married — Clayton'
);

UPDATE design_sheets
SET plan_type = 'outright_will'
WHERE plan_type IN ('will_based_plan', 'Will-Based Plan');

COMMENT ON COLUMN design_sheets.is_joint IS
  'True for joint-trust matters. Independent of plan_type which now reflects template variant only.';
