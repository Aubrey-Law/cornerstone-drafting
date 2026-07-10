import type { ContactProfile } from '@/lib/designSheet/fiduciaryDocumentInclusions'

export type RelationshipAnchor = 'client' | 'spouse' | 'joint' | 'other'
export type RelationshipPerspective = 'client' | 'spouse' | 'neutral'

export type RelationshipKind =
  | 'parent_mother'
  | 'parent_father'
  | 'sibling_sister'
  | 'sibling_brother'
  | 'child_son'
  | 'child_daughter'
  | 'grandparent'
  | 'grandchild'
  | 'aunt_uncle'
  | 'niece_nephew'
  | 'cousin'
  | 'friend'
  | 'attorney'
  | 'cpa'
  | 'other'

export interface StructuredRelationship {
  anchor: RelationshipAnchor
  kind: RelationshipKind
  custom?: string | null
}

const IN_LAW_KINDS = new Set<RelationshipKind>([
  'parent_mother',
  'parent_father',
  'sibling_sister',
  'sibling_brother',
  'child_son',
  'child_daughter',
  'grandparent',
  'grandchild',
  'aunt_uncle',
  'niece_nephew',
])

const DIRECT_LABELS: Record<RelationshipKind, string> = {
  parent_mother: 'mother',
  parent_father: 'father',
  sibling_sister: 'sister',
  sibling_brother: 'brother',
  child_son: 'son',
  child_daughter: 'daughter',
  grandparent: 'grandparent',
  grandchild: 'grandchild',
  aunt_uncle: 'aunt/uncle',
  niece_nephew: 'niece/nephew',
  cousin: 'cousin',
  friend: 'friend',
  attorney: 'attorney',
  cpa: 'CPA',
  other: 'other',
}

export function encodeRelationshipSelection(anchor: RelationshipAnchor, kind: RelationshipKind): string {
  return `${anchor}:${kind}`
}

export function decodeRelationshipSelection(value: string | null | undefined): StructuredRelationship | null {
  if (!value?.includes(':')) return null
  const [anchor, kind] = value.split(':') as [RelationshipAnchor, RelationshipKind]
  if (!anchor || !kind) return null
  if (!DIRECT_LABELS[kind]) return null
  return { anchor, kind }
}

export function buildRelationshipPickerOptions(ctx: {
  clientName?: string | null
  spouseName?: string | null
}): Array<{ value: string; label: string; group: string }> {
  const client = (ctx.clientName ?? '').trim() || 'Client'
  const spouse = (ctx.spouseName ?? '').trim() || 'Spouse'
  const hasSpouse = Boolean((ctx.spouseName ?? '').trim())

  const familyKinds: Array<{ kind: RelationshipKind; label: string }> = [
    { kind: 'parent_mother', label: 'Mother' },
    { kind: 'parent_father', label: 'Father' },
    { kind: 'sibling_sister', label: 'Sister' },
    { kind: 'sibling_brother', label: 'Brother' },
    { kind: 'child_son', label: 'Son' },
    { kind: 'child_daughter', label: 'Daughter' },
    { kind: 'grandparent', label: 'Grandparent' },
    { kind: 'grandchild', label: 'Grandchild' },
    { kind: 'aunt_uncle', label: 'Aunt / Uncle' },
    { kind: 'niece_nephew', label: 'Niece / Nephew' },
    { kind: 'cousin', label: 'Cousin' },
  ]

  const options: Array<{ value: string; label: string; group: string }> = []

  for (const row of familyKinds) {
    options.push({
      value: encodeRelationshipSelection('client', row.kind),
      label: `${client}'s ${row.label}`,
      group: client,
    })
  }

  if (hasSpouse) {
    for (const row of familyKinds) {
      options.push({
        value: encodeRelationshipSelection('spouse', row.kind),
        label: `${spouse}'s ${row.label}`,
        group: spouse,
      })
    }
  }

  options.push(
    { value: encodeRelationshipSelection('client', 'friend'), label: 'Friend', group: 'Other' },
    { value: encodeRelationshipSelection('client', 'attorney'), label: 'Attorney', group: 'Other' },
    { value: encodeRelationshipSelection('client', 'cpa'), label: 'CPA', group: 'Other' },
    { value: encodeRelationshipSelection('other', 'other'), label: 'Other (specify)', group: 'Other' },
  )

  return options
}

function isAffineInLaw(
  anchor: RelationshipAnchor,
  kind: RelationshipKind,
  perspective: RelationshipPerspective,
): boolean {
  if (perspective === 'neutral' || anchor === 'joint' || anchor === 'other') return false
  if (!IN_LAW_KINDS.has(kind)) return false
  if (anchor === perspective) return false
  return true
}

