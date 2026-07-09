import type { DesignSheet, MatterContact } from '@/types/database'

function contactName(contact: MatterContact): string {
  return [contact.first_name, contact.middle_name, contact.last_name].filter(Boolean).join(' ')
}

export interface ExcludedGuardianEntry {
  contact_id: string
  reason: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getExcludedGuardians(sheet: Pick<DesignSheet, 'decisions'>): ExcludedGuardianEntry[] {
  const decisions = sheet.decisions ?? {}
  const raw = decisions.excluded_guardians
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isRecord)
    .map(entry => ({
      contact_id: typeof entry.contact_id === 'string' ? entry.contact_id : '',
      reason: typeof entry.reason === 'string' ? entry.reason : null,
    }))
    .filter(entry => entry.contact_id)
}

export function setExcludedGuardians(
  sheet: Pick<DesignSheet, 'decisions'>,
  entries: ExcludedGuardianEntry[],
): DesignSheet['decisions'] {
  const decisions = sheet.decisions ?? {}
  return {
    ...decisions,
    excluded_guardians: entries,
  }
}

export function formatExcludedGuardianName(
  entries: ExcludedGuardianEntry[],
  contacts: MatterContact[],
): string | null {
  const lines = entries
    .map(entry => {
      const contact = contacts.find(c => c.id === entry.contact_id)
      if (!contact) return null
      const name = contactName(contact)
      const reason = entry.reason?.trim()
      return reason ? `${name} — ${reason}` : name
    })
    .filter(Boolean)
  return lines.length > 0 ? lines.join('; ') : null
}
