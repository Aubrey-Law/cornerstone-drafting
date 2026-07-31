// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const params = vi.hoisted(() => new URLSearchParams('search=metlife-claim'))
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/works',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => params,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { adminNavItems } from '@/app/admin/AdminLayoutClient'
import WorksClient from '@/app/admin/works/WorksClient'

describe('billing navigation', () => {
  afterEach(cleanup)

  it('adds Billing to the shared desktop and mobile navigation source', () => {
    expect(adminNavItems.some(item => item.href === '/admin/billing' && item.label === 'Billing')).toBe(true)
  })

  it('reuses the Library search when claim-prep links provide a query', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({
        skills: [{
          id: 'skill-1',
          name: 'MetLife claim',
          description: 'Prepare claim documents',
          skill_type: 'assistant',
          execution_mode: 'chat',
          practice: 'Estate Planning',
          version: '1.0.0',
          is_system: true,
          is_shared: false,
          is_active: true,
        }],
      })),
    )

    render(<WorksClient />)

    await waitFor(() => expect(screen.getByPlaceholderText('Search workflows')).toBeTruthy())
    expect((screen.getByPlaceholderText('Search workflows') as HTMLInputElement).value).toBe(
      'metlife-claim',
    )
  })
})
