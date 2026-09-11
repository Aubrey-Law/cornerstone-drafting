// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftingHubMatter } from '@/lib/queries/drafting'
import type { PipelineMatter } from '@/types/database'

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

const preferences = vi.hoisted(() => ({ loadPreferences: async () => ({}), savePreferences: async (p: unknown) => p }))
vi.mock('@/lib/userPreferencesClient', () => ({ useUserPreferences: () => preferences }))

import DraftingHubClient from '@/app/admin/drafting/DraftingHubClient'
import { EMPTY_HUB_COUNTS, type DraftingHubPage } from '@/lib/drafting/hub'
import { parseHubPage, type HubPageQuery } from '@/lib/drafting/hubView'

function hubProps(matters: DraftingHubMatter[], overrides: Partial<DraftingHubPage> = {}, query = parseHubPage(new URLSearchParams(window.location.search))) {
  return { query, result: { matters, total: matters.length, page: query.page, pageSize: 50, error: null, actionCounts: { ...EMPTY_HUB_COUNTS, all: matters.length, review: matters.length }, practiceCounts: [{ name: 'Estate Planning', count: matters.length }], ...overrides } }
}

const matter: DraftingHubMatter = {
  matter: {
    matter_id: 'matter-1',
    matter_name: 'Doe Family Trust',
    client_name: 'Jane Doe',
    spouse_name: 'John Doe',
    client_email: 'jane@example.com',
    practice_area: 'Estate Planning',
    plan_type: 'Revocable Trust',
    stage: 'drafting',
    matter_created: '2026-08-01T12:00:00.000Z',
  } as PipelineMatter,
  matterNumber: '2026-EP-001',
  setupBlockers: [],
  designSheet: {
    id: 'design-1',
    status: 'approved',
    version: 2,
    updatedAt: '2026-08-10T12:00:00.000Z',
  },
  documentInclusions: null,
  includedDocumentLabels: ['Revocable Trust', 'Pour-Over Will'],
  selectedTemplateCount: 2,
  selectedTemplates: ['trust', 'will'],
  draftCount: 3,
  recentDrafts: [{
    id: 'draft-1',
    name: 'Trust.docx',
    size: 1024,
    created_at: '2026-08-12T12:00:00.000Z',
    generationId: 'generation-1',
    generationEngine: 'docxtemplater',
    markerCount: 0,
    missingCount: 0,
    supersededAt: null,
    reviewedAt: null,
    reviewedBy: null,
  }],
  supersededDrafts: [],
  supersededDraftCount: 0,
}

const secondMatter: DraftingHubMatter = {
  ...matter,
  matter: {
    ...matter.matter,
    matter_id: 'matter-2',
    matter_name: 'Smith Estate Plan',
    client_name: 'Alex Smith',
    spouse_name: null,
    client_email: 'alex@example.com',
  },
  matterNumber: '2026-EP-002',
  recentDrafts: [{
    ...matter.recentDrafts[0],
    id: 'draft-2',
    created_at: '2026-08-11T12:00:00.000Z',
  }],
}

beforeEach(() => { window.history.replaceState(null, '', '/admin/drafting'); sessionStorage.clear() })

afterEach(() => {
  cleanup()
  router.push.mockReset()
  router.replace.mockReset()
  router.prefetch.mockReset()
  router.refresh.mockReset()
  vi.useRealTimers()
})

