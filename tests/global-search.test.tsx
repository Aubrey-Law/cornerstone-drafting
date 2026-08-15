// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin',
}))

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

import { GlobalSearch } from '@/components/GlobalSearch'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)
Element.prototype.scrollIntoView = vi.fn()

afterEach(cleanup)

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
