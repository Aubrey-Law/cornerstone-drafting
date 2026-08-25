import { getFiduciaryDocumentInclusions } from '@/lib/designSheet/fiduciaryDocumentInclusions'
import { effectiveDpoaTrustPowers, getDesignSheetDpoaProvisions } from '@/lib/designSheetDpoaProvisions'
import { draftPayloadHealthcare } from '@/lib/draftPayload/healthcare'
import { buildFiduciaryRoleDetailsFromDesignSheet } from '@/lib/draftPayload/fiduciaryDetails'
import type { DesignSheetRow, DraftPayload } from '@/lib/draftPayload/types'

const EMPTY_DESIGN_SHEET = {
  id: '',
  status: null,
  decisions: null,
  hcp_anatomical_gift: null,
} as DesignSheetRow

export function defaultDraftPayloadSupplementary(): Pick<
  DraftPayload,
  | 'healthcare_provisions'
  | 'hcp_provisions'
  | 'hipaa_provisions'
  | 'fiduciary_display'
  | 'fiduciary_details'
  | 'excluded_guardians'
  | 'assets'
  | 'goals_notes'
  | 'concerns'
> {
  const emptySheet = EMPTY_DESIGN_SHEET
  const healthcare = draftPayloadHealthcare(emptySheet, [])

  return {
    healthcare_provisions: healthcare.healthcare_provisions,
    hcp_provisions: healthcare.hcp_provisions,
    hipaa_provisions: healthcare.hipaa_provisions,
    fiduciary_display: getFiduciaryDocumentInclusions({ decisions: null }),
    fiduciary_details: buildFiduciaryRoleDetailsFromDesignSheet(null, [], { full_name: '', address: null }, null),
    excluded_guardians: [],
    assets: [],
    goals_notes: null,
    concerns: null,
  }
}

export function defaultDraftPayloadDpoaProvisions(): DraftPayload['dpoa_provisions'] {
  const provisions = getDesignSheetDpoaProvisions({ decisions: null })
  return {
    coagent_manner: 'independently',
    self_dealing_reviewer: null,
    self_dealing_reviewer_alt: null,
    include_section_l: false,
    include_entity_powers: provisions.include_entity_powers,
    include_advanced_trust_gifting: provisions.include_advanced_trust_gifting,
    include_extended_personal_care: provisions.include_extended_personal_care,
    include_notice_page: provisions.include_notice_page,
    preserve_existing_bank_powers: provisions.preserve_existing_bank_powers,
    incapacity_determination: provisions.incapacity_determination,
    acceptance_of_appointment: provisions.acceptance_of_appointment,
    effective: provisions.effective,
    authority_after_capacity_regained: provisions.authority_after_capacity_regained,
    agent_compensation: provisions.agent_compensation,
    coagent_serving: provisions.coagent_serving,
    allow_gifts: provisions.allow_gifts,
    include_trust_powers: provisions.include_trust_powers,
    trust_powers: effectiveDpoaTrustPowers(provisions),
    special_powers: {
      allow_delegation: provisions.allow_delegation,
      prohibit_arbitration: provisions.prohibit_arbitration,
      power_529_plans: provisions.power_529_plans,
      allow_medical_information_access: provisions.allow_medical_information_access,
      power_digital_assets: provisions.power_digital_assets,
      allow_self_designation_beneficiary: provisions.allow_self_designation_beneficiary,
    },
    basic_powers: provisions.basic_powers,
    all_basic_powers: provisions.all_basic_powers,
    additional_powers: provisions.additional_powers,
    specific_businesses: provisions.specific_businesses,
    additional_limitations: provisions.additional_limitations,
  }
}
