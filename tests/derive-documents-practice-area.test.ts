import { describe, expect, it } from 'vitest'
import { defaultDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { deriveDocuments, isEstatePlanningPracticeArea } from '@/lib/draftPayload/helpers'

describe('deriveDocuments practice-area gate', () => {
  const inclusions = defaultDocumentInclusions({
    plan_type: 'pour_over',
    marital_status: 'Married',
    children: null,
  })

  it('treats null/blank practice area as estate planning (EP)', () => {
    expect(isEstatePlanningPracticeArea(null)).toBe(true)
    expect(isEstatePlanningPracticeArea('')).toBe(true)
    expect(isEstatePlanningPracticeArea('EP')).toBe(true)
    expect(isEstatePlanningPracticeArea('Estate Planning')).toBe(true)
    expect(isEstatePlanningPracticeArea('Probate')).toBe(false)
  })

  it('includes core estate packages when practice_area is null', () => {
    const docs = deriveDocuments(
      null,
      [],
      true,
      false,
      true,
      'pour_over',
      inclusions,
      'outright_to_spouse',
    )

    expect(docs.include_trust).toBe(true)
    expect(docs.include_pour_over_will).toBe(true)
    expect(docs.include_dpoa).toBe(true)
    expect(docs.include_hcp).toBe(true)
    expect(docs.include_parental_appointment).toBe(true)
  })

  it('does not include estate packages for Probate practice area', () => {
    const docs = deriveDocuments(
      'Probate',
      [],
      true,
      false,
      false,
      'pour_over',
      inclusions,
      'standard',
    )

    expect(docs.include_trust).toBe(false)
    expect(docs.include_dpoa).toBe(false)
    expect(docs.include_parental_appointment).toBe(false)
  })

  it('maps selected asset-transfer docs onto payload flags', () => {
    const docs = deriveDocuments(
      'EP',
      [],
      false,
      false,
      false,
      'pour_over',
      inclusions,
      'standard',
      undefined,
      ['deed', 'trustees_certificate'],
    )

    expect(docs.include_deed).toBe(true)
    expect(docs.include_trustees_certificate).toBe(true)
    expect(docs.include_real_estate_trust).toBe(false)
  })
})
