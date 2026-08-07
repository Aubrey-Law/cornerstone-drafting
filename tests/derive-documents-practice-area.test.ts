import { describe, expect, it } from 'vitest'
import { defaultDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { deriveDocuments, isEstatePlanningPracticeArea } from '@/lib/draftPayload/helpers'
import { isDesignSheetMarried } from '@/lib/draftPayload/designSheetFields'

// The design sheet reads 'remarried' as married everywhere it decides what to
// show. The drafting pipeline compared for equality with 'married', so a
// remarried client saw the spouse's documents in the sheet and then had them
// silently dropped from the generated package.
describe('drafting reads marital status the way the design sheet does', () => {
  it('counts remarried — and stray casing or padding — as married', () => {
    expect(isDesignSheetMarried({ marital_status: 'remarried' } as never)).toBe(true)
    expect(isDesignSheetMarried({ marital_status: 'Married' } as never)).toBe(true)
    expect(isDesignSheetMarried({ marital_status: ' married ' } as never)).toBe(true)
  })

  it('still reads the unmarried statuses as unmarried', () => {
    for (const marital_status of ['single', 'divorced', 'widowed', 'separated', 'never married']) {
      expect(isDesignSheetMarried({ marital_status } as never)).toBe(false)
    }
    expect(isDesignSheetMarried({ marital_status: null } as never)).toBe(false)
    expect(isDesignSheetMarried(null)).toBe(false)
  })

  it('keeps the spouse documents in the package for a remarried client', () => {
    const sheet = { plan_type: 'pour_over', marital_status: 'remarried', children: null }
    const docs = deriveDocuments(
      'EP',
      [],
      false,
      false,
      isDesignSheetMarried(sheet as never),
      'pour_over',
      defaultDocumentInclusions(sheet),
      'outright_to_spouse',
    )

    expect(docs.spouse_docs).toBe(true)
  })
})

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
