// @vitest-environment jsdom

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactSidePanel } from '@/app/admin/contacts/ContactSidePanel'
import type { ContactDirectoryRow } from '@/lib/adminTables/contactTable'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/contacts',
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'test-token' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// The composer is exercised on its own in tests/rail-email-pane.test.tsx; here
// we only care which record the panel scopes it to.
const composerProps: Array<Record<string, unknown>> = []
vi.mock('@/components/rail/RailEmailPane', () => ({
  ManualEmailComposer: (props: Record<string, unknown>) => {
    composerProps.push(props)
    return <div data-testid="email-composer" />
  },
}))

const row = (o: Partial<ContactDirectoryRow> & Pick<ContactDirectoryRow, 'id' | 'kind' | 'name'>): ContactDirectoryRow => ({
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
  ...o,
})

/** A referring CPA: in the contact book, attached to no lead or matter. */
const standalone = row({
  id: 'contact:c1',
  kind: 'other',
  name: 'Rita Referrer',
  email: 'rita@cpa.example.com',
  phone: '(617) 555-0104',
  relationship: 'Referring CPA',
  relationship_type: 'other',
})

/** A trustee on a hired matter — has a household, but is not the client. */
const trustee = row({
  id: 'contact:c2',
  kind: 'other',
  name: 'Tina Trust',
  email: 'tina@example.com',
  phone: '(617) 555-0103',
  relationship: 'Trustee · Alice Adams',
  relationship_type: 'trustee',
  thread: { type: 'matter', id: 'm1' },
})

const openEvents: unknown[] = []
const captureOpen = (e: Event) => openEvents.push((e as CustomEvent).detail)
let fetched: string[] = []

beforeEach(() => {
  openEvents.length = 0
  composerProps.length = 0
  fetched = []
  window.addEventListener('cornerstone:open-softphone', captureOpen)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    fetched.push(String(input))
    return { ok: true, status: 200, json: async () => [] } as Response
  }))
})
afterEach(() => {
  window.removeEventListener('cornerstone:open-softphone', captureOpen)
  vi.unstubAllGlobals()
  cleanup()
  vi.clearAllMocks()
})

const renderPanel = (contact: ContactDirectoryRow) =>
  render(<ContactSidePanel contact={contact} smsEnabled onClose={() => {}} />)

describe('ContactSidePanel', () => {
  it('offers call and email for a contact with no lead or matter behind it', async () => {
    renderPanel(standalone)
    expect(screen.getByRole('button', { name: 'Call Rita' })).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('email-composer')).toBeTruthy())
  })

  it('no longer dead-ends on "no message history"', () => {
    renderPanel(standalone)
    expect(screen.queryByText(/no message history/i)).toBeNull()
  })

  it('scopes the thread to the contact, not to a household', async () => {
    // The whole point of contact_id: a trustee's panel must not replay the
    // client's SMS history under the trustee's name.
    renderPanel(trustee)
    await waitFor(() => {
      expect(fetched.some(u => u.includes('/api/admin/contacts/c2/sms-messages'))).toBe(true)
    })
    expect(fetched.some(u => u.includes('/api/admin/matters/m1/sms-messages'))).toBe(false)
  })

  it('never reaches for a call history route', async () => {
    // Calls are not associated with a contact, so none exists to fetch.
    renderPanel(standalone)
    await waitFor(() => {
      expect(fetched.some(u => u.includes('/api/admin/contacts/c1/sms-messages'))).toBe(true)
    })
    expect(fetched.some(u => u.includes('/calls'))).toBe(false)
  })

  it('scopes the email composer to the contact so no record is attached', async () => {
    renderPanel(standalone)
    await waitFor(() => expect(composerProps.length).toBeGreaterThan(0))
    // The raw uuid, not the namespaced directory id — it becomes the draft's
    // context_id, which the schema types as uuid.
    expect(composerProps[0].recordOverride).toEqual({ type: 'contact', id: 'c1' })
  })

  it('opens the softphone with the contact number prefilled', async () => {
    const user = userEvent.setup()
    renderPanel(standalone)
    await user.click(screen.getByRole('button', { name: 'Call Rita' }))
    expect(openEvents).toContainEqual({ number: '(617) 555-0104' })
  })

  it('still threads an intake-backed row through its lead or matter', async () => {
    renderPanel(row({
      id: 'intake:i1',
      kind: 'client',
      name: 'Alice Adams',
      email: 'alice@example.com',
      phone: '(617) 555-0101',
      thread: { type: 'matter', id: 'm1' },
    }))
    await waitFor(() => {
      expect(fetched.some(u => u.includes('/api/admin/matters/m1/sms-messages'))).toBe(true)
    })
  })

  it('says so when a contact is unreachable entirely', () => {
    renderPanel(row({ id: 'contact:c3', kind: 'other', name: 'No Details' }))
    expect(screen.queryByRole('button', { name: /^Call/ })).toBeNull()
    expect(screen.getByText(/no way to reach this contact/i)).toBeTruthy()
  })
})
