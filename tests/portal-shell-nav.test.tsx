// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/documents',
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: async () => ({ count: 3 }),
        }),
      }),
    }),
    auth: { signOut: vi.fn() },
  },
}))

import PortalShell from '@/app/(portal)/PortalShell'

describe('portal shell navigation', () => {
  afterEach(() => cleanup())

  it('marks the current page and announces unread messages', async () => {
    render(
      <PortalShell>
        <p>Page body</p>
      </PortalShell>,
    )

    const documents = screen.getAllByRole('link', { name: 'Documents' })
    expect(documents.some(link => link.getAttribute('aria-current') === 'page')).toBe(true)

    const dashboard = screen.getAllByRole('link', { name: 'Dashboard' })
    expect(dashboard.every(link => link.getAttribute('aria-current') === null)).toBe(true)

    expect(await screen.findAllByText(/3/)).not.toHaveLength(0)
    const messages = screen.getAllByRole('link', { name: /Messages/ })
    expect(messages.some(link => /unread/i.test(link.textContent ?? ''))).toBe(true)

    const more = screen.getByRole('button', { name: 'More' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.getAttribute('aria-controls')).toBe('portal-nav-sheet')
    expect(more.getAttribute('aria-haspopup')).toBe('dialog')
  })
})
