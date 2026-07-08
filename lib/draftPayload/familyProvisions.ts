import type { DesignSheetChild } from '@/types/database'

export type FamilyProvisionsInput = {
  disinherited_children?: string[] | null
  disinheritances?: { name: string; relationship: string; reason?: string }[] | null
  include_child_gender_markers?: string | null
  include_afterborn_children?: string | null
  include_expectant_children?: string | null
  omissions_intentional?: string | null
  include_general_disinheritance?: string | null
  disinherit_issue?: string | null
  additional_disinheritance_language?: string | null
  children?: DesignSheetChild[] | null
} | null | undefined

export interface DraftPayloadFamilyProvisions {
  include_child_gender_markers: boolean
  include_afterborn_children: boolean
  include_expectant_children: boolean
  omissions_intentional: boolean
  include_general_disinheritance: boolean
  disinherit_issue: boolean
  additional_disinheritance_language: string | null
  disinherited: Array<{ full_name: string; relationship: string | null }>
}

export function sheetYesNo(value: string | null | undefined, defaultYes = false): boolean {
  const normalized = (value ?? (defaultYes ? 'yes' : 'no')).toLowerCase()
  return normalized === 'yes' || normalized === 'true'
}

export function childGenderDisplay(gender: DesignSheetChild['gender']): string {
  if (gender === 'male') return 'male'
  if (gender === 'female') return 'female'
  if (gender === 'other') return 'other'
  return ''
}

export function draftPayloadFamilyProvisions(sheet: FamilyProvisionsInput): DraftPayloadFamilyProvisions {
  const disinheritedChildren = Array.isArray(sheet?.disinherited_children) ? sheet!.disinherited_children! : []
  const disinheritances = Array.isArray(sheet?.disinheritances) ? sheet!.disinheritances! : []

  const seen = new Set<string>()
  const disinherited: DraftPayloadFamilyProvisions['disinherited'] = []

  for (const name of disinheritedChildren) {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    const key = trimmed.toLowerCase()
    if (!trimmed || seen.has(key)) continue
    seen.add(key)
    disinherited.push({ full_name: trimmed, relationship: 'child' })
  }

  for (const entry of disinheritances) {
    const trimmed = entry?.name?.trim() ?? ''
    const key = trimmed.toLowerCase()
    if (!trimmed || seen.has(key)) continue
    seen.add(key)
    disinherited.push({
      full_name: trimmed,
      relationship: entry.relationship?.trim() || null,
    })
  }

  return {
    include_child_gender_markers: sheetYesNo(sheet?.include_child_gender_markers),
    include_afterborn_children: sheetYesNo(sheet?.include_afterborn_children, true),
    include_expectant_children: sheetYesNo(sheet?.include_expectant_children, true),
    omissions_intentional: sheetYesNo(sheet?.omissions_intentional),
    include_general_disinheritance: sheetYesNo(sheet?.include_general_disinheritance, true),
    disinherit_issue: sheetYesNo(sheet?.disinherit_issue),
    additional_disinheritance_language: sheet?.additional_disinheritance_language?.trim() || null,
    disinherited,
  }
}

export function draftPayloadBlendedFamily(children: DesignSheetChild[], isMarried: boolean) {
  if (!isMarried) {
    return { client_children: [] as Array<{ full_name: string }>, spouse_children: [] as Array<{ full_name: string }> }
  }

  return {
    client_children: children
      .filter(child => child.parentage === 'client' && child.name.trim())
      .map(child => ({ full_name: child.name.trim() })),
    spouse_children: children
      .filter(child => child.parentage === 'spouse' && child.name.trim())
      .map(child => ({ full_name: child.name.trim() })),
  }
}

export function hasBlendedFamily(children: DesignSheetChild[], isMarried: boolean): boolean {
  const blended = draftPayloadBlendedFamily(children, isMarried)
  return blended.client_children.length > 0 || blended.spouse_children.length > 0
}
