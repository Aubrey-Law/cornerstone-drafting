import { describe, expect, it } from 'vitest'
import {
  getIntakeReadinessFlags,
  resolveIntakeReviewTarget,
  type IntakeReadinessFlag,
} from '@/lib/intakeReadiness'
import { DESIGN_SECTION_IDS } from '@/lib/designSheet/sectionIds'

function flag(key: string): IntakeReadinessFlag {
  return {
    key,
    label: key,
    message: key,
    sectionId: 'intake-only-id',
    severity: 'review',
    resolutionKind: 'needs_data',
  }
}

describe('intake review flag targets', () => {
  it.each([
    ['client_dob_missing', DESIGN_SECTION_IDS.clientInformation],
    ['spouse_dob_missing', DESIGN_SECTION_IDS.clientInformation],
    ['county_missing', DESIGN_SECTION_IDS.clientInformation],
    ['client_trustee_missing', DESIGN_SECTION_IDS.trustDetails],
    ['client_personal_rep_missing', DESIGN_SECTION_IDS.willDetails],
    ['spouse_personal_rep_missing', DESIGN_SECTION_IDS.willDetails],
    ['guardian_missing', DESIGN_SECTION_IDS.willDetails],
    ['client_poa_missing', DESIGN_SECTION_IDS.financialPoa],
    ['spouse_poa_missing', DESIGN_SECTION_IDS.financialPoa],
    ['client_hcp_missing', DESIGN_SECTION_IDS.healthcareDirectives],
    ['spouse_hcp_missing', DESIGN_SECTION_IDS.healthcareDirectives],
    ['real_estate_details_missing', DESIGN_SECTION_IDS.assetSchedules],
    ['bank_details_missing', DESIGN_SECTION_IDS.assetSchedules],
  ])('maps %s to a canonical drafting section', (key, sectionId) => {
    const target = resolveIntakeReviewTarget(flag(key))
    expect(target.sectionId).toBe(sectionId)
    expect(target.href('matter-1')).toContain('/admin/drafting/matter-1?step=design&focus=')
    expect(target.href('matter-1')).not.toContain('intake-only-id')
  })

  it('marks client-provided attorney choices separately from missing data', () => {
    const flags = getIntakeReadinessFlags({
      marital_status: 'single',
      date_of_birth: '1980-01-01',
      county: 'Middlesex',
      review_choices: { fiduciaries: 'discuss_with_attorney' },
    })

    expect(flags.find(item => item.key === 'client_trustee_missing')?.resolutionKind)
      .toBe('attorney_judgment')
    expect(flags.find(item => item.key === 'client_poa_missing')?.resolutionKind)
      .toBe('attorney_judgment')
  })
})
