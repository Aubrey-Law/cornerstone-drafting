import { compareNullable, normalizeSearchText, stableSort, timestamp } from '@/lib/collections'
import { practiceAreaLabel } from '@/lib/practiceArea'

/**
 * One row in the firm-wide contact book. Leads and clients come from
 * client_intake (kind decided by the linked matter's relationship_status);
 * "other" rows are relationship contacts (spouses, children, fiduciaries)
 * from the contacts table.
 */
export type ContactKind = 'lead' | 'client' | 'lost' | 'other'

export interface ContactDirectoryRow {
  /** Namespaced key — `intake:<id>` or `contact:<id>` — so the union never collides. */
  id: string
  kind: ContactKind
  name: string
  email: string | null
  phone: string | null
  /** For "other" contacts: e.g. "Spouse · Jane Doe". Null for leads/clients. */
  relationship: string | null
  practice_area: string | null
  city: string | null
  state: string | null
  /** Where the row link goes — a matter for clients, a lead record for leads. */
  href: string | null
  matter_number: string | null
  created_at: string | null
  /** The lead/matter record that owns this person's comms threads, if any. */
  thread: { type: 'lead' | 'matter'; id: string } | null
  /** Raw contacts.relationship_type for "other" rows; null for leads/clients. */
  relationship_type: string | null
}

export type ContactKindFilter = 'all' | ContactKind

export type ContactTableFilters = {
  search: string
  kind: ContactKindFilter
}

export type ContactSortKey = 'name_asc' | 'name_desc' | 'newest' | 'oldest'

export const EMPTY_CONTACT_TABLE_FILTERS: ContactTableFilters = {
  search: '',
  kind: 'all',
}

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  lead: 'Lead',
  client: 'Client',
  lost: 'Lost lead',
  other: 'Other',
}

export function filterAndSortContacts(
  contacts: ContactDirectoryRow[],
  filters: ContactTableFilters,
  sortKey: ContactSortKey,
): ContactDirectoryRow[] {
  const search = normalizeSearchText(filters.search)
  const filtered = contacts.filter(contact =>
    (filters.kind === 'all' || contact.kind === filters.kind)
    && matchesSearch(contact, search),
  )
  return stableSort(filtered, (left, right) => compareContacts(left, right, sortKey))
}

export function countContactsByKind(contacts: ContactDirectoryRow[]): Record<ContactKindFilter, number> {
  const counts: Record<ContactKindFilter, number> = { all: contacts.length, lead: 0, client: 0, lost: 0, other: 0 }
  for (const contact of contacts) counts[contact.kind] += 1
  return counts
}

function matchesSearch(contact: ContactDirectoryRow, search: string): boolean {
  if (!search) return true
  return [
    contact.name,
    contact.email,
    contact.phone,
    contact.relationship,
    contact.matter_number,
    contact.city,
    contact.state,
    contact.practice_area,
    practiceAreaLabel(contact.practice_area),
    CONTACT_KIND_LABELS[contact.kind],
  ].some(value => normalizeSearchText(value).includes(search))
}

function compareContacts(left: ContactDirectoryRow, right: ContactDirectoryRow, sortKey: ContactSortKey): number {
  if (sortKey === 'newest') return compareNullable(timestamp(left.created_at), timestamp(right.created_at), (a, b) => b - a)
  if (sortKey === 'oldest') return compareNullable(timestamp(left.created_at), timestamp(right.created_at), (a, b) => a - b)
  if (sortKey === 'name_desc') return right.name.localeCompare(left.name)
  return left.name.localeCompare(right.name)
}
