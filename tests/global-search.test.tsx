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

const limit = vi.fn()
beforeEach(() => {
  navigation.pathname = '/admin'
  limit.mockReset().mockResolvedValue({ data: [], error: null })
  vi.mocked(supabase.from).mockReturnValue({ select: () => ({ or: () => ({ limit }) }) } as never)
})
afterEach(cleanup)

async function openSearch() {
  const user = userEvent.setup()
  render(<GlobalSearch />)
  await user.click(screen.getByTestId('mobile-global-search-trigger'))
  return { user, input: screen.getByPlaceholderText('Search matters or jump to a page…') }
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
    expect(screen.getByPlaceholderText('Search matters or jump to a page…')).toBeTruthy()
  })
})

it('shows backend email matches even when the email is not in the client name', async () => {
  limit.mockResolvedValue({ data: [{ matter_id: 'm1', client_name: 'Jane Doe', matter_name: 'Estate plan', stage: 'drafting' }], error: null })
  const { user, input } = await openSearch()
  await user.type(input, 'jane@example.com')
  expect(await screen.findByRole('option', { name: /Jane Doe/ })).toBeTruthy()
})

it('discards results from older requests and clears pending results when the query is cleared', async () => {
  let finishOld!: (value: unknown) => void
  limit.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    .mockResolvedValueOnce({ data: [{ matter_id: 'm2', client_name: 'New Client', matter_name: 'New', stage: 'drafting' }], error: null })
  const { user, input } = await openSearch()
  await user.type(input, 'Old')
  await waitFor(() => expect(limit).toHaveBeenCalledTimes(1))
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
  for (const name of ['Tasks', 'Calendar', 'Billing']) expect(screen.getByRole('option', { name })).toBeTruthy()
})
