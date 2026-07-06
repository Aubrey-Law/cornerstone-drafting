import { decisionString, pick } from '@/lib/draftPayload/helpers'
import type { DesignSheetRow } from '@/lib/draftPayload/types'

/** Split a full name into first token + remainder (best-effort for drafting). */
export function splitFullName(fullName: string | null | undefined): { first_name: string; last_name: string } {
  const trimmed = fullName?.trim() ?? ''
  if (!trimmed) return { first_name: '', last_name: '' }
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { first_name: parts[0], last_name: '' }
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') }
}

/** Read a string field from a design-sheet column or its `decisions` mirror. */
export function designSheetString(
  designSheet: DesignSheetRow | null,
  key: keyof DesignSheetRow | string,
): string | null {
  const column = designSheet?.[key as keyof DesignSheetRow]
  const fromColumn = typeof column === 'string' ? column : null
  return pick(fromColumn, decisionString(designSheet, String(key)))
}

export function designSheetMaritalStatus(designSheet: DesignSheetRow | null): string | null {
  return designSheetString(designSheet, 'marital_status')
}

export function isDesignSheetMarried(designSheet: DesignSheetRow | null): boolean {
  return designSheetMaritalStatus(designSheet)?.toLowerCase() === 'married'
}
