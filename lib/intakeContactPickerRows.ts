export interface PickerContactName {
  first_name?: string | null
  last_name?: string | null
}

export function dedupePickerContacts<T extends PickerContactName>(contacts: T[]): T[] {
  const seen = new Set<string>()
  const deduped: T[] = []

  for (const contact of contacts) {
    const key = contactNameKey(contact)
    if (!key) {
      deduped.push(contact)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(contact)
  }

  return deduped
}

function contactNameKey(contact: PickerContactName): string {
  const first = (contact.first_name ?? '').trim().toLowerCase()
  const last = (contact.last_name ?? '').trim().toLowerCase()
  return first && last ? `${first}|${last}` : ''
}