export function getRelationshipLabel(
  relationship: StructuredRelationship | null | undefined,
  perspective: RelationshipPerspective = 'client',
): string | null {
  if (!relationship) return null

  if (relationship.kind === 'other') {
    const custom = relationship.custom?.trim()
    return custom || null
  }

  const direct = DIRECT_LABELS[relationship.kind]
  if (!direct) return null

  if (isAffineInLaw(relationship.anchor, relationship.kind, perspective)) {
    if (direct.includes('/')) return `${direct.replace('/', '-in-law /')}-in-law`
    return `${direct}-in-law`
  }

  return direct
}

export function structuredFromContactProfile(profile: ContactProfile | undefined): StructuredRelationship | null {
  if (!profile) return null
  if (profile.relationship_kind) {
    return {
      anchor: profile.relationship_to ?? 'client',
      kind: profile.relationship_kind,
      custom: profile.relationship_custom ?? null,
    }
  }
  return legacyRelationshipToStructured(profile.relationship_to, profile.relationship_detail)
}

export function legacyRelationshipToStructured(
  anchor: RelationshipAnchor | undefined,
  detail: string | null | undefined,
): StructuredRelationship | null {
  const text = detail?.trim().toLowerCase()
  if (!text) return null

  const resolvedAnchor = anchor ?? 'client'
  const aliasMap: Array<[RegExp, RelationshipKind]> = [
    [/^mother(-in-law)?$/, 'parent_mother'],
    [/^father(-in-law)?$/, 'parent_father'],
    [/^sister(-in-law)?$/, 'sibling_sister'],
    [/^brother(-in-law)?$/, 'sibling_brother'],
    [/^son(-in-law)?$/, 'child_son'],
    [/^daughter(-in-law)?$/, 'child_daughter'],
    [/^friend$/, 'friend'],
    [/^attorney$/, 'attorney'],
    [/^cpa$/, 'cpa'],
  ]

  for (const [pattern, kind] of aliasMap) {
    if (pattern.test(text)) {
      return { anchor: resolvedAnchor, kind }
    }
  }

  return { anchor: resolvedAnchor, kind: 'other', custom: text }
}

export function formatContactRelationshipLine(
  profile: ContactProfile | undefined,
  contact?: { relationship?: string | null },
  perspective: RelationshipPerspective = 'client',
): string | null {
  const structured = structuredFromContactProfile(profile)
  if (structured) {
    const label = getRelationshipLabel(structured, perspective)
    if (!label) return null
    if (structured.anchor === 'client' || structured.anchor === 'spouse') {
      const anchorName = structured.anchor === 'client' ? 'client' : 'spouse'
      return `(${label} — ${anchorName})`
    }
    if (structured.anchor === 'joint') return `(${label} — client and spouse)`
    return `(${label})`
  }

  if (profile?.relationship_detail?.trim()) {
    const base = profile.relationship_to === 'client'
      ? 'client'
      : profile.relationship_to === 'spouse'
        ? 'spouse'
        : profile.relationship_to === 'joint'
          ? 'client and spouse'
          : null
    if (base) return `(${profile.relationship_detail.trim()} — ${base})`
    return `(${profile.relationship_detail.trim()})`
  }

  if (contact?.relationship?.trim()) return `(${contact.relationship.trim()})`
  return null
}

export function contactProfileRelationshipPatch(
  relationship: StructuredRelationship | null,
  perspective: RelationshipPerspective = 'client',
): Partial<ContactProfile> {
  if (!relationship) {
    return {
      relationship_to: undefined,
      relationship_kind: undefined,
      relationship_custom: undefined,
      relationship_detail: undefined,
    }
  }

  const label = getRelationshipLabel(relationship, perspective)
  return {
    relationship_to: relationship.anchor,
    relationship_kind: relationship.kind,
    relationship_custom: relationship.kind === 'other' ? relationship.custom?.trim() || null : null,
    relationship_detail: label ?? undefined,
  }
}

export function relationshipSelectionToStructured(
  selection: string | null | undefined,
  custom?: string | null,
): StructuredRelationship | null {
  const decoded = decodeRelationshipSelection(selection)
  if (!decoded) return null
  if (decoded.kind === 'other') {
    return { ...decoded, custom: custom?.trim() || null }
  }
  return decoded
}

/** Client-perspective label for contacts.relationship_label / legacy fields */
export function relationshipLabelForContact(
  relationship: StructuredRelationship | null,
): string | undefined {
  const label = relationship ? getRelationshipLabel(relationship, 'client') : null
  return label ?? undefined
}

export function structuredToSelection(relationship: StructuredRelationship | null | undefined): string {
  if (!relationship) return ''
  return encodeRelationshipSelection(relationship.anchor, relationship.kind)
}