describe('drafting hub responsive matter list', () => {
  it('offers a complete tappable mobile card while retaining the desktop table', async () => {
    const user = userEvent.setup()
    render(<DraftingHubClient {...hubProps([matter])} />)

    const mobileList = screen.getByRole('list', { name: 'Drafting matters' })
    const card = within(mobileList).getByRole('link', {
      name: /Open drafting:.*Jane Doe.*John Doe.*2026-EP-001.*Review & share.*3 current drafts.*Documents.*2.*Drafts.*3.*Activity.*Practice.*Estate Planning/i,
    })

    expect(within(card).getByText('John Doe', { exact: false })).toBeTruthy()
    expect(within(card).getByText('2026-EP-001', { exact: false })).toBeTruthy()
    expect(within(card).getByText('Review & share')).toBeTruthy()
    expect(within(card).getByText('3 current drafts')).toBeTruthy()
    expect(within(card).getByText('2', { selector: '[data-value="documents"]' })).toBeTruthy()
    expect(within(card).getByText('3', { selector: '[data-value="drafts"]' })).toBeTruthy()
    expect(within(card).getByText('Estate Planning')).toBeTruthy()
    const table = screen.getByRole('table', { name: 'Drafting matters table' })
    const tableSurface = table.parentElement?.parentElement
    const search = screen.getByRole('searchbox', { name: 'Search matters' })
    const filters = screen.getByRole('group', { name: 'Next action filter' })

    expect(mobileList.className).toContain('md:hidden')
    expect(tableSurface?.className).toContain('hidden')
    expect(tableSurface?.className).toContain('md:block')
    expect(search.parentElement?.className).toContain('w-full')
    expect(filters.className).toContain('overflow-x-auto')
    expect(filters.className).toContain('sm:overflow-visible')

    card.focus()
    await user.keyboard('{Enter}')
    card.blur()

    expect(card.getAttribute('href')).toBe('/admin/drafting/matter-1')
    fireEvent.click(card, { ctrlKey: true })
    expect(router.push).not.toHaveBeenCalled()
  })

  it('preserves slash search and arrow navigation when a mobile card has focus', async () => {
    const user = userEvent.setup()
    render(<DraftingHubClient {...hubProps([matter, secondMatter])} />)

    const cards = within(screen.getByRole('list', { name: 'Drafting matters' })).getAllByRole('link')
    cards[0].focus()

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(cards[1])

    await user.keyboard('{Enter}')
    expect(cards[1].getAttribute('href')).toBe('/admin/drafting/matter-2')

    await user.keyboard('/')
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search matters' }))
  })

  it('debounces card prefetch and cancels it when focus leaves', async () => {
    vi.useFakeTimers()
    render(<DraftingHubClient {...hubProps([matter, secondMatter])} />)

    const cards = within(screen.getByRole('list', { name: 'Drafting matters' })).getAllByRole('link')
    fireEvent.mouseEnter(cards[0])
    await vi.advanceTimersByTimeAsync(99)
    expect(router.prefetch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(router.prefetch).toHaveBeenCalledTimes(1)
    expect(router.prefetch).toHaveBeenCalledWith('/admin/drafting/matter-1')

    fireEvent.focus(cards[1])
    fireEvent.blur(cards[1])
    await vi.advanceTimersByTimeAsync(100)
    expect(router.prefetch).toHaveBeenCalledTimes(1)
  })
})

it('offers native desktop links and does not steal arrow keys from controls', async () => {
  const user = userEvent.setup()
  render(<DraftingHubClient {...hubProps([matter, secondMatter])} />)
  const table = screen.getByRole('table', { name: 'Drafting matters table' })
  const link = within(table).getByRole('link', { name: /Jane Doe/ })
  expect(link.getAttribute('href')).toBe('/admin/drafting/matter-1')
  link.focus()
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(within(table).getByRole('link', { name: /Alex Smith/ }))
  const all = screen.getByRole('button', { name: /^All\s*·/ })
  all.focus()
  await user.keyboard('{ArrowUp}')
  expect(document.activeElement).toBe(all)
})

it('loads URL filters and scopes action counts to practice area', async () => {
  window.history.replaceState(null, '', '/admin/drafting?practice=Estate+Planning&action=review&sort=client')
  render(<DraftingHubClient {...hubProps([matter], { practiceCounts: [{ name: 'Estate Planning', count: 1 }, { name: 'Probate', count: 120 }] })} />)
  expect((screen.getByRole('combobox', { name: 'Practice area' }) as HTMLSelectElement).value).toBe('Estate Planning')
  expect(screen.getByRole('button', { name: /Review\s*· 1/ })).toBeTruthy()
  expect(screen.queryByText('Alex Smith')).toBeNull()
})

it('navigates debounced search to the server and preserves page context when returning', async () => {
  const user = userEvent.setup()
  const first = render(<DraftingHubClient {...hubProps([matter, secondMatter])} />)
  await user.type(screen.getByRole('searchbox', { name: 'Search matters' }), 'Doe')
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/drafting?view=all&search=Doe', { scroll: false }))
  // Receiving an RSC response is the only point at which rows change.
  expect(screen.getAllByText('Alex Smith').length).toBeGreaterThan(0)
  const query: HubPageQuery = { search: 'Doe', sort: 'updated', action: 'all', practice: 'all', page: 2 }
  window.history.replaceState(null, '', '/admin/drafting?view=all&search=Doe&page=2')
  first.rerender(<DraftingHubClient {...hubProps([matter], { total: 51, page: 2 }, query)} />)
  const worklist = screen.getByRole('region', { name: 'Drafting worklist' })
  worklist.scrollTop = 210
  fireEvent.scroll(worklist)
  fireEvent.focus(within(screen.getByRole('table')).getByRole('link', { name: /Jane Doe/ }))
  first.unmount()
  window.history.replaceState(null, '', '/admin/drafting')
  const second = render(<DraftingHubClient {...hubProps([secondMatter])} />)
  expect(router.replace).toHaveBeenLastCalledWith('/admin/drafting?view=all&search=Doe&page=2', { scroll: false })
  expect(screen.getByRole('region', { name: 'Drafting worklist' }).scrollTop).toBe(0)
  window.history.replaceState(null, '', '/admin/drafting?view=all&search=Doe&page=2')
  second.rerender(<DraftingHubClient {...hubProps([matter], { total: 51, page: 2 }, query)} />)
  expect(screen.getByRole('region', { name: 'Drafting worklist' }).scrollTop).toBe(210)
  expect(within(screen.getByRole('table')).getByRole('link', { name: /Jane Doe/ }).closest('tr')?.getAttribute('data-state')).toBe('selected')
})

it('uses server totals for pagination and resets the page for saved views', async () => {
  const user = userEvent.setup()
  render(<DraftingHubClient {...hubProps([matter], { total: 130, actionCounts: { ...EMPTY_HUB_COUNTS, all: 200, review: 130 } })} />)
  expect(screen.getByRole('button', { name: /Review\s*· 130/ })).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('1–50 of 130 matters')
  await user.click(screen.getByRole('button', { name: /^Next$/ }))
  expect(router.replace).toHaveBeenLastCalledWith('/admin/drafting?view=all&page=2', { scroll: false })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Saved drafting views' }), 'review')
  expect(router.replace).toHaveBeenLastCalledWith('/admin/drafting?view=all&action=review', { scroll: false })
})

it('does not let a pending debounced search overwrite a later saved view', async () => {
  const user = userEvent.setup()
  render(<DraftingHubClient {...hubProps([matter])} />)
  await user.type(screen.getByRole('searchbox', { name: 'Search matters' }), 'Doe')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Saved drafting views' }), 'review')
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(router.replace).toHaveBeenCalledTimes(1)
  expect(router.replace).toHaveBeenCalledWith('/admin/drafting?view=all&action=review', { scroll: false })
})

it('normalizes a stale page URL to the last available server page', () => {
  window.history.replaceState(null, '', '/admin/drafting?page=999')
  render(<DraftingHubClient {...hubProps([matter], { total: 51, page: 2 }, { search: '', sort: 'updated', action: 'all', practice: 'all', page: 2 })} />)
  expect(router.replace).toHaveBeenCalledWith('/admin/drafting?view=all&page=2', { scroll: false })
})

it('keeps new search text when an older server response arrives during the debounce', async () => {
  const user = userEvent.setup()
  const rendered = render(<DraftingHubClient {...hubProps([matter])} />)
  await user.type(screen.getByRole('searchbox', { name: 'Search matters' }), 'Smith')
  rendered.rerender(<DraftingHubClient {...hubProps([secondMatter])} />)
  expect((screen.getByRole('searchbox', { name: 'Search matters' }) as HTMLInputElement).value).toBe('Smith')
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/drafting?view=all&search=Smith', { scroll: false }))
})
