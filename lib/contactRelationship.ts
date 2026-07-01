const BUILTIN_CONTACT_RELATIONSHIP_TYPES = new Set(['client', 'spouse', 'child'])

/** Common free-text relationship labels that should map to household child contacts. */
const CHILD_RELATIONSHIP_ALIASES = new Set([
  'child',
  'children',
  'son',
  'sons',
  'daughter',
  'daughters',
  'stepchild',
  'stepchildren',
  'step-son',
  'step-sons',
  'step-daughter',
  'step-daughters',
  'stepson',
  'stepsons',
  'stepdaughter',
  'stepdaughters',
  'grandchild',
  'grandchildren',
  'grandson',
  'grandsons',
  'granddaughter',
  'granddaughters',
])

export type BuiltinContactRelationshipType = 'client' | 'spouse' | 'child'
export type ContactRelationshipType = BuiltinContactRelationshipType | 'other'

function normalizeRelationshipToken(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
}

function isChildRelationshipAlias(value: string): boolean {
  if (!value) return false
  if (CHILD_RELATIONSHIP_ALIASES.has(value)) return true
  // "biological child", "adopted daughter", etc.
  return CHILD_RELATIONSHIP_ALIASES.has(value.split(' ').pop() ?? '')
}

export function normalizeContactRelationshipType(
  value: string | null | undefined,
  label?: string | null,
): ContactRelationshipType {
  const normalized = normalizeRelationshipToken(value)
  if (normalized && BUILTIN_CONTACT_RELATIONSHIP_TYPES.has(normalized)) {
    return normalized as BuiltinContactRelationshipType
  }

  const labelNormalized = normalizeRelationshipToken(label)
  if (labelNormalized && BUILTIN_CONTACT_RELATIONSHIP_TYPES.has(labelNormalized)) {
    return labelNormalized as BuiltinContactRelationshipType
  }

  if (isChildRelationshipAlias(normalized) || isChildRelationshipAlias(labelNormalized)) {
    return 'child'
  }

  return 'other'
}

export function isBuiltinContactRelationshipType(
  value: string | null | undefined,
): value is BuiltinContactRelationshipType {
  return normalizeContactRelationshipType(value) !== 'other'
}
