-- ============================================================
-- Migration: matter_details_migration_v2
-- Table:     public.matter_details
-- Purpose:   Add HIGH PRIORITY fields identified as missing
--            from the first migration (Round 2).
-- Created:   2026-04-05
-- Author:    scott@aubreylegal.com
-- Notes:     All columns use ADD COLUMN IF NOT EXISTS.
--            No existing columns are modified.
-- ============================================================


-- ============================================================
-- SECTION 1: SHARED — Risk & Operations
-- ============================================================

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS conflict_check_completed boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.conflict_check_completed IS
    'True once a conflicts of interest check has been completed before commencing representation.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS conflict_check_date date;
COMMENT ON COLUMN public.matter_details.conflict_check_date IS
    'Date the conflict check was performed.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS fee_collected boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.fee_collected IS
    'True once the flat fee has been collected in full. For flat-fee firms, this is a key billing milestone.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS fee_collected_date date;
COMMENT ON COLUMN public.matter_details.fee_collected_date IS
    'Date the flat fee was collected.';


-- ============================================================
-- SECTION 2: ESTATE PLANNING — Document Tracking
-- ============================================================

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS ep_living_will_status text
        DEFAULT 'not_started'
        CHECK (ep_living_will_status IN ('not_started', 'drafted', 'executed'));
COMMENT ON COLUMN public.matter_details.ep_living_will_status IS
    'Workflow status of the living will (declaration of health care wishes). Separate from the healthcare proxy. not_started → drafted → executed.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS ep_hipaa_auth_status text
        DEFAULT 'not_started'
        CHECK (ep_hipaa_auth_status IN ('not_started', 'drafted', 'executed'));
COMMENT ON COLUMN public.matter_details.ep_hipaa_auth_status IS
    'Workflow status of the standalone HIPAA authorization form. not_started → drafted → executed.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS ep_signing_method text
        CHECK (ep_signing_method IN ('in_person', 'remote_online_notary', 'mail_away'));
COMMENT ON COLUMN public.matter_details.ep_signing_method IS
    'How the client will execute their documents: in_person (at the office or attorney''s location), remote_online_notary (RON via video), or mail_away (documents mailed to client for signing).';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS ep_witness_required boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.ep_witness_required IS
    'True if the document package requires witnesses at signing (e.g., will execution). Used for scheduling and notary coordination.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS ep_funding_complete_date date;
COMMENT ON COLUMN public.matter_details.ep_funding_complete_date IS
    'Date on which trust funding was fully completed (all assets transferred or re-titled). Complements the ep_funding_status field.';


-- ============================================================
-- SECTION 3: ESTATE PLANNING — Tax & Strategy
-- ============================================================

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS ep_ma_estate_taxable boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.ep_ma_estate_taxable IS
    'True if the client''s estate is projected to be subject to Massachusetts estate tax (estate exceeds the $2M MA threshold). Pulled from intake analysis.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS ep_ma_estate_tax_savings numeric;
COMMENT ON COLUMN public.matter_details.ep_ma_estate_tax_savings IS
    'Projected Massachusetts estate tax savings achieved through the planning strategies implemented (credit shelter trust, ILIT, etc.). In dollars.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS ep_separate_trusts boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.ep_separate_trusts IS
    'True if the plan uses separate individual revocable trusts for each spouse rather than a joint trust. Important for MA estate tax planning for married couples.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS ep_has_ilit boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.ep_has_ilit IS
    'True if an Irrevocable Life Insurance Trust (ILIT) is part of this estate plan.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS ep_ilit_trustee text;
COMMENT ON COLUMN public.matter_details.ep_ilit_trustee IS
    'Full name of the trustee appointed to serve as trustee of the ILIT.';


-- ============================================================
-- SECTION 4: PROBATE — Parties & Beneficiaries
-- ============================================================

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS pb_surviving_spouse boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_surviving_spouse IS
    'True if the decedent is survived by a spouse. Drives many Massachusetts probate rules including elective share rights, homestead, and family allowances.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS pb_surviving_spouse_name text;
COMMENT ON COLUMN public.matter_details.pb_surviving_spouse_name IS
    'Full name of the surviving spouse, if applicable.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS pb_elective_share_claimed boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_elective_share_claimed IS
    'True if the surviving spouse has elected to take their elective share of the estate under Massachusetts law in lieu of what was left to them under the will.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS pb_has_minor_beneficiaries boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_has_minor_beneficiaries IS
    'True if one or more beneficiaries of the estate are minors. May require appointment of a guardian ad litem or conservator and can affect distribution mechanics.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS pb_beneficiary_count integer;
COMMENT ON COLUMN public.matter_details.pb_beneficiary_count IS
    'Total number of named beneficiaries under the will or trust who are entitled to distributions from the estate.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS pb_heir_count integer;
COMMENT ON COLUMN public.matter_details.pb_heir_count IS
    'Total number of heirs at law (for intestate matters, or to confirm all potential heirs have been identified). Distinct from beneficiaries in testate matters.';


-- ============================================================
-- SECTION 5: PROBATE — Real Property & Ancillary
-- ============================================================

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS pb_qualifies_small_estate boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_qualifies_small_estate IS
    'True if the estate qualifies for voluntary administration (small estate affidavit) under Massachusetts law — personal property not exceeding the statutory threshold.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS pb_real_property_parcel_count integer DEFAULT 0;
COMMENT ON COLUMN public.matter_details.pb_real_property_parcel_count IS
    'Number of distinct real property parcels in the probate estate. Affects deed/title work scope and overall administration complexity.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS pb_ancillary_probate_required boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_ancillary_probate_required IS
    'True if the estate requires an ancillary probate proceeding in one or more other states due to real property located outside Massachusetts.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS pb_ancillary_probate_state text;
COMMENT ON COLUMN public.matter_details.pb_ancillary_probate_state IS
    'State(s) where ancillary probate is required. If multiple, use comma-separated two-letter state codes (e.g., ''FL, NH'').';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS pb_estimated_close_date date;
COMMENT ON COLUMN public.matter_details.pb_estimated_close_date IS
    'Estimated date by which the probate estate administration will be complete and the estate closed. Useful for setting client expectations and tracking matter age.';

ALTER TABLE public.matter_details
    ADD COLUMN IF NOT EXISTS pb_bond_waived_in_will boolean DEFAULT false;
COMMENT ON COLUMN public.matter_details.pb_bond_waived_in_will IS
    'True if the decedent''s will explicitly waives the bond requirement for the personal representative. Affects whether a bond must be obtained from the court.';
