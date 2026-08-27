// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ContactCard } from '@/components/contacts/ContactCard'
import type { ContactDirectoryRow } from '@/lib/adminTables/contactTable'

function contact(overrides: Partial<ContactDirectoryRow> = {}): ContactDirectoryRow {
  return {
    id: 'contact:c1',
    kind: 'client',
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '+16175550123',
    relationship: null,
    practice_area: null,
    city: null,
    state: null,
    href: null,
    matter_number: null,
    created_at: '2026-08-01T12:00:00.000Z',
    thread: null,
    relationship_type: null,
    self_contact_id: null,
    ...overrides,
  } as ContactDirectoryRow
}

describe('ContactCard', () => {
  afterEach(cleanup)

  it('always shows the communication section, since reaching someone is the point', () => {
    render(<ContactCard contact={contact()} />)
    expect(screen.getByText('Communication')).toBeTruthy()
    expect(screen.getByText('jane@example.com')).toBeTruthy()
  })

  it('marks a missing email as not recorded rather than leaving a gap', () => {
    render(<ContactCard contact={contact({ email: null })} />)
    // The row keeps its place so the column stays aligned.
    expect(screen.getByText('Email')).toBeTruthy()
    expect(screen.getAllByLabelText('Not recorded').length).toBeGreaterThan(0)
  })

  it('omits the location section entirely when there is no address', () => {
    render(<ContactCard contact={contact()} />)
    // A heading over an em dash looks broken; a shorter card looks finished.
    expect(screen.queryByText('Location')).toBeNull()
  })

  it('shows location once a city or state exists', () => {
    render(<ContactCard contact={contact({ city: 'Boston', state: 'MA' })} />)
    expect(screen.getByText('Location')).toBeTruthy()
    expect(screen.getByText('Boston, MA')).toBeTruthy()
  })

  it('omits the matter section when none of its facts are known', () => {
    render(<ContactCard contact={contact()} />)
    expect(screen.queryByText('Matter')).toBeNull()
  })

  it('shows the matter section when any one of its facts exists', () => {
    render(<ContactCard contact={contact({ relationship: 'Trustee' })} />)
    expect(screen.getByText('Matter')).toBeTruthy()
    expect(screen.getByText('Trustee')).toBeTruthy()
    // The other two rows are present but blank, which is the honest reading.
    expect(screen.getByText('Practice')).toBeTruthy()
  })

  it('links the matter number only when there is a record to open', () => {
    const { unmount } = render(
      <ContactCard contact={contact({ matter_number: 'EP-1042', href: '/admin/matters/m1' })} />,
    )
    expect(screen.getByRole('link', { name: 'EP-1042' })).toBeTruthy()
    unmount()

    render(<ContactCard contact={contact({ matter_number: 'EP-1042' })} />)
    expect(screen.queryByRole('link', { name: 'EP-1042' })).toBeNull()
    expect(screen.getByText('EP-1042')).toBeTruthy()
  })

  it('makes a phone number dialable', () => {
    render(<ContactCard contact={contact()} />)
    const link = screen.getByRole('link', { name: '+16175550123' })
    expect(link.getAttribute('href')?.startsWith('tel:')).toBe(true)
  })
})
