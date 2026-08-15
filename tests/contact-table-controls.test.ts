import { describe, expect, it } from 'vitest'
import {
  EMPTY_CONTACT_TABLE_FILTERS,
  countContactsByKind,
  filterAndSortContacts,
  type ContactDirectoryRow,
} from '@/lib/adminTables/contactTable'

const row = (overrides: Partial<ContactDirectoryRow> & Pick<ContactDirectoryRow, 'id' | 'kind' | 'name'>): ContactDirectoryRow => ({
  email: null,
  phone: null,
  self_contact_id: null,
  relationship: null,
  practice_area: null,
  city: null,
  state: null,
  href: null,
  matter_number: null,
  created_at: null,
  thread: null,
  relationship_type: null,
  ...overrides,
})

const contacts: ContactDirectoryRow[] = [
  row({ id: 'intake:1', kind: 'client', name: 'Alice Adams', email: 'alice@example.com', matter_number: '2026-EP-adams', created_at: '2026-07-01T00:00:00Z' }),
  row({ id: 'intake:2', kind: 'lead', name: 'Bob Brown', phone: '(617) 555-0101', practice_area: 'Probate', created_at: '2026-07-10T00:00:00Z' }),
  row({ id: 'intake:3', kind: 'lost', name: 'Carol Clark', created_at: '2026-06-01T00:00:00Z' }),
  row({ id: 'contact:4', kind: 'other', name: 'Dan Adams', relationship: 'Spouse · Alice Adams', created_at: '2026-07-02T00:00:00Z' }),
]

const ids = (rows: ContactDirectoryRow[]) => rows.map(r => r.id)

describe('filterAndSortContacts', () => {
  it('sorts by name ascending by default filters', () => {
    const result = filterAndSortContacts(contacts, EMPTY_CONTACT_TABLE_FILTERS, 'name_asc')
    expect(ids(result)).toEqual(['intake:1', 'intake:2', 'intake:3', 'contact:4'])
  })

  it('filters by kind', () => {
    const result = filterAndSortContacts(contacts, { search: '', kind: 'other' }, 'name_asc')
    expect(ids(result)).toEqual(['contact:4'])
  })

  it('searches across name, email, phone, relationship, and matter number', () => {
    expect(ids(filterAndSortContacts(contacts, { search: 'alice@', kind: 'all' }, 'name_asc'))).toEqual(['intake:1'])
    expect(ids(filterAndSortContacts(contacts, { search: '555-0101', kind: 'all' }, 'name_asc'))).toEqual(['intake:2'])
    expect(ids(filterAndSortContacts(contacts, { search: 'spouse', kind: 'all' }, 'name_asc'))).toEqual(['contact:4'])
    expect(ids(filterAndSortContacts(contacts, { search: '2026-EP-adams', kind: 'all' }, 'name_asc'))).toEqual(['intake:1'])
  })

  it('search and kind combine', () => {
    const result = filterAndSortContacts(contacts, { search: 'adams', kind: 'client' }, 'name_asc')
    expect(ids(result)).toEqual(['intake:1'])
  })

  it('sorts newest first with nulls last', () => {
    const withNull = [...contacts, row({ id: 'contact:5', kind: 'other', name: 'Zed Null' })]
    const result = filterAndSortContacts(withNull, EMPTY_CONTACT_TABLE_FILTERS, 'newest')
    expect(ids(result)).toEqual(['intake:2', 'contact:4', 'intake:1', 'intake:3', 'contact:5'])
  })
})

describe('countContactsByKind', () => {
  it('counts each kind plus all', () => {
    expect(countContactsByKind(contacts)).toEqual({ all: 4, client: 1, lead: 1, lost: 1, other: 1 })
  })
})
