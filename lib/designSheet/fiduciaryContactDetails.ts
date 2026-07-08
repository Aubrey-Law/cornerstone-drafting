import type { DesignSheet } from '@/types/database'

export type FiduciaryContactType = 'individual' | 'entity'
export type FiduciaryContactGender = 'male' | 'female' | 'other'
export type FiduciaryRelationshipTo = 'client' | 'spouse'

export interface FiduciaryContactDetails {
  fiduciary_type?: FiduciaryContactType | null
  gender?: FiduciaryContactGender | null
  relationship_to?: FiduciaryRelationshipTo | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getFiduciaryContactDetailsMap(sheet: DesignSheet): Record<string, FiduciaryContactDetails> {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const raw = decisions.fiduciary_contact_details
  if (!isRecord(raw)) return {}
  const result: Record<string, FiduciaryContactDetails> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    result[id] = {
      fiduciary_type: value.fiduciary_type === 'entity' ? 'entity' : value.fiduciary_type === 'individual' ? 'individual' : null,
      gender: value.gender === 'male' || value.gender === 'female' || value.gender === 'other' ? value.gender : null,
      relationship_to: value.relationship_to === 'spouse' ? 'spouse' : value.relationship_to === 'client' ? 'client' : null,
    }
  }
  return result
}

export function getFiduciaryContactDetails(sheet: DesignSheet, contactId: string): FiduciaryContactDetails {
  return getFiduciaryContactDetailsMap(sheet)[contactId] ?? {}
}

export function setFiduciaryContactDetails(
  sheet: DesignSheet,
  contactId: string,
  patch: Partial<FiduciaryContactDetails>,
): DesignSheet['decisions'] {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const existing = getFiduciaryContactDetailsMap(sheet)
  return {
    ...decisions,
    fiduciary_contact_details: {
      ...existing,
      [contactId]: {
        ...existing[contactId],
        ...patch,
      },
    },
  }
}

export function removeFiduciaryContactDetails(sheet: DesignSheet, contactId: string): DesignSheet['decisions'] {
  const decisions = isRecord(sheet.decisions) ? sheet.decisions : {}
  const existing = { ...getFiduciaryContactDetailsMap(sheet) }
  delete existing[contactId]
  return {
    ...decisions,
    fiduciary_contact_details: existing,
  }
}
