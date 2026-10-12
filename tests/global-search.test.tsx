// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({ pathname: '/admin', push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => navigation.pathname,
}))

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

import { supabase } from '@/lib/supabaseClient'

import { GlobalSearch } from '@/components/GlobalSearch'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)
Element.prototype.scrollIntoView = vi.fn()

/**
 * The palette queries four tables at once now, so the mock answers per table
 * rather than through one shared terminal. `select`, `or`, `is` and `ilike` all
 * chain; `limit` resolves whatever that table's responder returns.
 */
const responders = {
  v_matter_pipeline: vi.fn(),
  contacts: vi.fn(),
  tasks: vi.fn(),
  invoices: vi.fn(),
}

function builderFor(table: string) {
  const responder = responders[table as keyof typeof responders]
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'or', 'is', 'ilike', 'eq', 'order']) {
    builder[method] = () => builder
  }
  builder.limit = () => (responder ? responder() : Promise.resolve({ data: [], error: null }))
  return builder
}

const EMPTY = { data: [], error: null }

beforeEach(() => {
  navigation.pathname = '/admin'
  for (const responder of Object.values(responders)) {
    responder.mockReset().mockResolvedValue(EMPTY)
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => builderFor(table)) as never)
})
afterEach(cleanup)

const PLACEHOLDER = 'Search matters, contacts, tasks, invoices…'

async function openSearch() {
  const user = userEvent.setup()
  render(<GlobalSearch />)
  await user.click(screen.getByTestId('mobile-global-search-trigger'))
  return { user, input: screen.getByPlaceholderText(PLACEHOLDER) }
}

describe('global search', () => {
  it('opens the command palette from a named mobile trigger', async () => {
    const user = userEvent.setup()
    render(<GlobalSearch />)

    const trigger = screen.getByTestId('mobile-global-search-trigger')
    expect(trigger.getAttribute('aria-label')).toBe('Search')
    await user.click(trigger)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(dialog.contains(screen.getByText('Command Palette'))).toBe(true)
    expect(dialog.contains(screen.getByText('Search for a command to run...'))).toBe(true)
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeTruthy()
  })
})

it('shows backend email matches even when the email is not in the client name', async () => {
  responders.v_matter_pipeline.mockResolvedValue({
    data: [{ matter_id: 'm1', client_name: 'Jane Doe', matter_name: 'Estate plan', stage: 'drafting' }],
    error: null,
  })
  const { user, input } = await openSearch()
  await user.type(input, 'jane@example.com')
  expect(await screen.findByRole('option', { name: /Jane Doe/ })).toBeTruthy()
})

it('discards results from older requests and clears pending results when the query is cleared', async () => {
  let finishOld!: (value: unknown) => void
  responders.v_matter_pipeline
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    .mockResolvedValueOnce({ data: [{ matter_id: 'm2', client_name: 'New Client', matter_name: 'New', stage: 'drafting' }], error: null })
  const { user, input } = await openSearch()
  await user.type(input, 'Old')
  await waitFor(() => expect(responders.v_matter_pipeline).toHaveBeenCalledTimes(1))
  await user.clear(input)
  await user.type(input, 'New')
  expect(await screen.findByRole('option', { name: /New Client/ })).toBeTruthy()
  await act(async () => finishOld({ data: [{ matter_id: 'm1', client_name: 'Old Client', matter_name: 'Old' }], error: null }))
  expect(screen.getByRole('option', { name: /New Client/ })).toBeTruthy()
  expect(screen.queryByRole('option', { name: /Old Client/ })).toBeNull()
  await user.clear(input)
  expect(screen.queryByRole('option', { name: /New Client/ })).toBeNull()
})

it('includes everyday destinations and keeps Command-K as search on Calendar', async () => {
  navigation.pathname = '/admin/calendar'
  const user = userEvent.setup()
  render(<GlobalSearch />)
  await user.keyboard('{Meta>}k{/Meta}')
  expect(screen.getByRole('dialog')).toBeTruthy()
  for (const name of ['Tasks', 'Calendar', 'Billing', 'Overview', 'People', 'Activities', 'Payroll']) {
    expect(screen.getByRole('option', { name })).toBeTruthy()
  }
  expect(screen.queryByRole('option', { name: 'Contacts' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'Drafting' })).toBeNull()
  const headings = [...document.querySelectorAll('[cmdk-group-heading]')].map(node => node.textContent)
  expect(headings).toEqual(['Today', 'Clients', 'Work', 'Operations', 'Tools'])
})

/**
 * Wave 4 widened the palette past matters. These cover what that added.
 */
it('finds contacts, tasks and invoices alongside matters', async () => {
  responders.v_matter_pipeline.mockResolvedValue({
    data: [{ matter_id: 'm1', client_name: 'Okonkwo', matter_name: 'Trust', stage: 'drafting' }],
    error: null,
  })
  responders.contacts.mockResolvedValue({
    data: [{ id: 'c1', first_name: 'Ada', last_name: 'Okonkwo', preferred_name: null, email: 'ada@example.com', phone: null }],
    error: null,
  })
  responders.tasks.mockResolvedValue({
    data: [{ id: 't1', title: 'Okonkwo deed', status: 'open', matter_id: 'm1' }],
    error: null,
  })
  responders.invoices.mockResolvedValue({
    data: [{ id: 'i1', number: '1042', status: 'sent', bill_to_name: 'Okonkwo' }],
    error: null,
  })

  const { user, input } = await openSearch()
  await user.type(input, 'Okonkwo')

  expect(await screen.findByRole('option', { name: /Ada Okonkwo/ })).toBeTruthy()
  expect(screen.getByRole('option', { name: /Okonkwo deed/ })).toBeTruthy()
  expect(screen.getByRole('option', { name: /Invoice 1042/ })).toBeTruthy()
  for (const heading of ['Matters', 'Contacts', 'Tasks', 'Invoices']) {
    expect(screen.getByText(heading)).toBeTruthy()
  }
})

/**
 * The property that makes four sources safer than one: row-level security can
 * refuse any of them for a given role. Blanking the palette because invoices
 * were denied would be worse than showing the three that answered.
 */
it('keeps the results it could read when one source is refused', async () => {
  responders.v_matter_pipeline.mockResolvedValue({
    data: [{ matter_id: 'm1', client_name: 'Okonkwo', matter_name: 'Trust', stage: 'drafting' }],
    error: null,
  })
  responders.invoices.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
  responders.tasks.mockRejectedValue(new Error('network'))

  const { user, input } = await openSearch()
  await user.type(input, 'Okonkwo')

  expect(await screen.findByRole('option', { name: /Okonkwo/ })).toBeTruthy()
  expect(screen.getByText('Some results could not be loaded.')).toBeTruthy()
  // A partial failure is a note under the results, never an error over them.
  expect(screen.queryByRole('alert')).toBeNull()
})

it('reports an error only when nothing could be read', async () => {
  for (const responder of Object.values(responders)) {
    responder.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
  }

  const { user, input } = await openSearch()
  await user.type(input, 'Okonkwo')

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Search is unavailable')
})
