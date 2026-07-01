-- Design Sheet — fields aligned to Aubrey Law document templates
-- (Universal personal, DPOA, HCP, HIPAA, Will-common, Pour-Over, Outright, Testamentary Trust)
-- Safe to re-run.

-- ── Universal / Personal ──────────────────────────────────────────────────────
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS client_aka TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS client_pronouns TEXT;            -- 'he'|'she'|'they'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS former_spouse_name TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS deceased_spouse_name TEXT;

-- Execution mechanics (often blank until signing)
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS signing_month TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS signing_year TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS signing_county TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS notary_commission_expiration TEXT;

-- ── DPOA ──────────────────────────────────────────────────────────────────────
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS dpoa_coagent_manner TEXT;        -- 'independently'|'jointly'|'majority'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS dpoa_self_dealing_reviewer TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS dpoa_self_dealing_reviewer_alt TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS dpoa_include_section_l TEXT DEFAULT 'no'; -- spousal proximity provisions

-- Default the manner-of-acting to 'independently' (template recommendation)
ALTER TABLE design_sheets ALTER COLUMN dpoa_coagent_manner SET DEFAULT 'independently';

-- ── HCP ───────────────────────────────────────────────────────────────────────
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS hcp_anatomical_gift TEXT;        -- 'all'|'specified'|'none' (no default; client choice)
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS hcp_anatomical_specified TEXT;   -- text describing scope when 'specified'

-- ── HIPAA ─────────────────────────────────────────────────────────────────────
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS hipaa_psychotherapy_notes TEXT;  -- 'authorize'|'do_not_authorize' (no default)

-- ── Will — Common Options ─────────────────────────────────────────────────────
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS specific_bequests JSONB DEFAULT '[]'::jsonb;
-- Each bequest:
--   { kind: 'cash'|'item'|'charitable',
--     amount?, item_description?, beneficiary_name?, charity_name?, charity_org_type?,
--     charity_state?, charity_address? }

ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS pet_care_option TEXT DEFAULT 'omit'; -- 'omit'|'direct_bequest'|'pet_trust'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS pet_care_details JSONB DEFAULT '{}'::jsonb;
-- direct_bequest: { cash_amount, primary_caretaker, successor_caretaker }
-- pet_trust:      { cash_amount, pet_trustee, remainder_beneficiary, enforcer }

ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS pr_structure TEXT;               -- 'single'|'spouse_first'|'co_pr'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS bond TEXT DEFAULT 'no_bond';     -- 'no_bond'|'required'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS supervision TEXT DEFAULT 'unsupervised'; -- 'unsupervised'|'supervised'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS simultaneous_death TEXT;         -- 'spouse_survives'|'testator_survives'|'omit'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS utma_age INTEGER DEFAULT 21;     -- 18 | 21
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS no_contest_clause TEXT DEFAULT 'omit'; -- 'omit'|'include'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS include_disclaimer_article BOOLEAN DEFAULT TRUE;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS include_self_proving_affidavit BOOLEAN DEFAULT TRUE;

-- Excluded guardian (extends existing guardian fields)
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS excluded_guardian_flag BOOLEAN DEFAULT FALSE;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS excluded_guardian_name TEXT;

-- ── Pour-Over Will specific ───────────────────────────────────────────────────
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS trust_date TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS pour_over_alternate_disposition TEXT;
-- 'spouse_then_descendants'|'descendants_only'|'named'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS pour_over_alternate_named TEXT;

-- ── Outright Will specific ────────────────────────────────────────────────────
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS outright_residuary TEXT;
-- 'spouse_then_descendants'|'descendants_then_heirs'|'named'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS outright_residuary_named TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS outright_residuary_alternate TEXT;

-- ── Testamentary Trust specific ───────────────────────────────────────────────
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS trustee_structure TEXT;          -- 'single'|'spouse_first'|'co_trustees'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS cotrustee_decision_standard TEXT; -- 'majority'|'unanimous'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS beneficiary_structure TEXT;
-- 'spouse_hems_then_descendants'|'descendants_per_stirpes'|'single_beneficiary'
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS single_beneficiary_name TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS single_beneficiary_remainder TEXT;
ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS age_distribution_schedule TEXT;
-- 'outright_25'|'outright_30'|'outright_35'|'staggered_25_30_35'

ALTER TABLE design_sheets ADD COLUMN IF NOT EXISTS trust_protector_name TEXT;

COMMENT ON COLUMN design_sheets.specific_bequests IS
  'Repeatable bequest list. Each entry: { kind: cash|item|charitable, amount, item_description, beneficiary_name, charity_name, charity_org_type, charity_state, charity_address }';

COMMENT ON COLUMN design_sheets.pet_care_details IS
  'Pet care extra fields — keys depend on pet_care_option';
