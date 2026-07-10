import { getExcludedGuardians } from '@/lib/designSheet/excludedGuardians'
import type { ContactRow, DesignSheetRow } from '@/lib/draftPayload/types'

export interface DraftPayloadExcludedGuardian {
  full_name: string
  reason: string | null
}

function contactName(contact: ContactRow): string | null {
  const name = [contact.first_name, contact.middle_name, contact.last_name].filter(Boolean).join(' ')
  return name.trim() || null
}

export function draftPayloadExcludedGuardians(
  designSheet: Pick<DesignSheetRow, 'decisions' | 'excluded_guardian_flag' | 'excluded_guardian_name'>,
  contacts: ContactRow[],
): DraftPayloadExcludedGuardian[] {
  const entries = getExcludedGuardians(designSheet)
  const contactsById = new Map(contacts.map(contact => [contact.id, contact]))
  const resolved: DraftPayloadExcludedGuardian[] = []

  for (const entry of entries) {
    const contact = contactsById.get(entry.contact_id)
    const fullName = contact ? contactName(contact) : null
    if (!fullName) continue
    resolved.push({
      full_name: fullName,
      reason: entry.reason?.trim() || null,
    })
  }

  if (resolved.length > 0) return resolved

  if (designSheet.excluded_guardian_flag && designSheet.excluded_guardian_name?.trim()) {
    return [{ full_name: designSheet.excluded_guardian_name.trim(), reason: null }]
  }

  return []
}
