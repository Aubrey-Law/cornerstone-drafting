-- Design Sheet — new fields for Plan Design accordion layout
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS

-- Plan Type additions
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS spouse_trust_name TEXT;

-- Family Inclusions
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS include_afterborn_children TEXT DEFAULT 'yes';
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS include_expectant_children TEXT DEFAULT 'yes';
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS include_general_disinheritance TEXT DEFAULT 'yes';

-- Residuary Distributions — stagger schedule
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS stagger_age_1 INTEGER;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS stagger_pct_1 INTEGER;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS stagger_age_2 INTEGER;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS stagger_pct_2 INTEGER;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS stagger_age_3 INTEGER;

-- Residuary Distributions — new fields
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS tangible_property_distribution TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS include_common_disaster TEXT DEFAULT 'yes';
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS include_guardians_allowance TEXT DEFAULT 'yes';
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS beneficiary_as_cotrustee TEXT DEFAULT 'no';
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS beneficiary_as_sole_trustee TEXT DEFAULT 'no';
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS remote_beneficiary TEXT DEFAULT 'heirs_at_law';

-- Special Provisions
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS provision_lifestyle_disability TEXT DEFAULT 'no';
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS provision_substance_abuse TEXT DEFAULT 'no';
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS provision_married_beneficiary TEXT DEFAULT 'no';
