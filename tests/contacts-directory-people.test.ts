import { describe, expect, it } from 'vitest'
import { mergePersonRows } from '@/lib/queries/contactsDirectory'
import type { ContactDirectoryRow } from '@/lib/adminTables/contactTable'

function row(over: Partial<ContactDirectoryRow>): ContactDirectoryRow {
  return {
    id: 'intake:x',
    kind: 'client',
    name: 'Ada Byron',
    email: null,
    phone: null,
    relationship: null,
    practice_area: null,
    city: null,
    state: null,
    href: null,
    matter_number: null,
    created_at: null,
    thread: null,
    relationship_type: null,
    self_contact_id: 'c-person',
    ...over,
  }
}

describe('one directory row per person, not per engagement', () => {
  it('leaves a single engagement untouched', () => {
    const only = row({ id: 'intake:1', matter_number: '2026-EP-001' })
    expect(mergePersonRows([only])).toBe(only)
  })

  it('keeps every matter number so searching any of them finds the person', () => {
    // The search index is built from matter_number, so dropping the older
    // engagement's number would make it unfindable.
    const merged = mergePersonRows([
      row({ id: 'intake:1', matter_number: '2026-EP-001', created_at: '2024-01-01' }),
      row({ id: 'intake:2', matter_number: '2026-EP-042', created_at: '2026-01-01' }),
    ])
    expect(merged.matter_number).toBe('2026-EP-042, 2026-EP-001')
  })

  it('speaks for the live engagement, not the oldest', () => {
    const merged = mergePersonRows([
      row({ id: 'intake:1', kind: 'lost', href: '/admin/crm/opportunities/1', created_at: '2026-06-01' }),
      row({ id: 'intake:2', kind: 'client', href: '/admin/matters/m2', created_at: '2024-01-01' }),
    ])
    // A hired matter outranks a lost one even though the lost one is newer.
    expect(merged.kind).toBe('client')
    expect(merged.href).toBe('/admin/matters/m2')
    expect(merged.id).toBe('intake:2')
  })

  it('picks the newest within the same kind', () => {
    const merged = mergePersonRows([
      row({ id: 'intake:1', kind: 'client', href: '/admin/matters/m1', created_at: '2024-01-01' }),
      row({ id: 'intake:2', kind: 'client', href: '/admin/matters/m2', created_at: '2026-01-01' }),
    ])
    expect(merged.href).toBe('/admin/matters/m2')
  })

  it('dates the person from first contact, not the latest engagement', () => {
    const merged = mergePersonRows([
      row({ id: 'intake:1', kind: 'client', created_at: '2026-01-01' }),
      row({ id: 'intake:2', kind: 'client', created_at: '2024-03-05' }),
    ])
    expect(merged.created_at).toBe('2024-03-05')
  })

  it('fills contact details from whichever engagement has them', () => {
    // A second engagement's intake often starts thin; the person's email is
    // still known from the first.
    const merged = mergePersonRows([
      row({ id: 'intake:2', kind: 'client', created_at: '2026-01-01', email: null, city: null }),
      row({ id: 'intake:1', kind: 'client', created_at: '2024-01-01', email: 'ada@example.com', city: 'Boston' }),
    ])
    expect(merged.email).toBe('ada@example.com')
    expect(merged.city).toBe('Boston')
  })

  it('routes comms to the live engagement', () => {
    const merged = mergePersonRows([
      row({ id: 'intake:1', kind: 'lead', thread: { type: 'lead', id: 'intake:1' }, created_at: '2026-06-01' }),
      row({ id: 'intake:2', kind: 'client', thread: { type: 'matter', id: 'm2' }, created_at: '2024-01-01' }),
    ])
    expect(merged.thread).toEqual({ type: 'matter', id: 'm2' })
  })

  it('does not invent a matter number when no engagement has one', () => {
    const merged = mergePersonRows([
      row({ id: 'intake:1', kind: 'lead', created_at: '2026-01-01' }),
      row({ id: 'intake:2', kind: 'lead', created_at: '2024-01-01' }),
    ])
    expect(merged.matter_number).toBeNull()
  })
})
