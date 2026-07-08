import { describe, expect, it } from 'vitest'
import {
  draftPayloadBlendedFamily,
  draftPayloadFamilyProvisions,
  sheetYesNo,
} from '@/lib/draftPayload/familyProvisions'
import type { DesignSheetChild } from '@/types/database'

describe('draftPayloadFamilyProvisions', () => {
  it('merges disinherited children and additional heirs without duplicates', () => {
    const provisions = draftPayloadFamilyProvisions({
      disinherited_children: ['Alex Example', 'Alex Example'],
      disinheritances: [{ name: 'Jordan Rival', relationship: 'Sibling', reason: '' }],
      include_afterborn_children: 'yes',
      include_expectant_children: 'no',
      omissions_intentional: 'yes',
      disinherit_issue: 'yes',
      additional_disinheritance_language: 'Custom language.',
    })

    expect(provisions.disinherited).toEqual([
      { full_name: 'Alex Example', relationship: 'child' },
      { full_name: 'Jordan Rival', relationship: 'Sibling' },
    ])
    expect(provisions.include_afterborn_children).toBe(true)
    expect(provisions.include_expectant_children).toBe(false)
    expect(provisions.omissions_intentional).toBe(true)
    expect(provisions.disinherit_issue).toBe(true)
    expect(provisions.additional_disinheritance_language).toBe('Custom language.')
  })

  it('derives blended family child lists from parentage', () => {
    const children: DesignSheetChild[] = [
      { name: 'Alex Example', dob: null, relationship: 'biological', parentage: 'client', is_minor: false },
      { name: 'Blake Example', dob: null, relationship: 'biological', parentage: 'spouse', is_minor: false },
      { name: 'Casey Example', dob: null, relationship: 'biological', parentage: 'joint', is_minor: false },
    ]

    expect(draftPayloadBlendedFamily(children, true)).toEqual({
      client_children: [{ full_name: 'Alex Example' }],
      spouse_children: [{ full_name: 'Blake Example' }],
    })
  })

  it('normalizes yes/no sheet values', () => {
    expect(sheetYesNo('yes')).toBe(true)
    expect(sheetYesNo('no')).toBe(false)
    expect(sheetYesNo(null, true)).toBe(true)
  })
})
