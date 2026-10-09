import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { loadBookingAttendee } from '@/lib/appointments/bookingAttendee'
import { splitDisplayName } from '@/lib/appointments/types'

describe('splitDisplayName', () => {
  it.each([
    ['Mary Jones', 'Mary', 'Jones'],
    ['  Mary   Jane  Jones ', 'Mary Jane', 'Jones'],
    ['Pat Client Jr.', 'Pat', 'Client Jr.'],
    ['Client III', 'Client', 'III'],
    ['Cher', 'Cher', ''],
    ['', '', ''],
  ])('%j → %j / %j', (name, firstName, lastName) => {
    expect(splitDisplayName(name)).toEqual({ firstName, lastName })
  })
})

/** Minimal Supabase stand-in: each table resolves to one row for maybeSingle(). */
function fakeAdmin(rows: Record<string, unknown>) {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      }
      return chain
    },
  } as never
}

describe('loadBookingAttendee', () => {
  it('reads a matter client and spouse as stored components', async () => {
    const attendee = await loadBookingAttendee(fakeAdmin({
      matters: { client_intake_id: 'intake-1' },
      client_intake: { first_name: 'Mary Jane', last_name: 'van Buren', full_name: 'Mary Jane van Buren', email: ' mary@example.com ', phone: '555-0100' },
      matter_contacts: { contact_id: 'contact-1' },
      contacts: { first_name: 'Jo Ann', last_name: 'de la Cruz', email: 'jo@example.com' },
    }), { matterId: 'matter-1' })
    expect(attendee).toEqual({
      firstName: 'Mary Jane', lastName: 'van Buren', email: 'mary@example.com', phone: '555-0100',
      secondFirstName: 'Jo Ann', secondLastName: 'de la Cruz', secondEmail: 'jo@example.com',
    })
  })

  it('splits a lead that only has a full name and has no spouse', async () => {
    const attendee = await loadBookingAttendee(fakeAdmin({
      client_intake: { first_name: null, last_name: null, full_name: 'Pat Client', email: 'pat@example.com', phone: null },
    }), { leadId: 'lead-1' })
    expect(attendee).toMatchObject({ firstName: 'Pat', lastName: 'Client', secondFirstName: '', secondLastName: '', secondEmail: '' })
  })

  it('returns null for a missing record', async () => {
    expect(await loadBookingAttendee(fakeAdmin({}), { matterId: 'missing' })).toBeNull()
  })
})
